use core::ffi::{c_int, c_void};
use core::mem::size_of;

use bun_aio::KeepAlive;
use bun_collections::ByteList;
use bun_core::Output;
use bun_event_loop::ManagedTask::ManagedTask;
use bun_io::StreamBuffer;
use crate as jsc;
use crate::json_line_buffer::JSONLineBuffer;
use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JSValue, JsError, JsResult, SerializedFlags, Task};
use bun_string::{strings, String as BunString};
use bun_sys::FdExt;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::Fd;
use bun_uws;

// `bun.cpp.*` — generated C++ dispatch shims for IPC handle (de)serialization.
// Declared at module level (same convention as DOMURL.rs / JSObject.rs) so the
// safe wrappers below can route through `from_js_host_call`.
unsafe extern "C" {
    fn IPCSerialize(global_object: *const JSGlobalObject, message: JSValue, handle: JSValue) -> JSValue;
    fn IPCParse(global_object: *const JSGlobalObject, target: JSValue, serialized: JSValue, fd: JSValue) -> JSValue;
}

// ──────────────────────────────────────────────────────────────────────────
// SendQueue ownership (§Layering / Dispatch).
//
// In Zig, `SendQueue.owner` is a tagged union over `*Subprocess` (parent side)
// and `*VirtualMachine` (child side). `Subprocess` lives in `bun_runtime`
// (tier-6), so the concrete type cannot be named here. Instead of a hand-
// rolled fn-pointer table, the owner is stored as a raw `*mut dyn` trait
// object: `IPCInstance` (this crate) and `Subprocess` (`bun_runtime`) both
// impl [`SendQueueOwner`], and the SendQueue is embedded inline in each, so
// the pointer is a BACKREF (cleared before the owner drops).
//
// The JS host fns that need the concrete `Subprocess` / `Listener` types
// (`do_send`, `emit_handle_ipc_message`, `Bun__Process__send`) live in
// `bun_runtime::ipc_host`, which can name those types directly without a
// runtime-registered hook table.
// ──────────────────────────────────────────────────────────────────────────

// TODO: rewrite this code.
/// Queue for messages sent between parent and child processes in an IPC environment. node:cluster sends json serialized messages
/// to describe different events it performs. It will send a message with an incrementing sequence number and then call a callback
/// when a message is received with an 'ack' property of the same sequence number.
///
/// PORT NOTE: moved down from `bun_runtime::node::node_cluster_binding` (cycle-break per
/// docs/PORTING.md) — `SendQueue` stores one inline so the struct must live at this tier.
/// All field accesses + dispatch methods need only `bun_jsc`/`bun_collections` symbols.
pub struct InternalMsgHolder {
    pub seq: i32,

    // TODO: move this to an Array or a JS Object or something which doesn't
    // individually create a Strong for every single IPC message...
    pub callbacks: bun_collections::ArrayHashMap<i32, crate::StrongOptional>,
    pub worker: crate::StrongOptional,
    pub cb: crate::StrongOptional,
    pub messages: Vec<crate::StrongOptional>,
}

impl Default for InternalMsgHolder {
    fn default() -> Self {
        Self {
            seq: 0,
            callbacks: bun_collections::ArrayHashMap::default(),
            worker: crate::StrongOptional::empty(),
            cb: crate::StrongOptional::empty(),
            messages: Vec::new(),
        }
    }
}

impl InternalMsgHolder {
    pub fn is_ready(&self) -> bool {
        self.worker.has() && self.cb.has()
    }

    pub fn enqueue(&mut self, message: JSValue, global: &JSGlobalObject) {
        // TODO: .addOne is workaround for .append causing crash/ dependency loop in zig compiler
        // (Rust: just push; the workaround is Zig-specific.)
        self.messages.push(crate::StrongOptional::create(message, global));
    }

    pub fn dispatch(&mut self, message: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        if !self.is_ready() {
            self.enqueue(message, global);
            return Ok(());
        }
        self.dispatch_unsafe(message, global)
    }

    fn dispatch_unsafe(&mut self, message: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        let cb = self.cb.get().unwrap();
        let worker = self.worker.get().unwrap();

        // SAFETY: `bun_vm()` never returns null; sole &mut on JS thread.
        let event_loop = unsafe { &mut *(*global.bun_vm()).event_loop() };

        if let Some(p) = message.get(global, "ack")? {
            if !p.is_undefined() {
                let ack = p.to_int32();
                // PORT NOTE: reshaped for borrowck — Zig copied the Strong out of the
                // entry, then conditionally deinit+swapRemove. Here we peek the JSValue
                // first (ending the immutable borrow), then swap_remove (which drops the
                // Strong == `defer cbstrong.deinit()`).
                let entry = self.callbacks.get(&ack).map(|s| s.get());
                if let Some(callback_opt) = entry {
                    if let Some(callback) = callback_opt {
                        self.callbacks.swap_remove(&ack);
                        event_loop.run_callback(
                            callback,
                            global,
                            self.worker.get().unwrap(),
                            &[
                                message,
                                JSValue::NULL, // handle
                            ],
                        );
                    }
                    return Ok(());
                }
            }
        }
        event_loop.run_callback(
            cb,
            global,
            worker,
            &[
                message,
                JSValue::NULL, // handle
            ],
        );
        Ok(())
    }

    pub fn flush(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        debug_assert!(self.is_ready());
        let messages = core::mem::take(&mut self.messages);
        for strong in messages {
            if let Some(message) = strong.get() {
                self.dispatch_unsafe(message, global)?;
            }
            // strong drops here (== `strong.deinit()`)
        }
        // messages Vec drops here (== `messages.deinit(bun.default_allocator)`)
        Ok(())
    }

    // `deinit` body only freed owned fields (Strongs, map, Vec). All of those impl Drop in
    // Rust, so no explicit Drop body is needed.
}

bun_core::declare_scope!(IPC, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_core::scoped_log!(IPC, $($arg)*) };
}

/// Union type that switches between simple ByteList (for advanced mode)
/// and JSONLineBuffer (for JSON mode with optimized newline tracking).
enum IncomingBuffer {
    /// For advanced mode - uses length-prefix, no scanning needed
    Advanced(ByteList),
    /// For JSON mode - tracks newline positions to avoid O(n²) scanning
    Json(JSONLineBuffer),
}

impl IncomingBuffer {
    pub fn init(mode: Mode) -> IncomingBuffer {
        match mode {
            Mode::Advanced => IncomingBuffer::Advanced(ByteList::default()),
            Mode::Json => IncomingBuffer::Json(JSONLineBuffer::default()),
        }
    }
}

// deinit: ByteList/JSONLineBuffer own their storage and Drop frees it.

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum IsInternal {
    Internal,
    External,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum SerializeAndSendResult {
    Success,
    Failure,
    Backoff,
}

/// Mode of Inter-Process Communication.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Mode {
    /// Uses SerializedScriptValue to send data. Only valid for bun <--> bun communication.
    /// The first packet sent here is a version packet so that the version of the other end is known.
    Advanced,
    /// Uses JSON messages, one message per line.
    /// This must match the behavior of node.js, and supports bun <--> node.js/etc communication.
    Json,
}

impl Mode {
    // ComptimeStringMap with ≤8 entries → plain match
    pub fn from_string(s: &[u8]) -> Option<Mode> {
        match s {
            b"advanced" => Some(Mode::Advanced),
            b"json" => Some(Mode::Json),
            _ => None,
        }
    }

    // TODO(port): move to *_jsc — Map.fromJS wrapper
    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Mode>> {
        // ComptimeStringMap.fromJS — get string from JSValue then `from_string`.
        // VERIFY-FIX: a previous draft fabricated `Err(JsError::Thrown)` without
        // an exception actually pending on `global` (violates the JSC invariant
        // that `JsError::Thrown` ⇔ `global.has_exception()`). Now: only `?` on
        // `to_slice_or_null` (which sets the exception itself); a non-string
        // input or unrecognised string yields `Ok(None)`, never a synthetic Err.
        if !value.is_string() {
            return Ok(None);
        }
        let s = value.to_slice_or_null(global)?;
        Ok(Self::from_string(s.slice()))
    }
}

pub enum DecodedIPCMessage {
    Version(u32),
    Data(JSValue),
    Internal(JSValue),
}

pub struct DecodeIPCMessageResult {
    pub bytes_consumed: u32,
    pub message: DecodedIPCMessage,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum IPCDecodeError {
    /// There werent enough bytes, recall this function again when new data is available.
    #[error("NotEnoughBytes")]
    NotEnoughBytes,
    /// Format could not be recognized. Report an error and close the socket.
    #[error("InvalidFormat")]
    InvalidFormat,
    // —— bun.JSError variants ——
    #[error("JSError")]
    JSError,
    #[error("JSTerminated")]
    JSTerminated,
    #[error("OutOfMemory")]
    OutOfMemory,
}

impl From<JsError> for IPCDecodeError {
    fn from(e: JsError) -> Self {
        match e {
            JsError::Thrown => IPCDecodeError::JSError,
            JsError::Terminated => IPCDecodeError::JSTerminated,
            JsError::OutOfMemory => IPCDecodeError::OutOfMemory,
        }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum IPCSerializationError {
    /// Value could not be serialized.
    #[error("SerializationFailed")]
    SerializationFailed,
    // —— bun.JSError variants ——
    #[error("JSError")]
    JSError,
    #[error("JSTerminated")]
    JSTerminated,
    #[error("OutOfMemory")]
    OutOfMemory,
}

// ──────────────────────────────────────────────────────────────────────────
// Body un-gated: ManagedTask (type) + JSONLineBuffer (real sibling) +
// Subprocess/IPCInstance dispatch routed through `SendQueueOwner` vtable +
// `IPC_HOOKS`. Remaining `bun_runtime` touch-points are cycle-broken via
// function-pointer registration; no direct dependency on tier-6.
// ──────────────────────────────────────────────────────────────────────────

mod advanced {
    use super::*;

    pub const HEADER_LENGTH: usize = size_of::<IPCMessageType>() + size_of::<u32>();
    // HEADER_LENGTH is a 5-byte compile-time constant; narrowing to u32 is provably safe.
    pub const HEADER_LENGTH_U32: u32 = HEADER_LENGTH as u32;
    pub const VERSION: u32 = 1;

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum IPCMessageType {
        Version = 1,
        SerializedMessage = 2,
        SerializedInternalMessage = 3,
        // Zig: `_` (non-exhaustive)
    }

    impl IPCMessageType {
        fn tag_name(raw: u8) -> &'static str {
            match raw {
                1 => "Version",
                2 => "SerializedMessage",
                3 => "SerializedInternalMessage",
                _ => "unknown",
            }
        }
    }

    #[repr(C, packed)]
    struct VersionPacket {
        type_: IPCMessageType,
        version: u32,
    }

    // comptime std.mem.asBytes(&VersionPacket{})
    static VERSION_PACKET_BYTES: [u8; HEADER_LENGTH] = {
        let v = VERSION.to_ne_bytes();
        [IPCMessageType::Version as u8, v[0], v[1], v[2], v[3]]
    };

    pub fn decode_ipc_message(
        data: &[u8],
        global: &JSGlobalObject,
    ) -> Result<DecodeIPCMessageResult, IPCDecodeError> {
        if data.len() < HEADER_LENGTH {
            log!(
                "Not enough bytes to decode IPC message header, have {} bytes",
                data.len()
            );
            return Err(IPCDecodeError::NotEnoughBytes);
        }

        let message_type_raw: u8 = data[0];
        let message_len = u32::from_le_bytes(data[1..1 + size_of::<u32>()].try_into().unwrap());

        log!(
            "Received IPC message type {} ({}) len {}",
            message_type_raw,
            IPCMessageType::tag_name(message_type_raw),
            message_len
        );

        match message_type_raw {
            x if x == IPCMessageType::Version as u8 => Ok(DecodeIPCMessageResult {
                bytes_consumed: HEADER_LENGTH_U32,
                message: DecodedIPCMessage::Version(message_len),
            }),
            x if x == IPCMessageType::SerializedMessage as u8
                || x == IPCMessageType::SerializedInternalMessage as u8 =>
            {
                // `header_length + message_len` would be evaluated as u32; a peer-controlled
                // `message_len >= 0xFFFFFFFB` wraps the sum to a small value and defeats the
                // bounds check. Compare against the remaining bytes instead — `data.len >=
                // header_length` is already established above, so the subtraction cannot
                // underflow.
                if data.len() - HEADER_LENGTH < message_len as usize {
                    log!(
                        "Not enough bytes to decode IPC message body of len {}, have {} bytes",
                        message_len,
                        data.len()
                    );
                    return Err(IPCDecodeError::NotEnoughBytes);
                }

                let message = &data[HEADER_LENGTH..][..message_len as usize];
                let deserialized = JSValue::deserialize(message, global)?;

                Ok(DecodeIPCMessageResult {
                    bytes_consumed: HEADER_LENGTH_U32 + message_len,
                    message: if x == IPCMessageType::SerializedInternalMessage as u8 {
                        DecodedIPCMessage::Internal(deserialized)
                    } else {
                        DecodedIPCMessage::Data(deserialized)
                    },
                })
            }
            _ => Err(IPCDecodeError::InvalidFormat),
        }
    }

    #[inline]
    pub fn get_version_packet() -> &'static [u8] {
        &VERSION_PACKET_BYTES
    }
    pub fn get_ack_packet() -> &'static [u8] {
        b"\x02\x24\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x0f\x00\x00\x80NODE_HANDLE_ACK\xff\xff\xff\xff"
    }
    pub fn get_nack_packet() -> &'static [u8] {
        b"\x02\x25\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x10\x00\x00\x80NODE_HANDLE_NACK\xff\xff\xff\xff"
    }

    pub fn serialize(
        writer: &mut StreamBuffer,
        global: &JSGlobalObject,
        value: JSValue,
        is_internal: IsInternal,
    ) -> Result<usize, IPCSerializationError> {
        let serialized = value
            .serialize(
                global,
                SerializedFlags {
                    // IPC sends across process.
                    for_cross_process_transfer: true,
                    for_storage: false,
                },
            )
            .map_err(|e| match e {
                JsError::Thrown => IPCSerializationError::JSError,
                JsError::Terminated => IPCSerializationError::JSTerminated,
                JsError::OutOfMemory => IPCSerializationError::OutOfMemory,
            })?;
        // `serialized` Drops at scope exit (defer serialized.deinit()).

        let size: u32 = u32::try_from(serialized.data().len()).unwrap();

        let payload_length: usize = size_of::<IPCMessageType>() + size_of::<u32>() + size as usize;

        // Spec ipc.zig:160 uses `try` — propagate OOM so serializeAndSend
        // returns `.failure` instead of silently discarding the Result.
        writer
            .ensure_unused_capacity(payload_length)
            .map_err(|_| IPCSerializationError::OutOfMemory)?;

        // PERF(port): was assume_capacity
        writer.write_type_as_bytes_assume_capacity(match is_internal {
            IsInternal::Internal => IPCMessageType::SerializedInternalMessage,
            IsInternal::External => IPCMessageType::SerializedMessage,
        });
        writer.write_type_as_bytes_assume_capacity(size);
        writer.write_assume_capacity(serialized.data());

        Ok(payload_length)
    }
}

mod json {
    use super::*;

    extern "C" fn json_ipc_data_string_free_cb(context: *mut bool, _: *mut c_void, _: u32) {
        // SAFETY: context points to `was_ascii_string_freed` on the caller's stack,
        // kept alive across the deref/defer block in decode_ipc_message.
        unsafe { *context = true };
    }

    pub fn get_version_packet() -> &'static [u8] {
        &[]
    }
    pub fn get_ack_packet() -> &'static [u8] {
        b"{\"cmd\":\"NODE_HANDLE_ACK\"}\n"
    }
    pub fn get_nack_packet() -> &'static [u8] {
        b"{\"cmd\":\"NODE_HANDLE_NACK\"}\n"
    }

    // In order to not have to do a property lookup internal messages sent from Bun will have a single u8 prepended to them
    // to be able to distinguish whether it is a regular json message or an internal one for cluster ipc communication.
    // 2 is internal
    // ["[{\d\.] is regular

    pub fn decode_ipc_message(
        data: &[u8],
        global_this: &JSGlobalObject,
        known_newline: Option<u32>,
    ) -> Result<DecodeIPCMessageResult, IPCDecodeError> {
        // <tag>{ "foo": "bar"} // tag is 1 or 2
        let idx: u32 = match known_newline {
            Some(i) => i,
            None => {
                // `strings::index_of_char` returns `Option<u32>`; the caller's
                // 4-GB-message guard is implicit in that return type.
                let found =
                    strings::index_of_char(data, b'\n').ok_or(IPCDecodeError::NotEnoughBytes)?;
                // Individual IPC messages should not exceed 4GB, and idx+1 must not overflow
                if found == u32::MAX {
                    return Err(IPCDecodeError::InvalidFormat);
                }
                found
            }
        };

        let mut json_data = &data[0..idx as usize];
        // An empty payload (newline with no preceding data) is invalid JSON.
        if json_data.is_empty() {
            return Err(IPCDecodeError::InvalidFormat);
        }

        #[derive(Copy, Clone, Eq, PartialEq)]
        enum Kind {
            Regular,
            Internal,
        }
        let mut kind = Kind::Regular;
        if json_data[0] == 2 {
            // internal message
            json_data = &json_data[1..];
            kind = Kind::Internal;
        }

        let is_ascii = strings::is_all_ascii(json_data);
        let mut was_ascii_string_freed = false;

        // Use ExternalString to avoid copying data if possible.
        // This is only possible for ascii data, as that fits into latin1
        // otherwise we have to convert it utf-8 into utf16-le.
        let str = if is_ascii {
            // .dead if `json_data` exceeds max length
            let s = BunString::create_external::<*mut bool>(
                json_data,
                true,
                &mut was_ascii_string_freed as *mut bool,
                json_ipc_data_string_free_cb,
            );
            if s.tag() == bun_string::Tag::Dead {
                #[cold]
                fn cold() {}
                cold();
                return Err(IPCDecodeError::OutOfMemory);
            }
            s
        } else {
            BunString::borrow_utf8(json_data)
        };

        // Zig: `defer { str.deref(); if (is_ascii && !was_ascii_string_freed) @panic(...) }`.
        // `bun_string::String` is `Copy` (no `Drop`), so the +1 ref taken by
        // `create_external` / `borrow_utf8` must be released explicitly. The
        // ASCII-path free callback (`json_ipc_data_string_free_cb`) only fires
        // when the WTFStringImpl refcount hits zero — i.e. *during* `deref()` —
        // so the freed-flag check must follow it on every exit path.
        let mut str = str;
        let parsed = crate::bun_string_jsc::to_js_by_parse_json(&mut str, global_this);
        str.deref();
        if is_ascii && !was_ascii_string_freed {
            panic!("Expected ascii string to be freed by ExternalString, but it wasn't. This is a bug in Bun.");
        }
        let deserialized = match parsed {
            Ok(v) => v,
            Err(JsError::Thrown) | Err(JsError::Terminated) => {
                global_this.clear_exception();
                return Err(IPCDecodeError::InvalidFormat);
            }
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
        };

        match kind {
            Kind::Regular => Ok(DecodeIPCMessageResult {
                bytes_consumed: u32::try_from(idx + 1).unwrap(),
                message: DecodedIPCMessage::Data(deserialized),
            }),
            Kind::Internal => Ok(DecodeIPCMessageResult {
                bytes_consumed: u32::try_from(idx + 1).unwrap(),
                message: DecodedIPCMessage::Internal(deserialized),
            }),
        }
    }

    pub fn serialize(
        writer: &mut StreamBuffer,
        global: &JSGlobalObject,
        value: JSValue,
        is_internal: IsInternal,
    ) -> Result<usize, IPCSerializationError> {
        let mut out: BunString = BunString::default();
        // Use jsonStringifyFast which passes undefined for the space parameter,
        // triggering JSC's SIMD-optimized FastStringifier code path.
        value
            .json_stringify_fast(global, &mut out)
            .map_err(|e| match e {
                JsError::Thrown => IPCSerializationError::JSError,
                JsError::Terminated => IPCSerializationError::JSTerminated,
                JsError::OutOfMemory => IPCSerializationError::OutOfMemory,
            })?;
        // `out` Drops (deref) at scope exit.

        if out.tag() == bun_string::Tag::Dead {
            return Err(IPCSerializationError::SerializationFailed);
        }

        // TODO: it would be cool to have a 'toUTF8Into' which can write directly into 'ipc_data.outgoing.list'
        let str = out.to_utf8();
        let slice = str.slice();

        let mut result_len: usize = slice.len() + 1;
        if is_internal == IsInternal::Internal {
            result_len += 1;
        }

        // Spec ipc.zig:280 uses `try` — propagate OOM so serializeAndSend
        // returns `.failure` instead of silently discarding the Result.
        writer
            .ensure_unused_capacity(result_len)
            .map_err(|_| IPCSerializationError::OutOfMemory)?;

        // PERF(port): was assume_capacity
        if is_internal == IsInternal::Internal {
            writer.write_assume_capacity(&[2]);
        }
        writer.write_assume_capacity(slice);
        writer.write_assume_capacity(b"\n");

        Ok(result_len)
    }
}

/// Given potentially unfinished buffer `data`, attempt to decode and process a message from it.
/// For JSON mode, `known_newline` can be provided to avoid re-scanning for the newline delimiter.
pub fn decode_ipc_message(
    mode: Mode,
    data: &[u8],
    global: &JSGlobalObject,
    known_newline: Option<u32>,
) -> Result<DecodeIPCMessageResult, IPCDecodeError> {
    match mode {
        Mode::Advanced => advanced::decode_ipc_message(data, global),
        Mode::Json => json::decode_ipc_message(data, global, known_newline),
    }
}

/// Returns the initialization packet for the given mode. Can be zero-length.
pub fn get_version_packet(mode: Mode) -> &'static [u8] {
    match mode {
        Mode::Advanced => advanced::get_version_packet(),
        Mode::Json => json::get_version_packet(),
    }
}

/// Given a writer interface, serialize and write a value.
/// Returns true if the value was written, false if it was not.
pub fn serialize(
    mode: Mode,
    writer: &mut StreamBuffer,
    global: &JSGlobalObject,
    value: JSValue,
    is_internal: IsInternal,
) -> Result<usize, IPCSerializationError> {
    match mode {
        Mode::Advanced => advanced::serialize(writer, global, value, is_internal),
        Mode::Json => json::serialize(writer, global, value, is_internal),
    }
}

pub fn get_ack_packet(mode: Mode) -> &'static [u8] {
    match mode {
        Mode::Advanced => advanced::get_ack_packet(),
        Mode::Json => json::get_ack_packet(),
    }
}

pub fn get_nack_packet(mode: Mode) -> &'static [u8] {
    match mode {
        Mode::Advanced => advanced::get_nack_packet(),
        Mode::Json => json::get_nack_packet(),
    }
}

pub type Socket = bun_uws::SocketHandler<false>;
// TODO(port): uws.NewSocketHandler(false) — verify generic shape in bun_uws

pub struct Handle {
    pub fd: Fd,
    pub js: JSValue,
}

impl Handle {
    pub fn init(fd: Fd, js: JSValue) -> Self {
        js.protect();
        Self { fd, js }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        self.js.unprotect();
    }
}

pub enum CallbackList {
    AckNack,
    None,
    /// js callable
    Callback(JSValue),
    /// js array
    CallbackArray(JSValue),
}

impl CallbackList {
    /// protects the callback
    pub fn init(callback: JSValue) -> Self {
        if callback.is_callable() {
            callback.protect();
            return CallbackList::Callback(callback);
        }
        CallbackList::None
    }

    /// protects the callback
    pub fn push(&mut self, callback: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        match self {
            CallbackList::AckNack => unreachable!(),
            CallbackList::None => {
                callback.protect();
                *self = CallbackList::Callback(callback);
            }
            CallbackList::Callback(prev) => {
                let prev = *prev;
                let arr = JSValue::create_empty_array(global, 2)?;
                arr.protect();
                arr.put_index(global, 0, prev)?; // add the old callback to the array
                arr.put_index(global, 1, callback)?; // add the new callback to the array
                // `prev` is unprotected exactly once by `Drop` when the old
                // variant is overwritten below — do NOT unprotect manually
                // (would underflow JSC's protect count).
                *self = CallbackList::CallbackArray(arr);
            }
            CallbackList::CallbackArray(arr) => {
                arr.push(global, callback)?;
            }
        }
        Ok(())
    }

    fn call_next_tick(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        match self {
            CallbackList::AckNack => {}
            CallbackList::None => {}
            CallbackList::Callback(cb) => {
                JSValue::call_next_tick_1(*cb, global, JSValue::NULL)?;
                // Assignment runs `Drop` on the old `Callback(cb)` variant,
                // which performs the single `unprotect()`.
                *self = CallbackList::None;
            }
            CallbackList::CallbackArray(arr) => {
                let mut iter = arr.array_iterator(global)?;
                while let Some(item) = iter.next()? {
                    JSValue::call_next_tick_1(item, global, JSValue::NULL)?;
                }
                // Assignment runs `Drop` on the old `CallbackArray(arr)`
                // variant, which performs the single `unprotect()`.
                *self = CallbackList::None;
            }
        }
        Ok(())
    }
}

impl Drop for CallbackList {
    fn drop(&mut self) {
        match self {
            CallbackList::AckNack => {}
            CallbackList::None => {}
            CallbackList::Callback(cb) => cb.unprotect(),
            CallbackList::CallbackArray(arr) => arr.unprotect(),
        }
        // Zig sets `self.* = .none` here; in Rust, Drop is terminal.
    }
}

pub struct SendHandle {
    // when a message has a handle, make sure it has a new SendHandle - so that if we retry sending it,
    // we only retry sending the message with the handle, not the original message.
    pub data: StreamBuffer,
    /// keep sending the handle until data is drained (assume it hasn't sent until data is fully drained)
    pub handle: Option<Handle>,
    pub callbacks: CallbackList,
}

impl SendHandle {
    pub fn is_ack_nack(&self) -> bool {
        matches!(self.callbacks, CallbackList::AckNack)
    }

    /// Call the callback and deinit
    pub fn complete(mut self, global: &JSGlobalObject) {
        let _ = self.callbacks.call_next_tick(global); // TODO: properly propagate exception upwards
        // self drops here → data/callbacks/handle Drop.
    }
}

// SendHandle.deinit: all fields Drop; no explicit impl needed.

#[cfg(windows)]
pub struct WindowsWrite {
    pub write_req: uv::uv_write_t,
    pub write_buffer: uv::uv_buf_t,
    pub write_slice: Box<[u8]>,
    pub owner: Option<*mut SendQueue>,
}

#[cfg(windows)]
impl WindowsWrite {
    pub fn destroy(this: *mut WindowsWrite) {
        // SAFETY: `this` was produced by Box::into_raw in SendQueue::_write;
        // libuv guarantees the write callback fires exactly once.
        let _ = unsafe { Box::from_raw(this) };
        // write_slice freed by Box<[u8]> Drop.
    }
}

#[cfg(windows)]
#[derive(Default)]
pub struct WindowsState {
    pub is_server: bool,
    /// Non-owning raw pointer (matches Zig `?*WindowsWrite`). The allocation
    /// is `Box::into_raw`'d in `_write` and freed exactly once by
    /// `_windows_on_write_complete` via `WindowsWrite::destroy`. Nulling this
    /// field never frees.
    pub windows_write: Option<*mut WindowsWrite>,
    pub try_close_after_write: bool,
}

#[cfg(not(windows))]
#[derive(Default)]
pub struct WindowsState {}

#[derive(Copy, Clone, Eq, PartialEq)]
enum CloseReason {
    Normal,
    Failure,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum CloseFrom {
    User,
    Deinit,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum AckNack {
    Ack,
    Nack,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum ContinueSendReason {
    NewMessageAppended,
    OnWritable,
}

pub struct SendQueue {
    pub queue: Vec<SendHandle>,
    pub waiting_for_ack: Option<SendHandle>,

    pub retry_count: u32,
    pub keep_alive: KeepAlive,
    #[cfg(debug_assertions)]
    pub has_written_version: u8,
    pub mode: Mode,
    pub internal_msg_queue: InternalMsgHolder,
    incoming: IncomingBuffer,
    pub incoming_fd: Option<Fd>,

    pub socket: SocketUnion,
    /// BACKREF to the embedding owner (`Subprocess` or `IPCInstance`). The
    /// SendQueue is stored inline in its owner, so this is a self-referential
    /// raw pointer; never reborrow as `&mut dyn` while a `&mut SendQueue` is
    /// live (every access goes through `unsafe { &mut *self.owner }` at the
    /// call site, mirroring the Zig union dispatch).
    pub owner: *mut dyn SendQueueOwner,

    pub close_next_tick: Option<Task>,
    /// Set while an `_onAfterIPCClosed` task is queued. Cleared when the task
    /// runs. Tracked so `deinit` can cancel it; the task captures a raw
    /// `*SendQueue` into the owner's inline storage, which is freed right
    /// after `deinit` returns.
    pub after_close_task: Option<Task>,
    pub write_in_progress: bool,
    pub close_event_sent: bool,

    pub windows: WindowsState,
}

/// Dispatch surface for the SendQueue's embedding object — either a
/// `Subprocess` (parent side, `bun_runtime`) or a `VirtualMachine::IPCInstance`
/// (child side, this crate). Replaces the Zig `union(enum) { subprocess,
/// virtual_machine }` switch with a trait object so the concrete `Subprocess`
/// type need not be named here.
pub trait SendQueueOwner {
    fn global_this(&self) -> *const JSGlobalObject;
    fn handle_ipc_close(&mut self);
    fn handle_ipc_message(&mut self, msg: DecodedIPCMessage, handle: JSValue);
    /// `Subprocess.this_value.tryGet()` — returns `ZERO` for the VM-side owner.
    fn this_jsvalue(&self) -> JSValue;
    fn kind(&self) -> SendQueueOwnerKind;
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum SendQueueOwnerKind {
    Subprocess,
    VirtualMachine,
}

#[cfg(windows)]
pub type SocketType = *mut uv::Pipe;
#[cfg(not(windows))]
pub type SocketType = Socket;

pub enum SocketUnion {
    Uninitialized,
    Open(SocketType),
    Closed,
}

impl SendQueue {
    pub fn init(mode: Mode, owner: *mut dyn SendQueueOwner, socket: SocketUnion) -> Self {
        log!("SendQueue#init");
        Self {
            queue: Vec::new(),
            waiting_for_ack: None,
            retry_count: 0,
            keep_alive: KeepAlive::default(),
            #[cfg(debug_assertions)]
            has_written_version: 0,
            mode,
            internal_msg_queue: InternalMsgHolder::default(),
            incoming: IncomingBuffer::init(mode),
            incoming_fd: None,
            socket,
            owner,
            close_next_tick: None,
            after_close_task: None,
            write_in_progress: false,
            close_event_sent: false,
            windows: WindowsState::default(),
        }
    }

    pub fn is_connected(&self) -> bool {
        #[cfg(windows)]
        if self.windows.try_close_after_write {
            return false;
        }
        matches!(self.socket, SocketUnion::Open(_)) && self.close_next_tick.is_none()
    }

    fn close_socket(&mut self, reason: CloseReason, from: CloseFrom) {
        log!(
            "SendQueue#closeSocket {}",
            match from {
                CloseFrom::User => "user",
                CloseFrom::Deinit => "deinit",
            }
        );
        match &self.socket {
            SocketUnion::Open(s) => {
                #[cfg(windows)]
                {
                    let pipe: *mut uv::Pipe = *s;
                    // SAFETY: pipe is a live uv_pipe_t owned until _windowsOnClosed fires.
                    let stream: *mut uv::uv_stream_t = unsafe { (*pipe).as_stream() };
                    unsafe { (*stream).read_stop() };

                    if self.windows.windows_write.is_some() && from != CloseFrom::Deinit {
                        log!("SendQueue#closeSocket -> mark ready for close");
                        // currently writing; wait for the write to complete
                        self.windows.try_close_after_write = true;
                    } else {
                        log!("SendQueue#closeSocket -> close now");
                        self._windows_close();
                    }
                }
                #[cfg(not(windows))]
                {
                    s.close(match reason {
                        CloseReason::Normal => bun_uws::CloseCode::Normal,
                        CloseReason::Failure => bun_uws::CloseCode::Failure,
                    });
                    self._socket_closed();
                }
            }
            _ => {
                self._socket_closed();
            }
        }
        let _ = reason; // suppress unused on windows
    }

    fn _socket_closed(&mut self) {
        log!("SendQueue#_socketClosed");
        #[cfg(windows)]
        {
            if let Some(windows_write) = self.windows.windows_write {
                // SAFETY: `windows_write` was leaked via `Box::into_raw` in
                // `_write`; libuv still holds it and will free it in
                // `_windows_on_write_complete`. We only clear the backref so
                // the callback doesn't touch a dead `SendQueue`.
                unsafe { (*windows_write).owner = None };
            }
            self.windows.windows_write = None; // will be freed by _windowsOnWriteComplete
        }
        self.keep_alive.disable();
        let was_open = matches!(self.socket, SocketUnion::Open(_));
        self.socket = SocketUnion::Closed;
        // Only enqueue the close notification for the open→closed transition.
        // `closeSocket` (via `SendQueue.deinit` during the owner's finalizer)
        // can reach this path again with the socket already `.closed`; the
        // owner is about to free the memory that backs `this`, so scheduling
        // a task that points back into it would use-after-free.
        if was_open && self.after_close_task.is_none() {
            // PORT NOTE: `bun_event_loop::JsResult` erases the error to `*mut ()`;
            // adapt the jsc-crate `JsResult` via a non-capturing closure (coerces to fn ptr).
            let task = ManagedTask::new(self as *mut SendQueue, |p| {
                let _ = Self::_on_after_ipc_closed(p);
                Ok(())
            });
            self.after_close_task = Some(task);
            // Spec ipc.zig:589 calls `bunVM().enqueueTask(...)` on a raw
            // `*VirtualMachine`. Do NOT materialize `&mut VirtualMachine` from
            // `bun_vm()`'s shared `&VirtualMachine` (Stacked-Borrows UB —
            // `&mut T` while other `&T` exist). `event_loop()` takes `&self`
            // and yields the raw `*mut EventLoop`; route the enqueue through
            // that, mirroring `VirtualMachine::enqueue_task`'s body without
            // the `&mut self` receiver.
            // SAFETY: `event_loop()` returns the VM-owned `*mut EventLoop`,
            // live for the VM's lifetime; short-lived `&mut` reborrow at the
            // call site only.
            unsafe {
                (*(*self.get_global_this().bun_vm()).event_loop())
                    .enqueue_task(self.after_close_task.unwrap());
            }
        }
    }

    #[cfg(windows)]
    fn _windows_close(&mut self) {
        log!("SendQueue#_windowsClose");
        let SocketUnion::Open(pipe) = self.socket else {
            return;
        };
        // SAFETY: pipe is live until the close cb fires.
        unsafe {
            (*pipe).data = pipe.cast();
            (*pipe).close(Self::_windows_on_closed);
        }
        self._socket_closed();
    }
    #[cfg(not(windows))]
    fn _windows_close(&mut self) {}

    #[cfg(windows)]
    extern "C" fn _windows_on_closed(windows: *mut uv::Pipe) {
        log!("SendQueue#_windowsOnClosed");
        // SAFETY: pipe was Box::into_raw'd in windowsConfigureClient / created by caller.
        let _ = unsafe { Box::from_raw(windows) };
    }

    pub fn close_socket_next_tick(&mut self, next_tick: bool) {
        log!("SendQueue#closeSocketNextTick");
        if !matches!(self.socket, SocketUnion::Open(_)) {
            self.socket = SocketUnion::Closed;
            return;
        }
        if self.close_next_tick.is_some() {
            return; // close already requested
        }
        if !next_tick {
            self.close_socket(CloseReason::Normal, CloseFrom::User);
            return;
        }
        // PORT NOTE: see `_socket_closed` — adapt `bun_event_loop::JsResult` via closure.
        let task = ManagedTask::new(self as *mut SendQueue, |p| {
            let _ = Self::_close_socket_task(p);
            Ok(())
        });
        self.close_next_tick = Some(task);
        // SAFETY: VirtualMachine::get() returns the singleton; enqueue_task
        // only mutates the task queue.
        unsafe { (*VirtualMachine::get()).enqueue_task(self.close_next_tick.unwrap()) };
    }

    fn _close_socket_task(this: *mut SendQueue) -> JsResult<()> {
        // SAFETY: `this` was the live `*mut SendQueue` passed to ManagedTask::new;
        // the task is cancelled in Drop before the storage is freed.
        let this = unsafe { &mut *this };
        log!("SendQueue#closeSocketTask");
        debug_assert!(this.close_next_tick.is_some());
        this.close_next_tick = None;
        this.close_socket(CloseReason::Normal, CloseFrom::User);
        Ok(())
    }

    fn _on_after_ipc_closed(this: *mut SendQueue) -> JsResult<()> {
        // SAFETY: see _close_socket_task.
        let this = unsafe { &mut *this };
        log!("SendQueue#_onAfterIPCClosed");
        this.after_close_task = None;
        if this.close_event_sent {
            return Ok(());
        }
        this.close_event_sent = true;
        // SAFETY: BACKREF — owner embeds this SendQueue inline and outlives it.
        unsafe { (*this.owner).handle_ipc_close() };
        Ok(())
    }

    /// returned pointer is invalidated if the queue is modified
    pub fn start_message(
        &mut self,
        global: &JSGlobalObject,
        callback: JSValue,
        handle: Option<Handle>,
    ) -> JsResult<&mut SendHandle> {
        log!("SendQueue#startMessage");
        #[cfg(debug_assertions)]
        debug_assert!(self.has_written_version == 1);

        // optimal case: appending a message without a handle to the end of the queue when the last message also doesn't have a handle and isn't ack/nack
        // this is rare. it will only happen if messages stack up after sending a handle, or if a long message is sent that is waiting for writable
        // PORT NOTE: reshaped for borrowck (NLL limitation: early-return of
        // `&mut self.queue[..]` would otherwise extend the borrow across the
        // fallback push). Compute the predicate first, then re-borrow.
        let use_last = if handle.is_none() && !self.queue.is_empty() {
            let len = self.queue.len();
            let last = &self.queue[len - 1];
            last.handle.is_none()
                && !last.is_ack_nack()
                && !(len == 1 && self.write_in_progress)
        } else {
            false
        };
        if use_last {
            let len = self.queue.len();
            let last = &mut self.queue[len - 1];
            if callback.is_callable() {
                last.callbacks.push(callback, global)?;
            }
            // caller can append now
            return Ok(last);
        }

        // fallback case: append a new message to the queue
        self.queue.push(SendHandle {
            data: StreamBuffer::default(),
            handle,
            callbacks: CallbackList::init(callback),
        });
        let idx = self.queue.len() - 1;
        Ok(&mut self.queue[idx])
    }

    /// returned pointer is invalidated if the queue is modified
    pub fn insert_message(&mut self, message: SendHandle) {
        log!("SendQueue#insertMessage");
        #[cfg(debug_assertions)]
        debug_assert!(self.has_written_version == 1);
        if (self.queue.is_empty() || self.queue[0].data.cursor == 0) && !self.write_in_progress {
            // prepend (we have not started sending the next message yet because we are waiting for the ack/nack)
            self.queue.insert(0, message);
        } else {
            // insert at index 1 (we are in the middle of sending a message to the other process)
            debug_assert!(self.queue[0].is_ack_nack());
            self.queue.insert(1, message);
        }
    }

    pub fn on_ack_nack(&mut self, global: &JSGlobalObject, ack_nack: AckNack) {
        log!("SendQueue#onAckNack");
        if self.waiting_for_ack.is_none() {
            log!("onAckNack: ack received but not waiting for ack");
            return;
        }
        let item = self.waiting_for_ack.as_mut().unwrap();
        if item.handle.is_none() {
            log!("onAckNack: ack received but waiting_for_ack is not a handle message?");
            return;
        }
        if ack_nack == AckNack::Nack {
            // retry up to three times
            self.retry_count += 1;
            if self.retry_count < MAX_HANDLE_RETRANSMISSIONS {
                // retry sending the message
                item.data.cursor = 0;
                let item = self.waiting_for_ack.take().unwrap();
                self.insert_message(item);
                log!("IPC call continueSend() from onAckNack retry");
                return self.continue_send(global, ContinueSendReason::NewMessageAppended);
            }
            // too many retries; give up - emit warning if possible
            let mut warning =
                BunString::static_(b"Handle did not reach the receiving process correctly");
            let mut warning_name = BunString::static_(b"SentHandleNotReceivedWarning");
            if let Ok(warning_js) = crate::bun_string_jsc::transfer_to_js(&mut warning, global) {
                if let Ok(warning_name_js) =
                    crate::bun_string_jsc::transfer_to_js(&mut warning_name, global)
                {
                    let _ = global.emit_warning(
                        warning_js,
                        warning_name_js,
                        JSValue::UNDEFINED,
                        JSValue::UNDEFINED,
                    );
                }
            }
            // (fall through to success code in order to consume the message and continue sending)
        }
        // consume the message and continue sending
        let item = self.waiting_for_ack.take().unwrap();
        item.complete(global); // call the callback & deinit
        log!("IPC call continueSend() from onAckNack success");
        self.continue_send(global, ContinueSendReason::NewMessageAppended);
    }

    fn should_ref(&self) -> bool {
        if self.waiting_for_ack.is_some() {
            return true; // waiting to receive an ack/nack from the other side
        }
        if self.queue.is_empty() {
            return false; // nothing to send
        }
        let first = &self.queue[0];
        if first.data.cursor > 0 {
            return true; // send in progress, waiting on writable
        }
        if self.write_in_progress {
            return true; // send in progress (windows), waiting on writable
        }
        false // error state.
    }

    pub fn update_ref(&mut self, global: &JSGlobalObject) {
        let _ = global;
        // PORT NOTE: KeepAlive::{ref_,unref} take an `EventLoopCtx` (aio cycle-
        // break vtable), not `&VirtualMachine`. The Zig anytype dispatch is
        // routed through `bun_aio::get_vm_ctx` which `bun_runtime` registers.
        let ctx = bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js);
        if self.should_ref() {
            self.keep_alive.ref_(ctx);
        } else {
            self.keep_alive.unref(ctx);
        }
    }

    fn continue_send(&mut self, global: &JSGlobalObject, reason: ContinueSendReason) {
        log!(
            "IPC continueSend: {}",
            match reason {
                ContinueSendReason::NewMessageAppended => "new_message_appended",
                ContinueSendReason::OnWritable => "on_writable",
            }
        );
        self.debug_log_message_queue();
        // defer this.updateRef(global) — handled at every return below.
        // TODO(port): errdefer — use scopeguard for update_ref-on-exit in Phase B.

        if self.queue.is_empty() {
            self.update_ref(global);
            return; // nothing to send
        }
        if self.write_in_progress {
            self.update_ref(global);
            return; // write in progress
        }

        let first = &self.queue[0];
        if self.waiting_for_ack.is_some() && !first.is_ack_nack() {
            // waiting for ack/nack. may not send any items until it is received.
            // only allowed to send the message if it is an ack/nack itself.
            self.update_ref(global);
            return;
        }
        if reason != ContinueSendReason::OnWritable && first.data.cursor != 0 {
            // the last message isn't fully sent yet, we're waiting for a writable event
            self.update_ref(global);
            return;
        }
        let to_send_len = first.data.list.len() - first.data.cursor;
        if to_send_len == 0 {
            // item's length is 0, remove it and continue sending. this should rarely (never?) happen.
            let itm = self.queue.remove(0);
            itm.complete(global); // call the callback & deinit
            log!("IPC call continueSend() from empty item");
            return self.continue_send(global, reason);
        }
        // log("sending ipc message: '{'}' (has_handle={})", .{ std.zig.fmtString(to_send), first.handle != null });
        debug_assert!(!self.write_in_progress);
        self.write_in_progress = true;
        let fd = self.queue[0].handle.as_ref().map(|h| h.fd);
        // `_write` re-slices `self.queue[0]` internally so we never hand a
        // borrow of `self` into a `&mut self` method (PORTING.md aliased-&mut).
        self._write(fd);
        // the write is queued. this._onWriteComplete() will be called when the write completes.
        self.update_ref(global);
    }

    fn _on_write_complete(&mut self, n: i32) {
        log!("SendQueue#_onWriteComplete {}", n);
        self.debug_log_message_queue();
        if !self.write_in_progress || self.queue.is_empty() {
            debug_assert!(false);
            return;
        }
        self.write_in_progress = false;
        let global_this = self.get_global_this();
        // defer this.updateRef(globalThis) — applied at each return.
        let first = &mut self.queue[0];
        let to_send_len = first.data.list.len() - first.data.cursor;
        if n as usize == to_send_len {
            if first.handle.is_some() {
                // the message was fully written, but it had a handle.
                // we must wait for ACK or NACK before sending any more messages.
                if self.waiting_for_ack.is_some() {
                    log!("[error] already waiting for ack. this should never happen.");
                }
                // shift the item off the queue and move it to waiting_for_ack
                let item = self.queue.remove(0);
                self.waiting_for_ack = Some(item);
            } else {
                // the message was fully sent, but there may be more items in the queue.
                // shift the queue and try to send the next item immediately.
                let item = self.queue.remove(0);
                item.complete(global_this); // call the callback & deinit
            }
            self.continue_send(global_this, ContinueSendReason::OnWritable);
            self.update_ref(global_this);
            return;
        } else if n > 0 && n < i32::try_from(first.data.list.len()).unwrap() {
            // the item was partially sent; update the cursor and wait for writable to send the rest
            // (if we tried to send a handle, a partial write means the handle wasn't sent yet.)
            first.data.cursor += usize::try_from(n).unwrap();
            self.update_ref(global_this);
            return;
        } else if n == 0 {
            // no bytes written; wait for writable
            self.update_ref(global_this);
            return;
        } else {
            // error. close socket.
            self.close_socket(CloseReason::Failure, CloseFrom::Deinit);
            self.update_ref(global_this);
            return;
        }
    }

    pub fn write_version_packet(&mut self, global: &JSGlobalObject) {
        log!("SendQueue#writeVersionPacket");
        #[cfg(debug_assertions)]
        debug_assert!(self.has_written_version == 0);
        debug_assert!(self.queue.is_empty());
        debug_assert!(self.waiting_for_ack.is_none());
        let bytes = get_version_packet(self.mode);
        if !bytes.is_empty() {
            self.queue.push(SendHandle {
                data: StreamBuffer::default(),
                handle: None,
                callbacks: CallbackList::None,
            });
            let last = self.queue.len() - 1;
            let _ = self.queue[last].data.write(bytes);
            log!("IPC call continueSend() from version packet");
            self.continue_send(global, ContinueSendReason::NewMessageAppended);
        }
        #[cfg(debug_assertions)]
        {
            self.has_written_version = 1;
        }
    }

    pub fn serialize_and_send(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
        is_internal: IsInternal,
        callback: JSValue,
        handle: Option<Handle>,
    ) -> SerializeAndSendResult {
        log!("SendQueue#serializeAndSend");
        let indicate_backoff = self.waiting_for_ack.is_some() && !self.queue.is_empty();
        // PORT NOTE: reshaped for borrowck — work on msg via local then drop borrow before continue_send.
        let mode = self.mode;
        let msg = match self.start_message(global, callback, handle) {
            Ok(m) => m,
            Err(_) => return SerializeAndSendResult::Failure,
        };
        let start_offset = msg.data.list.len();

        let payload_length = match serialize(mode, &mut msg.data, global, value, is_internal) {
            Ok(n) => n,
            Err(_) => return SerializeAndSendResult::Failure,
        };
        debug_assert!(msg.data.list.len() == start_offset + payload_length);
        // log("enqueueing ipc message: '{'}'", .{std.zig.fmtString(msg.data.list.items[start_offset..])});

        log!("IPC call continueSend() from serializeAndSend");
        self.continue_send(global, ContinueSendReason::NewMessageAppended);

        if indicate_backoff {
            return SerializeAndSendResult::Backoff;
        }
        SerializeAndSendResult::Success
    }

    fn debug_log_message_queue(&self) {
        if !cfg!(debug_assertions) {
            return;
        }
        log!("IPC message queue ({} items)", self.queue.len());
        for item in &self.queue {
            if item.data.list.len() > 100 {
                log!(
                    " {}|{}",
                    item.data.cursor,
                    item.data.list.len() - item.data.cursor
                );
            } else {
                log!(
                    "  \"{}\"|\"{}\"",
                    bstr::BStr::new(&item.data.list[0..item.data.cursor]),
                    bstr::BStr::new(&item.data.list[item.data.cursor..])
                );
            }
        }
    }

    fn get_socket(&self) -> Option<&SocketType> {
        match &self.socket {
            SocketUnion::Open(s) => Some(s),
            _ => None,
        }
    }

    /// starts a write request. on posix, this always calls _onWriteComplete immediately. on windows, it may
    /// call _onWriteComplete later.
    ///
    /// The outbound bytes are read from `self.queue[0]` *inside* this method so
    /// the caller never passes a slice that borrows `self` into a `&mut self`
    /// receiver (which would violate Stacked Borrows).
    fn _write(&mut self, fd: Option<Fd>) {
        if self.get_socket().is_none() {
            self._on_write_complete(-1);
            return;
        }
        #[cfg(windows)]
        {
            let socket = *self.get_socket().unwrap();
            if let Some(_) = fd {
                // TODO: send fd on windows
            }
            let pipe: *mut uv::Pipe = socket;

            // Copy the outbound bytes into an owned buffer while only holding a
            // shared borrow of `self.queue`; all `&mut self` mutation happens
            // after this block ends.
            let write_req_slice: Box<[u8]> = {
                let first = &self.queue[0];
                let data = &first.data.list[first.data.cursor..];
                log!("SendQueue#_write len {}", data.len());
                let write_len = data.len().min(i32::MAX as usize);
                Box::from(&data[0..write_len])
            };

            // create write request
            let mut write_req = Box::new(WindowsWrite {
                owner: Some(self as *mut SendQueue),
                write_slice: write_req_slice,
                // SAFETY: all-zero is a valid uv_write_t (C struct, initialized by uv_write).
                write_req: unsafe { core::mem::zeroed() },
                write_buffer: uv::uv_buf_t::init(b""), // re-init below after slice address is stable
            });
            write_req.write_buffer = uv::uv_buf_t::init(&write_req.write_slice);
            // Hand ownership to libuv; reclaimed exactly once by
            // `_windows_on_write_complete` via `WindowsWrite::destroy`.
            let write_req: *mut WindowsWrite = Box::into_raw(write_req);
            debug_assert!(self.windows.windows_write.is_none());
            self.windows.windows_write = Some(write_req);

            // SAFETY: pipe is live (socket == .open).
            unsafe { (*pipe).ref_() }; // ref on write
            // SAFETY: `write_req` is a freshly-leaked Box; libuv owns it until
            // the write callback fires.
            let result = unsafe {
                (*write_req).write_req.write(
                    (*pipe).as_stream(),
                    &mut (*write_req).write_buffer,
                    write_req,
                    Self::_windows_on_write_complete,
                )
            };
            if let Some(err) = result.as_err() {
                Self::_windows_on_write_complete(
                    write_req,
                    uv::ReturnCode::from_raw(-(err.errno as c_int)),
                );
            }
            // write request is queued. it will call _onWriteComplete when it completes.
        }
        #[cfg(not(windows))]
        {
            let socket = *self.get_socket().unwrap();
            // Compute the write result while only holding a *shared* borrow of
            // `self.queue[0]`; `_on_write_complete` (which may pop the queue)
            // runs after that borrow has ended.
            let n: i32 = {
                let first = &self.queue[0];
                let data = &first.data.list[first.data.cursor..];
                log!("SendQueue#_write len {}", data.len());
                if let Some(fd_unwrapped) = fd {
                    socket.write_fd(data, fd_unwrapped.native())
                } else {
                    socket.write(data)
                }
            };
            self._on_write_complete(n);
        }
    }

    #[cfg(windows)]
    fn _windows_on_write_complete(write_req: *mut WindowsWrite, status: uv::ReturnCode) {
        log!("SendQueue#_windowsOnWriteComplete");
        // SAFETY: write_req was passed to uv_write as the data ptr; libuv hands it back here.
        let write_len = unsafe { (*write_req).write_slice.len() };
        let this: *mut SendQueue = 'blk: {
            let owner = unsafe { (*write_req).owner };
            WindowsWrite::destroy(write_req);
            match owner {
                Some(o) => break 'blk o,
                None => return, // orelse case if disconnected before the write completes
            }
        };
        // SAFETY: owner is a BACKREF into the live SendQueue (cleared in _socket_closed if not).
        let this: &mut SendQueue = unsafe { &mut *this };

        let vm = VirtualMachine::get();
        vm.event_loop().enter();
        // TODO(port): errdefer — scopeguard for event_loop().exit()

        this.windows.windows_write = None;
        if let Some(socket) = this.get_socket() {
            // SAFETY: socket is a live uv_pipe_t.
            unsafe { (*socket).unref() }; // write complete; unref
        }
        if status.to_error(uv::Op::Write).is_some() {
            this._on_write_complete(-1);
        } else {
            this._on_write_complete(i32::try_from(write_len).unwrap());
        }

        if this.windows.try_close_after_write {
            this.close_socket(CloseReason::Normal, CloseFrom::User);
        }

        vm.event_loop().exit();
    }
    fn get_global_this(&self) -> &'static JSGlobalObject {
        // PORT NOTE: lifetime detached from `&self` so callers can hold the
        // global across `&mut self` borrows (Zig passes `*JSGlobalObject` by
        // raw pointer everywhere). The owner (Subprocess / IPCInstance)
        // outlives this SendQueue and the JSGlobalObject is heap-allocated by
        // JSC for the VM's lifetime, so the 'static erase is sound here.
        // SAFETY: see above — BACKREF through owner trait object.
        unsafe { &*(*self.owner).global_this() }
    }

    #[cfg(windows)]
    extern "C" fn on_server_pipe_close(this: *mut uv::Pipe) {
        // safely free the pipes
        // SAFETY: pipe was Box::into_raw'd by the caller that configured it.
        let _ = unsafe { Box::from_raw(this) };
    }

    #[cfg(windows)]
    pub fn windows_configure_server(
        &mut self,
        ipc_pipe: *mut uv::Pipe,
    ) -> bun_sys::Result<()> {
        log!("configureServer");
        // SAFETY: ipc_pipe is a live uv_pipe_t handed in by the caller.
        unsafe {
            (*ipc_pipe).data = (self as *mut SendQueue).cast();
            (*ipc_pipe).unref();
        }
        self.socket = SocketUnion::Open(ipc_pipe);
        self.windows.is_server = true;
        let pipe: *mut uv::Pipe = match self.socket {
            SocketUnion::Open(p) => p,
            _ => unreachable!(),
        };
        // SAFETY: pipe is the live uv handle just stored in self.socket.
        unsafe { (*pipe).data = (self as *mut SendQueue).cast() };

        // SAFETY: pipe is the live uv handle just stored in self.socket.
        let stream: *mut uv::uv_stream_t = unsafe { (*pipe).as_stream() };

        // SAFETY: stream points to the live uv handle just stored in self.socket.
        let read_start_result = unsafe {
            (*stream).read_start(
                self,
                IPCHandlers::WindowsNamedPipe::on_read_alloc,
                IPCHandlers::WindowsNamedPipe::on_read_error,
                IPCHandlers::WindowsNamedPipe::on_read,
            )
        };
        if read_start_result.is_err() {
            self.close_socket(CloseReason::Failure, CloseFrom::User);
            return read_start_result;
        }
        bun_sys::Result::Ok(())
    }

    #[cfg(windows)]
    pub fn windows_configure_client(&mut self, pipe_fd: Fd) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        log!("configureClient");
        // SAFETY: all-zero is a valid uv::Pipe (C struct, initialized by uv_pipe_init).
        let ipc_pipe: *mut uv::Pipe =
            Box::into_raw(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }));
        // SAFETY: ipc_pipe just allocated above.
        if let Err(err) = unsafe { (*ipc_pipe).init(uv::Loop::get(), true) }.unwrap_() {
            // SAFETY: ipc_pipe was Box::into_raw'd above and init failed before libuv took ownership.
            let _ = unsafe { Box::from_raw(ipc_pipe) };
            return Err(err.into());
        }
        // SAFETY: ipc_pipe is a live initialized uv_pipe_t.
        if let Err(err) = unsafe { (*ipc_pipe).open(pipe_fd) }.unwrap_() {
            // SAFETY: ipc_pipe is a live initialized uv_pipe_t; close_and_destroy frees the Box.
            unsafe { (*ipc_pipe).close_and_destroy() };
            return Err(err.into());
        }
        // SAFETY: ipc_pipe is a live initialized uv_pipe_t.
        unsafe { (*ipc_pipe).unref() };
        self.socket = SocketUnion::Open(ipc_pipe);
        self.windows.is_server = false;

        // SAFETY: ipc_pipe is the live uv handle just stored in self.socket.
        let stream = unsafe { (*ipc_pipe).as_stream() };

        // SAFETY: stream points to the live uv handle just stored in self.socket.
        if let Err(err) = unsafe {
            (*stream).read_start(
                self,
                IPCHandlers::WindowsNamedPipe::on_read_alloc,
                IPCHandlers::WindowsNamedPipe::on_read_error,
                IPCHandlers::WindowsNamedPipe::on_read,
            )
        }
        .unwrap_()
        {
            self.close_socket(CloseReason::Failure, CloseFrom::User);
            return Err(err.into());
        }
        Ok(())
    }
}

impl Drop for SendQueue {
    fn drop(&mut self) {
        log!("SendQueue#deinit");
        // must go first
        self.close_socket(CloseReason::Failure, CloseFrom::Deinit);

        // queue items / internal_msg_queue / incoming / waiting_for_ack: Drop handles them.

        // An SCM_RIGHTS fd can be stashed by `onFd` and not yet consumed by
        // the `NODE_HANDLE` decoder when the socket closes.
        if let Some(fd) = self.incoming_fd.take() {
            FdExt::close(fd);
        }

        // if there is a close next tick task, cancel it so it doesn't get called and then UAF
        if let Some(close_next_tick_task) = self.close_next_tick {
            // SAFETY: the task was created via `ManagedTask::new` (tag ==
            // ManagedTask) and `Task.ptr` is the Box::into_raw'd ManagedTask.
            let managed: &mut ManagedTask =
                unsafe { &mut *(close_next_tick_task.ptr.cast::<ManagedTask>()) };
            managed.cancel();
        }
        // Same for the close-notification task. `closeSocket` above may have
        // just enqueued this (VM-shutdown path with the socket still open),
        // or it may be left over from an earlier `_socketClosed` that hasn't
        // drained yet; either way the owner is about to free our storage.
        if let Some(after_close_task) = self.after_close_task {
            // SAFETY: see above.
            let managed: &mut ManagedTask =
                unsafe { &mut *(after_close_task.ptr.cast::<ManagedTask>()) };
            managed.cancel();
            self.after_close_task = None;
        }
    }
}

const MAX_HANDLE_RETRANSMISSIONS: u32 = 3;

#[crate::host_fn]
fn emit_process_error_event(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [ex] = callframe.arguments_as_array::<1>();
    (ipc_hooks().process_emit_error_event)(global_this, ex);
    Ok(JSValue::UNDEFINED)
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum FromEnum {
    SubprocessExited,
    Subprocess,
    Process,
}

fn do_send_err(
    global_object: &JSGlobalObject,
    callback: JSValue,
    ex: JSValue,
    from: FromEnum,
) -> JsResult<JSValue> {
    if callback.is_callable() {
        js_value_call_next_tick_1(callback, global_object, ex)?;
        return Ok(JSValue::FALSE);
    }
    if from == FromEnum::Process {
        let target = jsc::JSFunction::create(
            global_object,
            BunString::empty(),
            // `#[crate::host_fn]` emits the C-ABI shim under this name; the
            // safe `emit_process_error_event` is `JSHostFnZig`, not `JSHostFn`.
            __jsc_host_emit_process_error_event,
            1,
            Default::default(),
        );
        js_value_call_next_tick_1(target, global_object, ex)?;
        return Ok(JSValue::FALSE);
    }
    // Bun.spawn().send() should throw an error (unless callback is passed)
    Err(global_object.throw_value(ex))
}

pub fn do_send(
    ipc: Option<&mut SendQueue>,
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
    from: FromEnum,
) -> JsResult<JSValue> {
    let [mut message, mut handle, options_, mut callback] =
        call_frame.arguments_as_array::<4>();

    if handle.is_callable() {
        callback = handle;
        handle = JSValue::UNDEFINED;
    } else if options_.is_callable() {
        callback = options_;
    } else if !options_.is_undefined() {
        global_object.validate_object("options", options_, Default::default())?;
    }

    let connected = ipc.as_ref().map_or(false, |i| i.is_connected());
    if !connected {
        let msg = match from {
            FromEnum::Process => "process.send() can only be used if the IPC channel is open.",
            FromEnum::Subprocess => {
                "Subprocess.send() can only be used if an IPC channel is open."
            }
            FromEnum::SubprocessExited => {
                "Subprocess.send() cannot be used after the process has exited."
            }
        };
        let ex = jsc::ErrorBuilder::new(
            global_object,
            jsc::ErrorCode::IPC_CHANNEL_CLOSED,
            format_args!("{}", msg),
        )
        .to_js();
        return do_send_err(global_object, callback, ex, from);
    }

    let ipc_data = ipc.unwrap();

    if message.is_undefined() {
        // `JSGlobalObject::throw_missing_arguments_value` (gated) — single-arg case.
        return Err(jsc::ErrorBuilder::new(
            global_object,
            jsc::ErrorCode::MISSING_ARGS,
            format_args!("The \"message\" argument must be specified"),
        )
        .throw());
    }
    if !message.is_string()
        && !message.is_object()
        && !message.is_number()
        && !message.is_boolean()
        && !message.is_null()
    {
        // `JSGlobalObject::throw_invalid_argument_type_value_one_of` (gated).
        // TODO(port): include `determine_specific_type(message)` in the message
        // once that helper is available on the stub `JSGlobalObject`.
        let _ = message;
        return Err(jsc::ErrorBuilder::new(
            global_object,
            jsc::ErrorCode::INVALID_ARG_TYPE,
            format_args!(
                "The \"message\" argument must be one of type string, object, number, or boolean"
            ),
        )
        .throw());
    }

    if !handle.is_undefined_or_null() {
        let serialized_array: JSValue = ipc_serialize(global_object, message, handle)?;
        if serialized_array.is_undefined_or_null() {
            handle = JSValue::UNDEFINED;
        } else {
            let serialized_handle = serialized_array.get_index(global_object, 0)?;
            let serialized_message = serialized_array.get_index(global_object, 1)?;
            handle = serialized_handle;
            message = serialized_message;
        }
    }

    let mut zig_handle: Option<Handle> = None;
    if !handle.is_undefined_or_null() {
        // `bun.jsc.API.Listener` lives in `bun_runtime`; cycle-broken via hook.
        if let Some(fd) = (ipc_hooks().listener_fd_from_js)(handle) {
            log!("got listener");
            zig_handle = Some(Handle::init(fd, handle));
        }
    }

    let status =
        ipc_data.serialize_and_send(global_object, message, IsInternal::External, callback, zig_handle);

    if status == SerializeAndSendResult::Failure {
        let ex =
            global_object.create_type_error_instance(format_args!("process.send() failed"));
        // `JSValue.putZigString` → thin wrapper over `JSC__JSValue__put`; the
        // ported `JSValue::put` takes the key as `&[u8]` directly.
        ex.put(
            global_object,
            b"syscall",
            crate::bun_string_jsc::to_js(&BunString::static_(b"write"), global_object)?,
        );
        return do_send_err(global_object, callback, ex, from);
    }

    // in the success or backoff case, serializeAndSend will handle calling the callback
    Ok(if status == SerializeAndSendResult::Success {
        JSValue::TRUE
    } else {
        JSValue::FALSE
    })
}

#[crate::host_fn]
pub fn emit_handle_ipc_message(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [target, message, handle] = callframe.arguments_as_array::<3>();
    if !target.is_null() && !target.is_cell() {
        return Ok(JSValue::UNDEFINED);
    }
    // Dispatch to `Subprocess` / `IPCInstance` lives in `bun_runtime`; route
    // through the registered hook (cycle-break).
    (ipc_hooks().emit_handle_ipc_message)(
        global_this,
        target,
        DecodedIPCMessage::Data(message),
        handle,
    );
    Ok(JSValue::UNDEFINED)
}

enum IPCCommand {
    Handle(JSValue),
    Ack,
    Nack,
}

fn handle_ipc_message(
    send_queue: &mut SendQueue,
    message: DecodedIPCMessage,
    global_this: &JSGlobalObject,
) {
    #[cfg(debug_assertions)]
    {
        // PORT NOTE: Zig formats the JSValue via ConsoleObject.Formatter for
        // the scoped log; the Rust `Formatter` has no `Default` and threading
        // it through here pulls in the full table-printer machinery for a
        // debug-only log line. Log the variant tag instead.
        // TODO(port): wire `console_object::Formatter::new(global_this)` once
        // its construction stabilises.
        let _ = global_this;
        match &message {
            DecodedIPCMessage::Version(version) => {
                log!("received ipc message: version: {}", version)
            }
            DecodedIPCMessage::Data(_) => log!("received ipc message: \\<data>"),
            DecodedIPCMessage::Internal(_) => log!("received ipc message: internal"),
        }
    }
    let mut internal_command: Option<IPCCommand> = None;
    'handle_message: {
        if let DecodedIPCMessage::Data(msg_data) = &message {
            let msg_data = *msg_data;
            if msg_data.is_object() {
                let cmd = match msg_data.fast_get(global_this, jsc::BuiltinName::cmd) {
                    Err(_) => {
                        global_clear_exception(global_this);
                        break 'handle_message;
                    }
                    Ok(None) => break 'handle_message,
                    Ok(Some(v)) => v,
                };
                if cmd.is_string() {
                    if !cmd.is_cell() {
                        break 'handle_message;
                    }
                    let cmd_str = match crate::bun_string_jsc::from_js(cmd, global_this) {
                        Ok(s) => s,
                        Err(e) => {
                            let _ = global_this.take_exception(e);
                            break 'handle_message;
                        }
                    };
                    if cmd_str.eql_comptime(b"NODE_HANDLE") {
                        internal_command = Some(IPCCommand::Handle(msg_data));
                    } else if cmd_str.eql_comptime(b"NODE_HANDLE_ACK") {
                        internal_command = Some(IPCCommand::Ack);
                    } else if cmd_str.eql_comptime(b"NODE_HANDLE_NACK") {
                        internal_command = Some(IPCCommand::Nack);
                    }
                }
            }
        }
    }

    if let Some(icmd) = internal_command {
        match icmd {
            IPCCommand::Handle(msg_data) => {
                // Handle NODE_HANDLE message
                let ack = send_queue.incoming_fd.is_some();

                let packet = if ack {
                    get_ack_packet(send_queue.mode)
                } else {
                    get_nack_packet(send_queue.mode)
                };
                let mut handle = SendHandle {
                    data: StreamBuffer::default(),
                    handle: None,
                    callbacks: CallbackList::AckNack,
                };
                let _ = handle.data.write(packet);

                // Insert at appropriate position in send queue
                send_queue.insert_message(handle);

                // Send if needed
                log!("IPC call continueSend() from handleIPCMessage");
                send_queue.continue_send(global_this, ContinueSendReason::NewMessageAppended);

                if !ack {
                    return;
                }

                // Get file descriptor and clear it
                let fd: Fd = send_queue.incoming_fd.take().unwrap();

                let target: JSValue = match send_queue.owner.kind {
                    SendQueueOwnerKind::Subprocess => send_queue.owner.this_jsvalue(),
                    SendQueueOwnerKind::VirtualMachine => JSValue::NULL,
                };

                // `event_loop()` takes `&self`; never materialize
                // `&mut VirtualMachine` from the shared `bun_vm()` borrow
                // (Stacked-Borrows UB). Keep `vm` as `&VirtualMachine`.
                let vm = global_this.bun_vm();
                // SAFETY: `event_loop()` returns the VM-owned `*mut EventLoop`;
                // it stays live for the duration of the VM. Reborrow per use to
                // avoid holding `&mut EventLoop` across the call below.
                unsafe { (*(*vm).event_loop()).enter() };
                // TODO(port): errdefer — scopeguard for event_loop().exit()
                // FD.toJS — `uv()` is the user-visible numeric fd on both
                // platforms (posix == native, windows == uv_file).
                let fd_js = JSValue::js_number_from_int32(fd.uv());
                let res = ipc_parse(global_this, target, msg_data, fd_js);
                if let Err(e) = res {
                    // ack written already, that's okay.
                    global_this.report_active_exception_as_unhandled(e);
                    unsafe { (*(*vm).event_loop()).exit() };
                    return;
                }
                unsafe { (*(*vm).event_loop()).exit() };

                // ipc_parse will call the callback which calls handleIPCMessage()
                // we have sent the ack already so the next message could arrive at any time. maybe even before
                // parseHandle calls emit(). however, node does this too and its messages don't end up out of order.
                // so hopefully ours won't either.
                return;
            }
            IPCCommand::Ack => {
                send_queue.on_ack_nack(global_this, AckNack::Ack);
                return;
            }
            IPCCommand::Nack => {
                send_queue.on_ack_nack(global_this, AckNack::Nack);
                return;
            }
        }
    } else {
        send_queue.owner.handle_ipc_message(message, JSValue::UNDEFINED);
    }
}

fn on_data2(send_queue: &mut SendQueue, all_data: &[u8]) {
    let mut data = all_data;
    // log("onData '{'}'", .{std.zig.fmtString(data)});

    // In the VirtualMachine case, `globalThis` is an optional, in case
    // the vm is freed before the socket closes.
    let global_this = send_queue.get_global_this();

    // Decode the message with just the temporary buffer, and if that
    // fails (not enough bytes) then we allocate to .ipc_buffer
    // PORT NOTE: reshaped for borrowck — match on raw discriminant pointer to allow
    // calling &mut self methods on send_queue inside arms.
    match &mut send_queue.incoming {
        IncomingBuffer::Json(_) => {
            // JSON mode: append to buffer (scans only new data for newline),
            // then process complete messages using next().
            let IncomingBuffer::Json(json_buf) = &mut send_queue.incoming else {
                unreachable!()
            };
            json_buf.append(data);

            loop {
                let IncomingBuffer::Json(json_buf) = &mut send_queue.incoming else {
                    unreachable!()
                };
                let Some(msg) = json_buf.next() else { break };
                let result = match decode_ipc_message(
                    Mode::Json,
                    msg.data,
                    global_this,
                    Some(msg.newline_pos),
                ) {
                    Ok(r) => r,
                    Err(IPCDecodeError::NotEnoughBytes) => {
                        log!("hit NotEnoughBytes");
                        return;
                    }
                    Err(
                        IPCDecodeError::InvalidFormat
                        | IPCDecodeError::JSError
                        | IPCDecodeError::JSTerminated,
                    ) => {
                        send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                        return;
                    }
                    Err(IPCDecodeError::OutOfMemory) => {
                        Output::print_errorln("IPC message is too long.");
                        send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                        return;
                    }
                };

                let bytes_consumed = result.bytes_consumed;
                handle_ipc_message(send_queue, result.message, global_this);
                let IncomingBuffer::Json(json_buf) = &mut send_queue.incoming else {
                    unreachable!()
                };
                json_buf.consume(bytes_consumed);
            }
        }
        IncomingBuffer::Advanced(_) => {
            // Advanced mode: uses length-prefix, no newline scanning needed.
            // Try to decode directly first, only buffer if needed.
            let IncomingBuffer::Advanced(adv_buf) = &mut send_queue.incoming else {
                unreachable!()
            };
            if adv_buf.len == 0 {
                loop {
                    let result =
                        match decode_ipc_message(Mode::Advanced, data, global_this, None) {
                            Ok(r) => r,
                            Err(IPCDecodeError::NotEnoughBytes) => {
                                let IncomingBuffer::Advanced(adv_buf) =
                                    &mut send_queue.incoming
                                else {
                                    unreachable!()
                                };
                                let _ = adv_buf.write(data);
                                log!("hit NotEnoughBytes");
                                return;
                            }
                            Err(
                                IPCDecodeError::InvalidFormat
                                | IPCDecodeError::JSError
                                | IPCDecodeError::JSTerminated,
                            ) => {
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                return;
                            }
                            Err(IPCDecodeError::OutOfMemory) => {
                                Output::print_errorln("IPC message is too long.");
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                return;
                            }
                        };

                    handle_ipc_message(send_queue, result.message, global_this);

                    if (result.bytes_consumed as usize) < data.len() {
                        data = &data[result.bytes_consumed as usize..];
                    } else {
                        return;
                    }
                }
            }

            // Buffer has existing data, append and process
            let IncomingBuffer::Advanced(adv_buf) = &mut send_queue.incoming else {
                unreachable!()
            };
            let _ = adv_buf.write(data);
            let mut slice_start: usize = 0;
            loop {
                let IncomingBuffer::Advanced(adv_buf) = &mut send_queue.incoming else {
                    unreachable!()
                };
                let slice = &adv_buf.slice()[slice_start..];
                let result =
                    match decode_ipc_message(Mode::Advanced, slice, global_this, None) {
                        Ok(r) => r,
                        Err(IPCDecodeError::NotEnoughBytes) => {
                            let slice_len = slice.len();
                            // copy the remaining bytes to the start of the buffer
                            // SAFETY: src/dst may overlap; use ptr::copy (memmove).
                            unsafe {
                                let base = adv_buf.ptr.as_ptr();
                                core::ptr::copy(base.add(slice_start), base, slice_len);
                            }
                            debug_assert!(slice_len <= u32::MAX as usize);
                            adv_buf.len = u32::try_from(slice_len).unwrap();
                            log!("hit NotEnoughBytes2");
                            return;
                        }
                        Err(
                            IPCDecodeError::InvalidFormat
                            | IPCDecodeError::JSError
                            | IPCDecodeError::JSTerminated,
                        ) => {
                            send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                            return;
                        }
                        Err(IPCDecodeError::OutOfMemory) => {
                            Output::print_errorln("IPC message is too long.");
                            send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                            return;
                        }
                    };

                let slice_len = slice.len();
                handle_ipc_message(send_queue, result.message, global_this);

                if (result.bytes_consumed as usize) < slice_len {
                    slice_start += result.bytes_consumed as usize;
                } else {
                    let IncomingBuffer::Advanced(adv_buf) = &mut send_queue.incoming else {
                        unreachable!()
                    };
                    adv_buf.len = 0;
                    return;
                }
            }
        }
    }
}

/// Used on POSIX
#[allow(non_snake_case)]
pub mod IPCHandlers {
    use super::*;

    pub mod PosixSocket {
        use super::*;

        pub fn on_open(_: *mut c_void, _: Socket) {
            log!("onOpen");
            // it is NOT safe to use the first argument here because it has not been initialized yet.
            // ideally we would call .ipc.writeVersionPacket() here, and we need that to handle the
            // theoretical write failure, but since the .ipc.outgoing buffer isn't available, that
            // data has nowhere to go.
            //
            // therefore, initializers of IPC handlers need to call .ipc.writeVersionPacket() themselves
            // this is covered by an assertion.
        }

        pub fn on_close(send_queue: &mut SendQueue, _: Socket, _: c_int, _: Option<*mut c_void>) {
            // uSockets has already freed the underlying socket
            log!("NewSocketIPCHandler#onClose\n");
            send_queue._socket_closed();
        }

        pub fn on_data(send_queue: &mut SendQueue, _: Socket, all_data: &[u8]) {
            let global_this = send_queue.get_global_this();
            // `event_loop()` takes `&self`; never materialize
            // `&mut VirtualMachine` from the shared `bun_vm()` borrow
            // (Stacked-Borrows UB).
            let loop_ = global_this.bun_vm().event_loop();
            // SAFETY: `loop_` is the VM-owned `*mut EventLoop` (lives as long
            // as the VM); reborrow per use so `&mut EventLoop` isn't held
            // across `on_data2`.
            unsafe { (*loop_).enter() };
            let _exit = scopeguard::guard((), |()| unsafe { (*loop_).exit() });
            on_data2(send_queue, all_data);
        }

        pub fn on_fd(send_queue: &mut SendQueue, _: Socket, fd: c_int) {
            // SCM_RIGHTS is POSIX-only; on Windows this arm is unreachable but
            // still type-checked, and `FD.fromNative` takes `*anyopaque` there.
            #[cfg(windows)]
            {
                let _ = (send_queue, fd);
                return;
            }
            #[cfg(not(windows))]
            {
                log!("onFd: {}", fd);
                if send_queue.incoming_fd.is_some() {
                    log!("onFd: incoming_fd already set; overwriting");
                }
                send_queue.incoming_fd = Some(Fd::from_native(fd));
            }
        }

        pub fn on_writable(send_queue: &mut SendQueue, _: Socket) {
            log!("onWritable");

            let global_this = send_queue.get_global_this();
            // See on_data — `event_loop()` takes `&self`; no `&mut VirtualMachine`.
            let loop_ = global_this.bun_vm().event_loop();
            // SAFETY: see `on_data` — VM-owned `*mut EventLoop`, per-use reborrow.
            unsafe { (*loop_).enter() };
            let _exit = scopeguard::guard((), |()| unsafe { (*loop_).exit() });
            log!("IPC call continueSend() from onWritable");
            send_queue.continue_send(global_this, ContinueSendReason::OnWritable);
        }

        pub fn on_timeout(_: &mut SendQueue, _: Socket) {
            log!("onTimeout");
            // unref if needed
        }

        pub fn on_long_timeout(_: &mut SendQueue, _: Socket) {
            log!("onLongTimeout");
            // onLongTimeout
        }

        pub fn on_connect_error(send_queue: &mut SendQueue, _: Socket, _: c_int) {
            log!("onConnectError");
            // context has not been initialized
            send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
        }

        pub fn on_end(send_queue: &mut SendQueue, _: Socket) {
            log!("onEnd");
            send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
        }
    }

    pub mod WindowsNamedPipe {
        use super::*;

        pub fn on_read_alloc(send_queue: &mut SendQueue, suggested_size: usize) -> &mut [u8] {
            // PORT NOTE: ByteList::unused_capacity_slice() yields
            // `&mut [MaybeUninit<u8>]`; libuv only needs the (ptr,len) — it
            // never reads the uninit bytes, only writes them. Cast through raw
            // parts to hand back `&mut [u8]` (matches Zig allocatedSlice()).
            match &mut send_queue.incoming {
                IncomingBuffer::Json(json_buf) => {
                    if json_buf.unused_capacity_slice().len() < suggested_size {
                        json_buf.ensure_unused_capacity(suggested_size);
                    }
                    let available = json_buf.unused_capacity_slice();
                    log!("NewNamedPipeIPCHandler#onReadAlloc {}", suggested_size);
                    // SAFETY: returning a sub-slice of the unused-capacity
                    // region; libuv writes into it before notify_written reads.
                    unsafe {
                        core::slice::from_raw_parts_mut(
                            available.as_mut_ptr().cast::<u8>(),
                            suggested_size,
                        )
                    }
                }
                IncomingBuffer::Advanced(adv_buf) => {
                    if adv_buf.unused_capacity_slice().len() < suggested_size {
                        let _ = adv_buf.ensure_unused_capacity(suggested_size);
                    }
                    let available = adv_buf.unused_capacity_slice();
                    log!("NewNamedPipeIPCHandler#onReadAlloc {}", suggested_size);
                    // SAFETY: same as above.
                    unsafe {
                        core::slice::from_raw_parts_mut(
                            available.as_mut_ptr().cast::<u8>(),
                            suggested_size,
                        )
                    }
                }
            }
        }

        pub fn on_read_error(send_queue: &mut SendQueue, err: bun_sys::E) {
            log!("NewNamedPipeIPCHandler#onReadError {:?}", err);
            send_queue.close_socket_next_tick(true);
        }

        pub fn on_read(send_queue: &mut SendQueue, buffer: &[u8]) {
            log!("NewNamedPipeIPCHandler#onRead {}", buffer.len());
            let global_this = send_queue.get_global_this();
            // See PosixSocket::on_data — `event_loop()` takes `&self`; no
            // `&mut VirtualMachine`.
            let loop_ = global_this.bun_vm().event_loop();
            // SAFETY: `loop_` is the VM-owned `*mut EventLoop` (lives as long
            // as the VM); reborrow at each enter/exit so `&mut EventLoop` isn't
            // held across the decode loop or send_queue borrows below.
            unsafe { (*loop_).enter() };
            let _exit = scopeguard::guard((), |()| unsafe { (*loop_).exit() });

            match &mut send_queue.incoming {
                IncomingBuffer::Json(_) => {
                    // For JSON mode on Windows, use notifyWritten to update length and scan for newlines
                    let IncomingBuffer::Json(json_buf) = &mut send_queue.incoming else {
                        unreachable!()
                    };
                    debug_assert!(
                        json_buf.data.len as usize + buffer.len() <= json_buf.data.cap as usize
                    );
                    // SAFETY: allocated_slice() yields `[MaybeUninit<u8>]`; we
                    // only inspect its address range here, never read its bytes.
                    debug_assert!(bun_core::is_slice_in_buffer(buffer, unsafe {
                        core::slice::from_raw_parts(
                            json_buf.data.ptr.as_ptr().cast::<u8>(),
                            json_buf.data.cap as usize,
                        )
                    }));

                    json_buf.notify_written(buffer);

                    // Process complete messages using next() - avoids O(n²) re-scanning
                    loop {
                        let IncomingBuffer::Json(json_buf) = &mut send_queue.incoming else {
                            unreachable!()
                        };
                        let Some(msg) = json_buf.next() else { break };
                        let result = match decode_ipc_message(
                            Mode::Json,
                            msg.data,
                            global_this,
                            Some(msg.newline_pos),
                        ) {
                            Ok(r) => r,
                            Err(IPCDecodeError::NotEnoughBytes) => {
                                log!("hit NotEnoughBytes3");
                                return;
                            }
                            Err(
                                IPCDecodeError::InvalidFormat
                                | IPCDecodeError::JSError
                                | IPCDecodeError::JSTerminated,
                            ) => {
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                return;
                            }
                            Err(IPCDecodeError::OutOfMemory) => {
                                Output::print_errorln("IPC message is too long.");
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                return;
                            }
                        };

                        let bytes_consumed = result.bytes_consumed;
                        handle_ipc_message(send_queue, result.message, global_this);
                        let IncomingBuffer::Json(json_buf) = &mut send_queue.incoming else {
                            unreachable!()
                        };
                        json_buf.consume(bytes_consumed);
                    }
                }
                IncomingBuffer::Advanced(_) => {
                    let IncomingBuffer::Advanced(adv_buf) = &mut send_queue.incoming else {
                        unreachable!()
                    };
                    adv_buf.len = adv_buf
                        .len
                        .saturating_add(u32::try_from(buffer.len()).unwrap());
                    let total_len = adv_buf.len as usize;
                    let mut slice_start: usize = 0;

                    debug_assert!(adv_buf.len <= adv_buf.cap);
                    // SAFETY: allocated_slice() yields `[MaybeUninit<u8>]`; we
                    // only inspect its address range here, never read its bytes.
                    debug_assert!(bun_core::is_slice_in_buffer(buffer, unsafe {
                        core::slice::from_raw_parts(
                            adv_buf.ptr.as_ptr().cast::<u8>(),
                            adv_buf.cap as usize,
                        )
                    }));

                    loop {
                        let IncomingBuffer::Advanced(adv_buf) = &mut send_queue.incoming else {
                            unreachable!()
                        };
                        let slice = &adv_buf.slice()[slice_start..total_len];
                        let result = match decode_ipc_message(
                            Mode::Advanced,
                            slice,
                            global_this,
                            None,
                        ) {
                            Ok(r) => r,
                            Err(IPCDecodeError::NotEnoughBytes) => {
                                let slice_len = slice.len();
                                // copy the remaining bytes to the start of the buffer
                                // SAFETY: src/dst may overlap; ptr::copy is memmove.
                                unsafe {
                                    let base = adv_buf.ptr.as_ptr();
                                    core::ptr::copy(base.add(slice_start), base, slice_len);
                                }
                                // slice.len is guaranteed <= adv_buf.len (u32) since it's derived from adv_buf.slice()
                                debug_assert!(slice_len <= u32::MAX as usize);
                                adv_buf.len = u32::try_from(slice_len).unwrap();
                                log!("hit NotEnoughBytes3");
                                return;
                            }
                            Err(
                                IPCDecodeError::InvalidFormat
                                | IPCDecodeError::JSError
                                | IPCDecodeError::JSTerminated,
                            ) => {
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                return;
                            }
                            Err(IPCDecodeError::OutOfMemory) => {
                                Output::print_errorln("IPC message is too long.");
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                return;
                            }
                        };

                        let slice_len = slice.len();
                        handle_ipc_message(send_queue, result.message, global_this);

                        if (result.bytes_consumed as usize) < slice_len {
                            slice_start += result.bytes_consumed as usize;
                        } else {
                            // clear the buffer
                            let IncomingBuffer::Advanced(adv_buf) = &mut send_queue.incoming
                            else {
                                unreachable!()
                            };
                            adv_buf.len = 0;
                            return;
                        }
                    }
                }
            }
        }

        pub fn on_close(send_queue: &mut SendQueue) {
            log!("NewNamedPipeIPCHandler#onClose\n");
            // Currently unreferenced (only onReadAlloc/onReadError/onRead are
            // wired into readStart), but route through `_socketClosed` so any
            // future wiring tracks the `_onAfterIPCClosed` task for `deinit`
            // to cancel, matching every other close path.
            send_queue._socket_closed();
        }
    }
}

pub fn ipc_serialize(
    global_object: &JSGlobalObject,
    message: JSValue,
    handle: JSValue,
) -> JsResult<JSValue> {
    // TODO(port): move to jsc_sys
    unsafe extern "C" {
        fn IPCSerialize(
            global_object: *const JSGlobalObject,
            message: JSValue,
            handle: JSValue,
        ) -> JSValue;
    }
    // TODO(port): bun.cpp.IPCSerialize — verify exception-aware wrapper shape
    // SAFETY: FFI call into C++ binding; global_object is a valid &JSGlobalObject borrowed for
    // the call duration, and JSValue args are Copy stack values kept alive by conservative scan.
    let r = unsafe { IPCSerialize(global_object, message, handle) };
    if r.is_empty() {
        return Err(JsError::Thrown);
    }
    Ok(r)
}

pub fn ipc_parse(
    global_object: &JSGlobalObject,
    target: JSValue,
    serialized: JSValue,
    fd: JSValue,
) -> JsResult<JSValue> {
    // TODO(port): move to jsc_sys
    unsafe extern "C" {
        fn IPCParse(
            global_object: *const JSGlobalObject,
            target: JSValue,
            serialized: JSValue,
            fd: JSValue,
        ) -> JSValue;
    }
    // TODO(port): bun.cpp.IPCParse — verify exception-aware wrapper shape
    // SAFETY: FFI call into C++ binding; global_object is a valid &JSGlobalObject borrowed for
    // the call duration, and JSValue args are Copy stack values kept alive by conservative scan.
    let r = unsafe { IPCParse(global_object, target, serialized, fd) };
    if r.is_empty() {
        return Err(JsError::Thrown);
    }
    Ok(r)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ipc.zig (1545 lines)
//   confidence: medium
//   todos:      19
//   notes:      Body un-gated. ManagedTask/JSONLineBuffer real; Subprocess /
//               IPCInstance dispatch routed through SendQueueOwner vtable +
//               IPC_HOOKS (cycle-break to bun_runtime). WindowsWrite Box vs
//               raw-ptr ownership still conflicts with libuv callback
//               reclaim; on_data2/on_read reshaped heavily for borrowck
//               (re-match on send_queue.incoming each iteration); defer
//               update_ref/loop.exit inlined at returns pending scopeguard;
//               windows_configure_* / on_server_pipe_close cfg(windows)-gated
//               (SocketType differs by platform).
// ──────────────────────────────────────────────────────────────────────────
