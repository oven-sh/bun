use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::size_of;

use bun_jsc::JsCell;
use bun_ptr::RefPtr;

use crate::json_line_buffer::JSONLineBuffer;
use bun_collections::{ByteVecExt, VecExt};
use bun_core::{Output, handle_oom};
use bun_core::{String as BunString, strings};
use bun_io::KeepAlive;
use bun_io::StreamBuffer;
use bun_jsc as jsc;
use bun_jsc::js_value::Protected;
#[cfg(windows)]
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult, SerializedFlags, StringJsc as _, Task};
use bun_sys::Fd;
use bun_sys::FdExt;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
use bun_sys::windows::libuv::{UvHandle as _, UvStream as _};
use bun_uws;

// `bun.cpp.*` — generated C++ dispatch shims for IPC handle (de)serialization
// (`IPCSerialize` / `IPCParse`) are declared once in `bun_jsc::cpp` and called
// through that module's safe wrappers; no local extern block needed.

// `SendQueue.owner` is a [`SendQueueOwner`] enum over the two concrete owner
// types (`Subprocess`, parent side; `ipc_host::IPCInstance`, child side) —
// both nameable in this crate — stored as a BACKREF cleared before the owner
// drops.

// TODO: rewrite this code.
/// Queue for messages sent between parent and child processes in an IPC environment. node:cluster sends json serialized messages
/// to describe different events it performs. It will send a message with an incrementing sequence number and then call a callback
/// when a message is received with an 'ack' property of the same sequence number.
pub struct InternalMsgHolder {
    pub seq: i32,

    // TODO: move this to an Array or a JS Object or something which doesn't
    // individually create a Strong for every single IPC message...
    pub callbacks: bun_collections::ArrayHashMap<i32, bun_jsc::StrongOptional>,
    pub worker: bun_jsc::StrongOptional,
    pub cb: bun_jsc::StrongOptional,
    pub(crate) messages: Vec<bun_jsc::StrongOptional>,
}

impl Default for InternalMsgHolder {
    fn default() -> Self {
        Self {
            seq: 0,
            callbacks: bun_collections::ArrayHashMap::default(),
            worker: bun_jsc::StrongOptional::empty(),
            cb: bun_jsc::StrongOptional::empty(),
            messages: Vec::new(),
        }
    }
}

impl InternalMsgHolder {
    pub fn is_ready(&self) -> bool {
        self.worker.has() && self.cb.has()
    }

    pub(crate) fn enqueue(&mut self, message: JSValue, global: &JSGlobalObject) {
        self.messages
            .push(bun_jsc::StrongOptional::create(message, global));
    }

    pub fn dispatch(
        &mut self,
        message: JSValue,
        handle: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        if !self.is_ready() {
            // Queued messages drop their handle; the cluster listener is
            // installed before any handle-bearing reply can arrive.
            self.enqueue(message, global);
            return Ok(());
        }
        self.dispatch_unsafe(message, handle, global)
    }

    fn dispatch_unsafe(
        &mut self,
        message: JSValue,
        handle: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        let cb = self.cb.get().unwrap();
        let worker = self.worker.get().unwrap();

        let event_loop = global.bun_vm().event_loop_mut();

        event_loop.run_callback(cb, global, worker, &[message, handle]);
        Ok(())
    }

    pub fn flush(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        debug_assert!(self.is_ready());
        // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
        // `dispatch_unsafe` → `event_loop.run_callback` runs the JS IPC
        // listener which can re-enter via a fresh `&mut Self` from the
        // owner's `m_ctx` and write `self.cb` / `self.worker` /
        // `self.callbacks`. With the loop body inlined, LLVM was hoisting the
        // `self.cb`/`self.worker` reads (at the top of `dispatch_unsafe`) out
        // of the loop — ASM-verified PROVEN_CACHED. Launder so each iteration
        // re-reads through an opaque pointer.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` aliases the live `&mut self`; single JS thread.
        let messages = core::mem::take(unsafe { &mut (*this).messages });
        for strong in messages {
            if let Some(message) = strong.get() {
                // SAFETY: `this` is still live across re-entry — the IPC
                // dispatcher is owned by the Subprocess/Worker which outlives
                // this `flush` frame; `&mut *this` is the unique mutable view
                // for this call.
                unsafe { &mut *this }.dispatch_unsafe(message, JSValue::NULL, global)?;
            }
            // strong drops here (== `strong.deinit()`)
        }
        // messages Vec drops here (== `messages.deinit(bun.default_allocator)`)
        Ok(())
    }

    // `deinit` body only freed owned fields (Strongs, map, Vec). All of those impl Drop in
    // Rust, so no explicit Drop body is needed.
}

bun_core::define_scoped_log!(log, IPC, visible);

/// Union type that switches between simple Vec<u8> (for advanced mode)
/// and JSONLineBuffer (for JSON mode with optimized newline tracking).
enum IncomingBuffer {
    /// For advanced mode - uses length-prefix, no scanning needed
    Advanced(Vec<u8>),
    /// For JSON mode - tracks newline positions to avoid O(n²) scanning
    Json(JSONLineBuffer),
}

impl IncomingBuffer {
    fn init(mode: Mode) -> IncomingBuffer {
        match mode {
            Mode::Advanced => IncomingBuffer::Advanced(Vec::<u8>::default()),
            Mode::Json => IncomingBuffer::Json(JSONLineBuffer::default()),
        }
    }
}

// deinit: Vec<u8>/JSONLineBuffer own their storage and Drop frees it.

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

bun_core::comptime_string_map! {
    static MODE_MAP: Mode = {
        b"advanced" => Mode::Advanced,
        b"json" => Mode::Json,
    };
}

impl Mode {
    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Mode>> {
        use bun_jsc::ComptimeStringMapExt as _;
        if !value.is_string() {
            return Ok(None);
        }
        MODE_MAP.from_js(global, value)
    }
}

#[derive(Clone, Copy)]
pub enum DecodedIPCMessage {
    Version(u32),
    Data(JSValue),
    Internal(JSValue),
}

pub(crate) struct DecodeIPCMessageResult {
    pub(crate) bytes_consumed: u32,
    pub(crate) message: DecodedIPCMessage,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum IPCDecodeError {
    /// There werent enough bytes, recall this function again when new data is available.
    #[error("NotEnoughBytes")]
    NotEnoughBytes,
    /// Format could not be recognized. Report an error and close the socket.
    #[error("InvalidFormat")]
    InvalidFormat,
    /// The decode ran under a VM that is stopping (loop-level; not an exception).
    #[error("Stopped")]
    Stopped,
    #[error("{0:?}")]
    Js(JsError),
}

impl From<JsError> for IPCDecodeError {
    fn from(e: JsError) -> Self {
        IPCDecodeError::Js(e)
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
    #[error("OutOfMemory")]
    OutOfMemory,
}

impl From<JsError> for IPCSerializationError {
    fn from(e: JsError) -> Self {
        match e {
            JsError::Thrown | JsError::Terminated => IPCSerializationError::JSError,
            JsError::OutOfMemory => IPCSerializationError::OutOfMemory,
        }
    }
}

mod advanced {
    use super::*;

    const HEADER_LENGTH: usize = size_of::<IPCMessageType>() + size_of::<u32>();
    // HEADER_LENGTH is a 5-byte compile-time constant; narrowing to u32 is provably safe.
    const HEADER_LENGTH_U32: u32 = HEADER_LENGTH as u32;
    // v2 added `SerializedMessageWithBuffers`. The peer's advertised version is
    // debug-logged, never consulted, so mixed-version pairs only break when a
    // Buffer-bearing message actually crosses to a v1 peer.
    const VERSION: u32 = 2;

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub(super) enum IPCMessageType {
        Version = 1,
        SerializedMessage = 2,
        SerializedInternalMessage = 3,
        /// A `[message, buffers]` envelope so the receiver can restore Buffer prototypes (JSC's
        /// serializer has no host-object hook). Only emitted when Buffers are present, so plain
        /// messages keep the version-1 wire format.
        SerializedMessageWithBuffers = 4,
    }
    // SAFETY: `#[repr(u8)]` fieldless enum → size 1, align 1, no padding,
    // `Copy + 'static`; the single byte is always an initialized discriminant.
    unsafe impl bytemuck::NoUninit for IPCMessageType {}

    impl IPCMessageType {
        fn tag_name(raw: u8) -> &'static str {
            match raw {
                1 => "Version",
                2 => "SerializedMessage",
                3 => "SerializedInternalMessage",
                4 => "SerializedMessageWithBuffers",
                _ => "unknown",
            }
        }
    }

    static VERSION_PACKET_BYTES: [u8; HEADER_LENGTH] = {
        let v = VERSION.to_ne_bytes();
        [IPCMessageType::Version as u8, v[0], v[1], v[2], v[3]]
    };

    pub(super) fn decode_ipc_message(
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
        let message_len = u32::from_le_bytes(
            data[1..1 + size_of::<u32>()]
                .try_into()
                .expect("infallible: size matches"),
        );

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
                || x == IPCMessageType::SerializedInternalMessage as u8
                || x == IPCMessageType::SerializedMessageWithBuffers as u8 =>
            {
                if message_len > u32::MAX - HEADER_LENGTH_U32 {
                    return Err(IPCDecodeError::InvalidFormat);
                }
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
                let mut deserialized = JSValue::deserialize(message, global)?;
                if x == IPCMessageType::SerializedMessageWithBuffers as u8 {
                    deserialized = ipc_restore_advanced_buffers(global, deserialized)?;
                }

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
    pub(super) fn get_version_packet() -> &'static [u8] {
        &VERSION_PACKET_BYTES
    }
    pub(super) fn get_ack_packet() -> &'static [u8] {
        b"\x02\x24\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x0f\x00\x00\x80NODE_HANDLE_ACK\xff\xff\xff\xff"
    }
    pub(super) fn get_nack_packet() -> &'static [u8] {
        b"\x02\x25\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x10\x00\x00\x80NODE_HANDLE_NACK\xff\xff\xff\xff"
    }

    pub(super) fn serialize(
        writer: &mut StreamBuffer,
        global: &JSGlobalObject,
        value: JSValue,
        is_internal: IsInternal,
    ) -> Result<usize, IPCSerializationError> {
        // Internal (control) messages never carry user Buffers, and the
        // hardcoded ack/nack packets depend on their bare wire shape.
        let (value, message_type) = match is_internal {
            IsInternal::Internal => (value, IPCMessageType::SerializedInternalMessage),
            IsInternal::External => {
                let tagged = ipc_tag_advanced_buffers(global, value)?;
                if tagged.is_null() {
                    (value, IPCMessageType::SerializedMessage)
                } else {
                    (tagged, IPCMessageType::SerializedMessageWithBuffers)
                }
            }
        };

        let serialized = value.serialize(
            global,
            SerializedFlags {
                // IPC sends across process.
                for_cross_process_transfer: true,
                for_storage: false,
            },
        )?;
        // `serialized` Drops at scope exit (defer serialized.deinit()).

        let size: u32 = u32::try_from(serialized.data().len()).expect("int cast");

        let payload_length: usize = size_of::<IPCMessageType>() + size_of::<u32>() + size as usize;

        // Propagate OOM so serializeAndSend
        // returns `.failure` instead of silently discarding the Result.
        writer
            .ensure_unused_capacity(payload_length)
            .map_err(|_| IPCSerializationError::OutOfMemory)?;

        writer.write_type_as_bytes_assume_capacity(message_type);
        writer.write_type_as_bytes_assume_capacity(size);
        writer.write_assume_capacity(serialized.data());

        Ok(payload_length)
    }
}

mod json {
    use super::*;

    extern "C" fn json_ipc_data_string_free_cb(context: *mut bool, _: *mut c_void, _: usize) {
        // SAFETY: context points to `was_ascii_string_freed` on the caller's stack,
        // kept alive across the `drop(str)` in decode_ipc_message.
        unsafe { *context = true };
    }

    pub(super) fn get_version_packet() -> &'static [u8] {
        &[]
    }
    pub(super) fn get_ack_packet() -> &'static [u8] {
        b"{\"cmd\":\"NODE_HANDLE_ACK\"}\n"
    }
    pub(super) fn get_nack_packet() -> &'static [u8] {
        b"{\"cmd\":\"NODE_HANDLE_NACK\"}\n"
    }

    // In order to not have to do a property lookup internal messages sent from Bun will have a single u8 prepended to them
    // to be able to distinguish whether it is a regular json message or an internal one for cluster ipc communication.
    // 2 is internal
    // ["[{\d\.] is regular

    pub(super) fn decode_ipc_message(
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
                &raw mut was_ascii_string_freed,
                json_ipc_data_string_free_cb,
            );
            if s.tag() == bun_core::Tag::Dead {
                bun_core::hint::cold();
                return Err(IPCDecodeError::Js(JsError::OutOfMemory));
            }
            s
        } else {
            BunString::borrow_utf8(json_data)
        };

        // The ASCII-path free callback (`json_ipc_data_string_free_cb`) only
        // fires when the WTFStringImpl refcount hits zero — i.e. *during* the
        // drop — so the freed-flag check must follow it.
        let parsed = str.to_js_by_parse_json(global_this);
        drop(str);
        if is_ascii && !was_ascii_string_freed {
            panic!(
                "Expected ascii string to be freed by ExternalString, but it wasn't. This is a bug in Bun."
            );
        }
        let deserialized = match parsed {
            Ok(v) => v,
            Err(JsError::Terminated) => return Err(IPCDecodeError::Js(JsError::Terminated)),
            Err(JsError::Thrown) => {
                // A malformed message; a pending termination is not cleared by this and keeps unwinding.
                global_this.clear_exception();
                return Err(IPCDecodeError::InvalidFormat);
            }
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
        };

        match kind {
            Kind::Regular => Ok(DecodeIPCMessageResult {
                bytes_consumed: idx + 1,
                message: DecodedIPCMessage::Data(deserialized),
            }),
            Kind::Internal => Ok(DecodeIPCMessageResult {
                bytes_consumed: idx + 1,
                message: DecodedIPCMessage::Internal(deserialized),
            }),
        }
    }

    pub(super) fn serialize(
        writer: &mut StreamBuffer,
        global: &JSGlobalObject,
        value: JSValue,
        is_internal: IsInternal,
    ) -> Result<usize, IPCSerializationError> {
        // Use jsonStringifyFast which passes undefined for the space parameter,
        // triggering JSC's SIMD-optimized FastStringifier code path.
        let out = value.json_stringify_fast(global)?;

        if out.tag() == bun_core::Tag::Dead {
            return Err(IPCSerializationError::SerializationFailed);
        }

        // TODO: it would be cool to have a 'toUTF8Into' which can write directly into 'ipc_data.outgoing.list'
        let str = out.to_utf8();
        let slice = str.slice();

        let mut result_len: usize = slice.len() + 1;
        if is_internal == IsInternal::Internal {
            result_len += 1;
        }

        // Propagate OOM so serializeAndSend
        // returns `.failure` instead of silently discarding the Result.
        writer
            .ensure_unused_capacity(result_len)
            .map_err(|_| IPCSerializationError::OutOfMemory)?;

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
pub(crate) fn decode_ipc_message(
    mode: Mode,
    data: &[u8],
    global: &JSGlobalObject,
    known_newline: Option<u32>,
) -> Result<DecodeIPCMessageResult, IPCDecodeError> {
    // The previous message's JS handler may have taken a worker's termination
    // trap; JSONParse with it pending trips LiteralParser's state assert.
    if global.bun_vm().script_execution_status() != bun_jsc::ScriptExecutionStatus::Running {
        return Err(IPCDecodeError::Stopped);
    }
    match mode {
        Mode::Advanced => advanced::decode_ipc_message(data, global),
        Mode::Json => json::decode_ipc_message(data, global, known_newline),
    }
}

/// Returns the initialization packet for the given mode. Can be zero-length.
pub(crate) fn get_version_packet(mode: Mode) -> &'static [u8] {
    match mode {
        Mode::Advanced => advanced::get_version_packet(),
        Mode::Json => json::get_version_packet(),
    }
}

/// Given a writer interface, serialize and write a value.
/// Returns true if the value was written, false if it was not.
pub(crate) fn serialize(
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

pub(crate) fn get_ack_packet(mode: Mode) -> &'static [u8] {
    match mode {
        Mode::Advanced => advanced::get_ack_packet(),
        Mode::Json => json::get_ack_packet(),
    }
}

pub(crate) fn get_nack_packet(mode: Mode) -> &'static [u8] {
    match mode {
        Mode::Advanced => advanced::get_nack_packet(),
        Mode::Json => json::get_nack_packet(),
    }
}

// `bun_uws::SocketHandler<SSL>` is an alias for `NewSocketHandler<SSL>`
// (uws_sys/socket.rs); `<false>` is the non-SSL handler.
pub type Socket = bun_uws::SocketHandler<false>;

pub struct Handle {
    pub fd: Fd,
    pub js: Protected,
    pub close_on_complete: bool,
    pub owns_fd: bool,
    pub cluster_seq: Option<i32>,
    #[cfg(windows)]
    pub win_export_hex: Option<Box<[u8]>>,
    #[cfg(windows)]
    pub peer_pid: u32,
}

impl Handle {
    pub fn init(fd: Fd, js: JSValue) -> Self {
        Self {
            fd,
            js: js.protected(),
            close_on_complete: false,
            owns_fd: false,
            cluster_seq: None,
            #[cfg(windows)]
            win_export_hex: None,
            #[cfg(windows)]
            peer_pid: 0,
        }
    }

    pub fn init_close_on_complete(fd: Fd, js: JSValue) -> Self {
        Self {
            fd,
            js: js.protected(),
            close_on_complete: true,
            owns_fd: false,
            cluster_seq: None,
            #[cfg(windows)]
            win_export_hex: None,
            #[cfg(windows)]
            peer_pid: 0,
        }
    }

    pub fn init_dup(fd: Fd, js: JSValue, close_on_complete: bool) -> Result<Self, bun_sys::Error> {
        let wire_fd = bun_sys::dup(fd)?;
        Ok(Self {
            fd: wire_fd,
            js: js.protected(),
            close_on_complete,
            owns_fd: true,
            cluster_seq: None,
            #[cfg(windows)]
            win_export_hex: None,
            #[cfg(windows)]
            peer_pid: 0,
        })
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        if self.owns_fd {
            // Owned dup/received descriptors may legitimately be 0-2 (stdio closed); close them regardless.
            let _ = self.fd.close_allowing_standard_io(None);
        }
    }
}

pub enum CallbackList {
    AckNack,
    None,
    /// js callable
    Callback(Protected),
    /// js array
    CallbackArray(Protected),
}

impl CallbackList {
    /// protects the callback
    pub(crate) fn init(callback: JSValue) -> Self {
        if callback.is_callable() {
            return CallbackList::Callback(callback.protected());
        }
        CallbackList::None
    }

    /// protects the callback
    pub(crate) fn push(&mut self, callback: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        match self {
            CallbackList::AckNack => unreachable!(),
            CallbackList::None => {
                *self = CallbackList::Callback(callback.protected());
            }
            CallbackList::Callback(prev) => {
                let prev = prev.value();
                let arr = JSValue::create_empty_array(global, 2)?;
                let arr = arr.protected();
                arr.value().put_index(global, 0, prev)?; // add the old callback to the array
                arr.value().put_index(global, 1, callback)?; // add the new callback to the array
                // Overwriting the old `Callback(prev_guard)` drops it →
                // single `unprotect()` on `prev` (now rooted via `arr`).
                *self = CallbackList::CallbackArray(arr);
            }
            CallbackList::CallbackArray(arr) => {
                arr.value().push(global, callback)?;
            }
        }
        Ok(())
    }

    fn call_next_tick(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        match self {
            CallbackList::AckNack => {}
            CallbackList::None => {}
            CallbackList::Callback(cb) => {
                JSValue::call_next_tick_1(cb.value(), global, JSValue::NULL)?;
                // Assignment drops the old `Callback(cb)` guard → unprotect.
                *self = CallbackList::None;
            }
            CallbackList::CallbackArray(arr) => {
                let mut iter = arr.value().array_iterator(global)?;
                while let Some(item) = iter.next()? {
                    JSValue::call_next_tick_1(item, global, JSValue::NULL)?;
                }
                // Assignment drops the old `CallbackArray(arr)` guard → unprotect.
                *self = CallbackList::None;
            }
        }
        Ok(())
    }
}

pub struct SendHandle {
    // when a message has a handle, make sure it has a new SendHandle - so that if we retry sending it,
    // we only retry sending the message with the handle, not the original message.
    pub(crate) data: StreamBuffer,
    /// keep sending the handle until data is drained (assume it hasn't sent until data is fully drained)
    pub(crate) handle: Option<Handle>,
    pub(crate) callbacks: CallbackList,
}

impl SendHandle {
    pub(crate) fn is_ack_nack(&self) -> bool {
        matches!(self.callbacks, CallbackList::AckNack)
    }

    /// Call the callback and deinit
    pub(crate) fn complete(mut self, global: &JSGlobalObject) {
        if let Some(handle) = &self.handle {
            if handle.close_on_complete {
                let js = handle.js.value();
                if js.is_object() {
                    let _ = JSValue::call_next_tick_1(close_sent_handle_fn(global), global, js);
                }
            }
        }
        let _ = self.callbacks.call_next_tick(global); // TODO: properly propagate exception upwards
        // self drops here → data/callbacks/handle Drop.
    }

    pub fn abort_unsent(self, global: &JSGlobalObject) {
        if let Some(handle) = &self.handle {
            if handle.close_on_complete {
                let js = handle.js.value();
                if js.is_object() {
                    let _ = JSValue::call_next_tick_1(close_sent_handle_fn(global), global, js);
                }
            }
        }
    }
}

#[bun_jsc::host_fn]
fn close_sent_handle(global: &JSGlobalObject, callframe: &jsc::CallFrame) -> JsResult<JSValue> {
    let [js] = callframe.arguments_as_array::<1>();
    if js.is_object() {
        if let Some(f) = js.get(global, "close")? {
            if f.is_callable() {
                f.call(global, js, &[])?;
            }
        }
    }
    Ok(JSValue::UNDEFINED)
}

fn close_sent_handle_fn(global: &JSGlobalObject) -> JSValue {
    jsc::JSFunction::create(
        global,
        "",
        __jsc_host_close_sent_handle,
        1,
        Default::default(),
    )
}

// SendHandle.deinit: all fields Drop; no explicit impl needed.

#[cfg(windows)]
pub struct WindowsWrite {
    pub(crate) write_req: uv::uv_write_t,
    pub(crate) write_buffer: uv::uv_buf_t,
    pub(crate) write_slice: Box<[u8]>,
    pub(crate) owner: Option<*mut SendQueue>,
}

#[cfg(windows)]
impl WindowsWrite {
    pub(crate) fn destroy(this: *mut WindowsWrite) {
        // SAFETY: `this` was produced by heap::alloc in SendQueue::write;
        // libuv guarantees the write callback fires exactly once.
        let _ = unsafe { bun_core::heap::take(this) };
        // write_slice freed by Box<[u8]> Drop.
    }
}

#[cfg(windows)]
#[derive(Default)]
pub struct WindowsState {
    pub(crate) is_server: bool,
    /// Non-owning raw pointer. The allocation
    /// is `heap::alloc`'d in `write` and freed exactly once by
    /// `windows_on_write_complete` via `WindowsWrite::destroy`. Nulling this
    /// field never frees.
    pub(crate) windows_write: Option<*mut WindowsWrite>,
    pub(crate) try_close_after_write: bool,
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

#[derive(bun_ptr::CellRefCounted)]
pub struct SendQueue {
    ref_count: Cell<u32>,
    root: Cell<Option<core::ptr::NonNull<SendQueue>>>,
    pub(crate) queue: JsCell<Vec<SendHandle>>,
    pub(crate) waiting_for_ack: JsCell<Option<SendHandle>>,

    pub(crate) retry_count: Cell<u32>,
    pub(crate) keep_alive: JsCell<KeepAlive>,
    #[cfg(debug_assertions)]
    pub(crate) has_written_version: Cell<u8>,
    pub(crate) mode: Mode,
    pub internal_msg_queue: JsCell<InternalMsgHolder>,
    incoming: JsCell<IncomingBuffer>,
    pub(crate) incoming_fd: Cell<Option<Fd>>,

    pub socket: JsCell<SocketUnion>,
    pub(crate) owner: Cell<Option<SendQueueOwner>>,

    pub(crate) deferred_scheduled: Cell<bool>,
    pub(crate) pending_close: Cell<bool>,
    /// A user disconnect() waiting for the handle queue to flush; reported as disconnected meanwhile, cleared by any real close.
    pub(crate) close_after_flush: Cell<bool>,
    pub(crate) pending_after_close: Cell<bool>,
    pub(crate) write_in_progress: Cell<bool>,
    pub close_event_sent: Cell<bool>,

    pub windows: JsCell<WindowsState>,
}

#[derive(Copy, Clone)]
pub enum SendQueueOwner {
    Subprocess(core::ptr::NonNull<crate::api::bun::subprocess::Subprocess<'static>>),
    Instance(core::ptr::NonNull<crate::ipc_host::IPCInstance>),
}

impl SendQueueOwner {
    #[inline]
    pub fn kind(self) -> SendQueueOwnerKind {
        match self {
            SendQueueOwner::Subprocess(_) => SendQueueOwnerKind::Subprocess,
            SendQueueOwner::Instance(_) => SendQueueOwnerKind::VirtualMachine,
        }
    }

    #[inline]
    fn global_this(self) -> *const JSGlobalObject {
        match self {
            // SAFETY: an attached owner is live (it holds a ref on the SendQueue).
            SendQueueOwner::Subprocess(p) => unsafe { p.as_ref() }.global_this.as_ptr(),
            SendQueueOwner::Instance(_) => core::ptr::from_ref(
                bun_jsc::virtual_machine::VirtualMachine::get()
                    .as_mut()
                    .global(),
            ),
        }
    }

    fn handle_ipc_close(self) {
        match self {
            // SAFETY: an attached owner is live (it holds a ref on the SendQueue).
            SendQueueOwner::Subprocess(p) => unsafe { p.as_ref() }.handle_ipc_close(),
            // SAFETY: as above — an attached owner is live.
            SendQueueOwner::Instance(i) => unsafe { i.as_ref() }.handle_ipc_close(),
        }
    }

    fn handle_ipc_message(self, msg: &DecodedIPCMessage, handle: JSValue) -> JsResult<()> {
        match self {
            // SAFETY: an attached owner is live (it holds a ref on the SendQueue).
            SendQueueOwner::Subprocess(p) => unsafe { p.as_ref() }.handle_ipc_message(msg, handle),
            // SAFETY: as above — an attached owner is live.
            SendQueueOwner::Instance(i) => unsafe { i.as_ref() }.handle_ipc_message(msg, handle),
        }
    }

    fn this_jsvalue(self) -> JSValue {
        match self {
            // SAFETY: an attached owner is live (it holds a ref on the SendQueue).
            SendQueueOwner::Subprocess(p) => unsafe { p.as_ref() }
                .this_value
                .get()
                .try_get()
                .unwrap_or_default(),
            SendQueueOwner::Instance(_) => JSValue::ZERO,
        }
    }
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
    #[inline]
    fn owner_ref(&self) -> Option<SendQueueOwner> {
        self.owner.get()
    }

    pub fn set_owner(&self, owner: SendQueueOwner) {
        self.owner.set(Some(owner));
    }

    pub fn detach(&self) {
        log!("SendQueue#detach");
        self.close_event_sent.set(true);
        self.close_socket(CloseReason::Failure, CloseFrom::Deinit);
        self.owner.set(None);
    }

    pub fn new(
        mode: Mode,
        owner: Option<SendQueueOwner>,
        socket: SocketUnion,
    ) -> RefPtr<SendQueue> {
        log!("SendQueue#init");
        let this = RefPtr::new(Self {
            ref_count: Cell::new(1),
            root: Cell::new(None),
            queue: JsCell::new(Vec::new()),
            waiting_for_ack: JsCell::new(None),
            retry_count: Cell::new(0),
            keep_alive: JsCell::new(KeepAlive::default()),
            #[cfg(debug_assertions)]
            has_written_version: Cell::new(0),
            mode,
            internal_msg_queue: JsCell::new(InternalMsgHolder::default()),
            incoming: JsCell::new(IncomingBuffer::init(mode)),
            incoming_fd: Cell::new(None),
            socket: JsCell::new(socket),
            owner: Cell::new(owner),
            deferred_scheduled: Cell::new(false),
            pending_close: Cell::new(false),
            close_after_flush: Cell::new(false),
            pending_after_close: Cell::new(false),
            write_in_progress: Cell::new(false),
            close_event_sent: Cell::new(false),
            windows: JsCell::new(WindowsState::default()),
        });
        this.root.set(Some(this.as_non_null()));
        this
    }

    #[inline]
    fn root_ptr(&self) -> *mut SendQueue {
        self.root.get().expect("SendQueue::new sets root").as_ptr()
    }

    #[inline]
    pub fn as_ctx_ptr(&self) -> *mut SendQueue {
        self.root_ptr()
    }

    #[inline]
    fn socket_is_open(&self) -> bool {
        matches!(*self.socket.get(), SocketUnion::Open(_))
    }

    pub fn is_connected(&self) -> bool {
        #[cfg(windows)]
        if self.windows.get().try_close_after_write {
            return false;
        }
        self.socket_is_open() && !self.pending_close.get() && !self.close_after_flush.get()
    }

    fn close_socket(&self, reason: CloseReason, from: CloseFrom) {
        log!(
            "SendQueue#closeSocket {}",
            match from {
                CloseFrom::User => "user",
                CloseFrom::Deinit => "deinit",
            }
        );
        let open = match *self.socket.get() {
            SocketUnion::Open(s) => Some(s),
            _ => None,
        };
        match open {
            Some(s) => {
                #[cfg(windows)]
                {
                    let pipe: *mut uv::Pipe = s;
                    // SAFETY: pipe is a live uv_pipe_t owned until _windowsOnClosed fires.
                    let stream: *mut uv::uv_stream_t = unsafe { (*pipe).as_stream() };
                    unsafe { (*stream).read_stop() };

                    let write_pending = self.windows.get().windows_write.is_some();
                    if write_pending && from != CloseFrom::Deinit {
                        log!("SendQueue#closeSocket -> mark ready for close");
                        // currently writing; wait for the write to complete
                        self.windows.with_mut(|w| w.try_close_after_write = true);
                    } else {
                        log!("SendQueue#closeSocket -> close now");
                        self.windows_close(from != CloseFrom::Deinit);
                    }
                }
                #[cfg(not(windows))]
                {
                    s.close(match reason {
                        CloseReason::Normal => bun_uws::CloseCode::Normal,
                        CloseReason::Failure => bun_uws::CloseCode::Failure,
                    });
                    self.socket_closed_notify(from != CloseFrom::Deinit);
                }
            }
            None => {
                self.socket_closed_notify(from != CloseFrom::Deinit);
            }
        }
        let _ = reason; // suppress unused on windows
    }

    fn socket_closed(&self) {
        self.socket_closed_notify(true);
    }

    fn socket_closed_notify(&self, notify: bool) {
        log!("SendQueue#_socketClosed");
        #[cfg(windows)]
        {
            let windows_write = self.windows.get().windows_write;
            if let Some(windows_write) = windows_write {
                // SAFETY: `windows_write` was leaked via `heap::alloc` in
                // `write`; libuv still holds it and will free it in
                // `windows_on_write_complete`. We only clear the backref so
                // the callback doesn't touch a dead `SendQueue`.
                unsafe { (*windows_write).owner = None };
            }
            self.windows.with_mut(|w| w.windows_write = None);
        }
        self.keep_alive.with_mut(|k| k.disable());
        let was_open = self.socket_is_open();
        self.socket.set(SocketUnion::Closed);
        // Only enqueue the close notification for the open→closed transition.
        // `closeSocket` (via `SendQueue.deinit` during the owner's finalizer)
        // can reach this path again with the socket already `.closed`; the
        // owner is about to free the memory that backs `this`, so scheduling
        // a task that points back into it would use-after-free.
        if notify && was_open && !self.pending_after_close.get() && !self.close_event_sent.get() {
            self.pending_after_close.set(true);
            self.schedule_deferred();
        }
    }

    fn schedule_deferred(&self) {
        if self.deferred_scheduled.replace(true) {
            return;
        }
        self.ref_();
        self.get_global_this()
            .bun_vm()
            .event_loop_mut()
            .enqueue_task(Task::init(self.root_ptr()));
    }

    /// `task_tag::SendQueueDeferred` dispatch: drain the pending flags, then
    /// release the task's ref as the tail (nothing touches `*this` after).
    ///
    /// # Safety
    /// `this` is the queued root pointer, live via the ref taken at schedule.
    pub unsafe fn run_deferred(this: *mut SendQueue) {
        {
            // SAFETY: caller contract — the queued task owns a ref on `this`.
            let sq = unsafe { &*this };
            sq.deferred_scheduled.set(false);
            if sq.pending_close.replace(false) {
                log!("SendQueue#closeSocketTask");
                sq.close_socket(CloseReason::Normal, CloseFrom::User);
            }
            if sq.pending_after_close.replace(false) {
                log!("SendQueue#_onAfterIPCClosed");
                if !sq.close_event_sent.replace(true) {
                    let global = sq.get_global_this();
                    if let Some(item) = sq.waiting_for_ack.with_mut(|w| w.take()) {
                        item.complete(&global);
                    }
                    // on_write_complete already dequeued everything fully written; the rest was never delivered.
                    for item in sq.queue.with_mut(std::mem::take) {
                        item.abort_unsent(&global);
                    }
                    if let Some(owner) = sq.owner.get() {
                        owner.handle_ipc_close();
                    }
                }
            }
        }
        // Release the task's ref; the SendQueue may be freed here.
        // SAFETY: `this` is live and owns the ref taken at schedule.
        unsafe { <SendQueue as bun_ptr::CellRefCounted>::deref(this) };
    }

    /// `Taskable::release_unrun`: a scheduled deferred task that will never
    /// run still owns a ref; drop it (skipping the JS callbacks).
    ///
    /// # Safety
    /// `this` is the queued root pointer, live via the ref taken at schedule.
    pub unsafe fn release_deferred_unrun(this: *mut SendQueue) {
        // SAFETY: caller contract.
        unsafe { <SendQueue as bun_ptr::CellRefCounted>::deref(this) };
    }

    /// `uv::open_handles` closes the channel's pipe through here at a thread
    /// teardown: close now (pending writes finish ECANCELED) and let the owner
    /// observe the disconnect, rather than waiting for writes as a user close does.
    #[cfg(windows)]
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: recorded at configure time by this live SendQueue; the pipe
        // leaves the list when `windows_close` issues its uv_close.
        let this = unsafe { &*this.cast::<SendQueue>() };
        this.windows_close(true);
    }

    #[cfg(windows)]
    fn windows_close(&self, notify: bool) {
        log!("SendQueue#_windowsClose");
        let SocketUnion::Open(pipe) = *self.socket.get() else {
            return;
        };
        // SAFETY: pipe is live until the close cb fires.
        unsafe {
            (*pipe).data = pipe.cast();
            (*pipe).close(Self::windows_on_closed);
        }
        self.socket_closed_notify(notify);
    }

    #[cfg(windows)]
    extern "C" fn windows_on_closed(windows: *mut uv::Pipe) {
        log!("SendQueue#_windowsOnClosed");
        // SAFETY: pipe was heap-allocated in windowsConfigureClient / created by caller.
        let _ = unsafe { bun_core::heap::take(windows) };
    }

    pub fn close_socket_next_tick(&self, next_tick: bool) {
        log!("SendQueue#closeSocketNextTick");
        if !self.socket_is_open() {
            self.socket.set(SocketUnion::Closed);
            return;
        }
        // Peer-gone and exit paths land here too: a postponed disconnect never outranks them.
        self.close_after_flush.set(false);
        if self.pending_close.get() {
            return; // close already requested
        }
        if !next_tick {
            self.close_socket(CloseReason::Normal, CloseFrom::User);
            return;
        }
        self.pending_close.set(true);
        self.schedule_deferred();
    }

    /// User disconnect(): reports disconnected now but, like node, closes only once a handle awaiting its ack and the queue behind it have gone out.
    pub fn disconnect(&self) {
        if self.socket_is_open()
            && !self.pending_close.get()
            && self.waiting_for_ack.get().is_some()
        {
            self.close_after_flush.set(true);
            return;
        }
        self.close_socket_next_tick(true);
    }

    fn start_message(
        &self,
        global: &JSGlobalObject,
        callback: JSValue,
        handle: Option<Handle>,
        payload: StreamBuffer,
    ) -> JsResult<()> {
        log!("SendQueue#startMessage");
        #[cfg(debug_assertions)]
        debug_assert!(self.has_written_version.get() == 1);

        let write_in_progress = self.write_in_progress.get();
        self.queue.with_mut(|queue| {
            // optimal case: appending a message without a handle to the end of the queue when the last message also doesn't have a handle and isn't ack/nack
            // this is rare. it will only happen if messages stack up after sending a handle, or if a long message is sent that is waiting for writable
            let use_last = if handle.is_none() && !queue.is_empty() {
                let len = queue.len();
                let last = &queue[len - 1];
                last.handle.is_none() && !last.is_ack_nack() && !(len == 1 && write_in_progress)
            } else {
                false
            };
            if use_last {
                let len = queue.len();
                let last = &mut queue[len - 1];
                if callback.is_callable() {
                    last.callbacks.push(callback, global)?;
                }
                handle_oom(last.data.write(&payload.list));
            } else {
                queue.push(SendHandle {
                    data: payload,
                    handle,
                    callbacks: CallbackList::init(callback),
                });
            }
            Ok(())
        })
    }

    pub(crate) fn insert_message(&self, message: SendHandle) {
        log!("SendQueue#insertMessage");
        #[cfg(debug_assertions)]
        debug_assert!(self.has_written_version.get() == 1);
        let write_in_progress = self.write_in_progress.get();
        let waiting_for_ack = self.waiting_for_ack.get().is_some();
        self.queue.with_mut(|queue| {
            if (queue.is_empty() || queue[0].data.cursor == 0) && !write_in_progress {
                // prepend (we have not started sending the next message yet because we are waiting for the ack/nack)
                queue.insert(0, message);
            } else {
                debug_assert!(!waiting_for_ack || queue[0].is_ack_nack());
                queue.insert(1, message);
            }
        });
    }

    pub(crate) fn on_ack_nack(&self, global: &JSGlobalObject, ack_nack: AckNack) {
        log!("SendQueue#onAckNack");
        let waiting = self.waiting_for_ack.with_mut(|w| match w {
            None => None,
            Some(item) => Some(item.handle.is_some()),
        });
        let Some(has_handle) = waiting else {
            log!("onAckNack: ack received but not waiting for ack");
            return;
        };
        if !has_handle {
            log!("onAckNack: ack received but waiting_for_ack is not a handle message?");
            return;
        }
        if ack_nack == AckNack::Nack {
            // retry up to three times
            let retry_count = self.retry_count.get() + 1;
            self.retry_count.set(retry_count);
            if retry_count < MAX_HANDLE_RETRANSMISSIONS {
                // retry sending the message
                let item = self
                    .waiting_for_ack
                    .with_mut(|w| w.take())
                    .map(|mut item| {
                        item.data.cursor = 0;
                        #[cfg(windows)]
                        {
                            let handle = item.handle.as_mut().unwrap();
                            if handle.peer_pid != 0 {
                                if let Some(old_hex) = handle.win_export_hex.take() {
                                    if let Some(new_hex) =
                                        windows_export_socket_hex(handle.fd, handle.peer_pid)
                                    {
                                        if let Some(pos) =
                                            bun_core::memmem(&item.data.list, &old_hex)
                                        {
                                            item.data.list[pos..pos + new_hex.len()]
                                                .copy_from_slice(&new_hex);
                                        }
                                        handle.win_export_hex = Some(new_hex);
                                    } else {
                                        handle.win_export_hex = Some(old_hex);
                                    }
                                }
                            }
                        }
                        item
                    })
                    .unwrap();
                self.insert_message(item);
                log!("IPC call continueSend() from onAckNack retry");
                return self.continue_send(global, ContinueSendReason::NewMessageAppended);
            }
            let cluster_seq = self
                .waiting_for_ack
                .with_mut(|w| w.as_ref().and_then(|i| i.handle.as_ref()?.cluster_seq));
            if let Some(seq) = cluster_seq {
                let cb = self.internal_msg_queue.with_mut(|q| {
                    let entry = q.callbacks.get(&seq).map(|s| s.get());
                    if entry.is_some() {
                        q.callbacks.swap_remove(&seq);
                    }
                    entry.flatten()
                });
                if let Some(cb) = cb {
                    let reply = JSValue::create_empty_object(global, 1);
                    reply.put(global, b"accepted", JSValue::FALSE);
                    let _ = JSValue::call_next_tick_1(cb, global, reply);
                }
            }
            // too many retries; give up - emit warning if possible
            let warning =
                BunString::static_("Handle did not reach the receiving process correctly");
            let warning_name = BunString::static_("SentHandleNotReceivedWarning");
            if let Ok(warning_js) = warning.into_js(global) {
                if let Ok(warning_name_js) = warning_name.into_js(global) {
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
        if let Some(item) = self.waiting_for_ack.with_mut(|w| w.take()) {
            self.retry_count.set(0);
            item.complete(global); // call the callback & deinit
        }
        log!("IPC call continueSend() from onAckNack success");
        self.continue_send(global, ContinueSendReason::NewMessageAppended);
    }

    fn should_ref(&self) -> bool {
        if self.waiting_for_ack.get().is_some() {
            return true; // waiting to receive an ack/nack from the other side
        }
        if self.queue.get().is_empty() {
            return false; // nothing to send
        }
        // Anything still queued (including head with cursor==0 under backpressure) must keep the loop alive; a closed socket does not.
        self.socket_is_open()
    }

    pub(crate) fn update_ref(&self, global: &JSGlobalObject) {
        let _ = global;
        // Note: KeepAlive::{ref_,unref} take an `EventLoopCtx` (aio cycle-
        // break vtable), not `&VirtualMachine`; dispatch is
        // routed through `bun_io::get_vm_ctx` which `bun_runtime` registers.
        let ctx = bun_io::posix_event_loop::get_vm_ctx(bun_io::AllocatorType::Js);
        let should_ref = self.should_ref();
        self.keep_alive.with_mut(|k| {
            if should_ref {
                k.ref_(ctx);
            } else {
                k.unref(ctx);
            }
        });
    }

    fn continue_send(&self, global: &JSGlobalObject, reason: ContinueSendReason) {
        log!(
            "IPC continueSend: {}",
            match reason {
                ContinueSendReason::NewMessageAppended => "new_message_appended",
                ContinueSendReason::OnWritable => "on_writable",
            }
        );
        self.debug_log_message_queue();

        if self.write_in_progress.get() {
            self.update_ref(global);
            return; // write in progress
        }

        enum Next {
            Nothing,
            EmptyItem(SendHandle),
            Send(Option<Fd>),
        }
        let waiting_for_ack = self.waiting_for_ack.get().is_some();
        let next = self.queue.with_mut(|queue| {
            let Some(first) = queue.first() else {
                return Next::Nothing; // nothing to send
            };
            if waiting_for_ack && !first.is_ack_nack() {
                // waiting for ack/nack. may not send any items until it is received.
                // only allowed to send the message if it is an ack/nack itself.
                return Next::Nothing;
            }
            if reason != ContinueSendReason::OnWritable && first.data.cursor != 0 {
                // the last message isn't fully sent yet, we're waiting for a writable event
                return Next::Nothing;
            }
            let to_send_len = first.data.list.len() - first.data.cursor;
            if to_send_len == 0 {
                // item's length is 0, remove it and continue sending. this should rarely (never?) happen.
                return Next::EmptyItem(queue.remove(0));
            }
            Next::Send(if first.data.cursor == 0 {
                first.handle.as_ref().map(|h| h.fd)
            } else {
                None
            })
        });
        match next {
            Next::Nothing => {
                if self.close_after_flush.get() && !waiting_for_ack && self.queue.get().is_empty() {
                    self.close_socket_next_tick(true);
                }
                self.update_ref(global);
            }
            Next::EmptyItem(itm) => {
                itm.complete(global); // call the callback & deinit
                log!("IPC call continueSend() from empty item");
                self.continue_send(global, reason);
            }
            Next::Send(fd) => {
                debug_assert!(!self.write_in_progress.get());
                self.write_in_progress.set(true);
                self.write(fd);
                // the write is queued. this._onWriteComplete() will be called when the write completes.
                self.update_ref(global);
            }
        }
    }

    fn on_write_complete(&self, n: i32) {
        log!("SendQueue#_onWriteComplete {}", n);
        self.debug_log_message_queue();
        if !self.write_in_progress.get() || self.queue.get().is_empty() {
            debug_assert!(false);
            return;
        }
        self.write_in_progress.set(false);
        let global_this = self.get_global_this();

        enum Done {
            AwaitAck,
            Completed(SendHandle),
            Partial,
            NoProgress,
            Error,
        }
        let done = self.queue.with_mut(|queue| {
            let first = &mut queue[0];
            let to_send_len = first.data.list.len() - first.data.cursor;
            // `n` is the write count from the socket (at most i32::MAX per write).
            // The coalesced item can be larger than that, so compare as usize.
            match usize::try_from(n) {
                Ok(written) if written == to_send_len => {
                    if first.handle.is_some() {
                        // the message was fully written, but it had a handle.
                        // we must wait for ACK or NACK before sending any more messages.
                        let item = queue.remove(0);
                        self.waiting_for_ack.with_mut(|w| {
                            if w.is_some() {
                                log!("[error] already waiting for ack. this should never happen.");
                            }
                            // shift the item off the queue and move it to waiting_for_ack
                            *w = Some(item);
                        });
                        Done::AwaitAck
                    } else {
                        // the message was fully sent, but there may be more items in the queue.
                        // shift the queue and try to send the next item immediately.
                        Done::Completed(queue.remove(0))
                    }
                }
                Ok(0) => {
                    // no bytes written; wait for writable
                    Done::NoProgress
                }
                Ok(written) if written < to_send_len => {
                    // the item was partially sent; update the cursor and wait for writable to send the rest
                    // (if we tried to send a handle, a partial write means the handle wasn't sent yet.)
                    first.data.cursor += written;
                    Done::Partial
                }
                _ => Done::Error,
            }
        });
        match done {
            Done::AwaitAck => {
                self.continue_send(&global_this, ContinueSendReason::OnWritable);
            }
            Done::Completed(item) => {
                item.complete(&global_this); // call the callback & deinit
                self.continue_send(&global_this, ContinueSendReason::OnWritable);
            }
            Done::Partial => {
                // libuv completes a request in full or fails. A partial write is
                // the i32::MAX cap in `write`, and no writable event follows it.
                #[cfg(windows)]
                self.continue_send(&global_this, ContinueSendReason::OnWritable);
            }
            Done::NoProgress => {}
            Done::Error => {
                // error. close socket.
                self.close_socket(CloseReason::Failure, CloseFrom::User);
            }
        }
        self.update_ref(&global_this);
    }

    pub fn write_version_packet(&self, global: &JSGlobalObject) {
        log!("SendQueue#writeVersionPacket");
        #[cfg(debug_assertions)]
        debug_assert!(self.has_written_version.get() == 0);
        debug_assert!(self.queue.get().is_empty());
        debug_assert!(self.waiting_for_ack.get().is_none());
        let bytes = get_version_packet(self.mode);
        if !bytes.is_empty() {
            self.queue.with_mut(|queue| {
                queue.push(SendHandle {
                    data: StreamBuffer::default(),
                    handle: None,
                    callbacks: CallbackList::None,
                });
                let last = queue.len() - 1;
                handle_oom(queue[last].data.write(bytes));
            });
            log!("IPC call continueSend() from version packet");
            self.continue_send(global, ContinueSendReason::NewMessageAppended);
        }
        #[cfg(debug_assertions)]
        {
            self.has_written_version.set(1);
        }
    }

    pub fn serialize_and_send(
        &self,
        global: &JSGlobalObject,
        value: JSValue,
        is_internal: IsInternal,
        callback: JSValue,
        handle: Option<Handle>,
    ) -> SerializeAndSendResult {
        log!("SendQueue#serializeAndSend");
        let indicate_backoff = self.waiting_for_ack.get().is_some() && !self.queue.get().is_empty();
        let mode = self.mode;
        let mut payload = StreamBuffer::default();
        let payload_length = match serialize(mode, &mut payload, global, value, is_internal) {
            Ok(n) => n,
            Err(_) => return SerializeAndSendResult::Failure,
        };
        debug_assert!(payload.list.len() == payload_length);
        if self
            .start_message(global, callback, handle, payload)
            .is_err()
        {
            return SerializeAndSendResult::Failure;
        }
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
        let queue = self.queue.get();
        log!("IPC message queue ({} items)", queue.len());
        for item in queue {
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

    fn get_socket(&self) -> Option<SocketType> {
        match *self.socket.get() {
            SocketUnion::Open(s) => Some(s),
            _ => None,
        }
    }

    #[cfg(windows)]
    pub fn ipc_peer_pid(&self) -> u32 {
        match *self.socket.get() {
            // SAFETY: `p` is a live uv_pipe_t owned until _windowsOnClosed.
            SocketUnion::Open(p) => unsafe { (*p).ipc_remote_pid() as u32 },
            _ => 0,
        }
    }

    /// starts a write request. on posix, this always calls _onWriteComplete immediately. on windows, it may
    /// call _onWriteComplete later.
    ///
    /// The outbound bytes are read from `queue[0]` *inside* this method.
    fn write(&self, fd: Option<Fd>) {
        let Some(socket) = self.get_socket() else {
            self.on_write_complete(-1);
            return;
        };
        #[cfg(windows)]
        {
            let _ = fd;
            let pipe: *mut uv::Pipe = socket;

            let write_req_slice: Box<[u8]> = self.queue.with_mut(|queue| {
                let first = &queue[0];
                let data = &first.data.list[first.data.cursor..];
                log!("SendQueue#write len {}", data.len());
                let write_len = data.len().min(i32::MAX as usize);
                Box::from(&data[0..write_len])
            });

            // create write request
            let mut write_req = Box::new(WindowsWrite {
                owner: Some(self.root_ptr()),
                write_slice: write_req_slice,
                write_req: bun_core::ffi::zeroed(),
                write_buffer: uv::uv_buf_t::init(b""), // re-init below after slice address is stable
            });
            write_req.write_buffer = uv::uv_buf_t::init(&write_req.write_slice);
            // Hand ownership to libuv; reclaimed exactly once by
            // `windows_on_write_complete` via `WindowsWrite::destroy`.
            let write_req: *mut WindowsWrite = bun_core::heap::into_raw(write_req);
            debug_assert!(self.windows.get().windows_write.is_none());
            self.windows.with_mut(|w| w.windows_write = Some(write_req));

            // SAFETY: pipe is live (socket == .open).
            unsafe { (*pipe).ref_() }; // ref on write
            // SAFETY: `write_req` is a freshly-leaked Box; libuv owns it until
            // the write callback fires.
            let result = unsafe {
                (*write_req).write_req.write(
                    (*pipe).as_stream(),
                    &(*write_req).write_buffer,
                    write_req,
                    // `write()` stores a *Rust* fn pointer (`fn(*mut T, ReturnCode)`)
                    // and thunks it through libuv. The callback receives the
                    // raw `*mut WindowsWrite` (NOT `&mut`) because
                    // `windows_on_write_complete` deallocates the request via
                    // `WindowsWrite::destroy`.
                    |req: *mut WindowsWrite, rc| SendQueue::windows_on_write_complete(req, rc),
                )
            };
            if result.to_error(bun_sys::Tag::write).is_some() {
                WindowsWrite::destroy(write_req);
                self.windows.with_mut(|w| w.windows_write = None);
                // SAFETY: pipe is live (socket == .open); pairs with the
                // `(*pipe).ref_()` above.
                unsafe { (*pipe).unref() };
                self.on_write_complete(-1);
                if self.windows.get().try_close_after_write {
                    self.close_socket(CloseReason::Normal, CloseFrom::User);
                }
                return;
            }
            // write request is queued. it will call _onWriteComplete when it completes.
        }
        #[cfg(not(windows))]
        {
            let n: i32 = self.queue.with_mut(|queue| {
                let first = &queue[0];
                let data = &first.data.list[first.data.cursor..];
                log!("SendQueue#write len {}", data.len());
                if let Some(fd_unwrapped) = fd {
                    socket.write_fd(data, fd_unwrapped.native())
                } else {
                    socket.write(data)
                }
            });
            self.on_write_complete(n);
        }
    }

    #[cfg(windows)]
    fn windows_on_write_complete(write_req: *mut WindowsWrite, status: uv::ReturnCode) {
        log!("SendQueue#_windowsOnWriteComplete");
        // SAFETY: write_req was passed to uv_write as the data ptr; libuv hands it back here.
        // Explicit `&` so the slice `.len()` autoref doesn't trigger
        // `dangerous_implicit_autorefs` on the raw-ptr place.
        let write_len = unsafe { (&(*write_req).write_slice).len() };
        let this: *mut SendQueue = 'blk: {
            let owner = unsafe { (*write_req).owner };
            WindowsWrite::destroy(write_req);
            match owner {
                Some(o) => break 'blk o,
                None => return, // orelse case if disconnected before the write completes
            }
        };
        let vm = VirtualMachine::get();
        let _scope = vm.enter_event_loop_scope();

        // SAFETY: owner is a BACKREF into the live SendQueue (cleared in
        // socket_closed if not); every method takes `&self`.
        let this = unsafe { &*this };
        this.windows.with_mut(|w| w.windows_write = None);
        if let Some(socket) = this.get_socket() {
            // SAFETY: `socket` is the live `uv_pipe_t` place (matches the
            // `(*pipe).ref_()` site in `write`).
            unsafe { (*socket).unref() }; // write complete; unref
        }
        let n = if status.to_error(bun_sys::Tag::write).is_some() {
            -1
        } else {
            i32::try_from(write_len).expect("int cast")
        };
        this.on_write_complete(n);

        if this.windows.get().try_close_after_write {
            this.close_socket(CloseReason::Normal, CloseFrom::User);
        }
        // The event-loop exit is handled by `_scope` drop.
    }
    fn get_global_this(&self) -> bun_jsc::GlobalRef {
        let owner = self.owner_ref().expect("SendQueue used after detach");
        bun_jsc::GlobalRef::from(JSGlobalObject::opaque_ref(owner.global_this()))
    }

    /// # Safety
    /// `this` must point at a live `SendQueue` and must derive from the
    /// allocation's root raw pointer (SharedReadWrite provenance), NOT from a
    /// `&mut` reborrow: the pointer is stashed in `uv_handle_t.data` for the
    /// pipe's lifetime. Mirrors [`windows_configure_client`].
    #[cfg(windows)]
    pub unsafe fn windows_configure_server(
        this: *mut Self,
        ipc_pipe: *mut uv::Pipe,
    ) -> bun_sys::Result<()> {
        log!("configureServer");
        // SAFETY: ipc_pipe is a live uv_pipe_t handed in by the caller; `this`
        // is the root-raw SendQueue pointer per the fn safety contract.
        unsafe {
            (*ipc_pipe).data = this.cast();
            (*ipc_pipe).unref();
        }
        // SAFETY: caller contract — `this` is a live SendQueue.
        let self_ = unsafe { &*this };
        self_.socket.set(SocketUnion::Open(ipc_pipe));
        uv::open_handles::set_owner(
            ipc_pipe.cast(),
            this.cast(),
            Some(Self::stop_for_vm_teardown),
        );
        self_.windows.with_mut(|w| w.is_server = true);
        // SAFETY: pipe is the live uv handle just stored in the socket cell.
        unsafe { (*ipc_pipe).data = this.cast() };

        // SAFETY: pipe is the live uv handle just stored in the socket cell.
        let stream: *mut uv::uv_stream_t = unsafe { (*ipc_pipe).as_stream() };

        // SAFETY: stream points to the live uv handle; `this` is the root-raw
        // context pointer (see fn safety contract) so storing it in
        // `handle.data` is sound for the handle's lifetime. Routes through the
        // `StreamReader for SendQueue` impl below (wraps the
        // `IPCHandlers::WindowsNamedPipe` callbacks).
        let read_start_result =
            unsafe { (*stream).read_start_ctx::<SendQueue>(this) }.to_error(bun_sys::Tag::listen);
        if let Some(err) = read_start_result {
            self_.close_socket(CloseReason::Failure, CloseFrom::User);
            return Err(err);
        }
        bun_sys::Result::Ok(())
    }

    /// # Safety
    /// `this` must point at a live `SendQueue` and must derive from the
    /// allocation's root raw pointer (SharedReadWrite provenance), NOT from a
    /// `&mut` reborrow: the pointer is stashed in `uv_handle_t.data` for the
    /// pipe's lifetime.
    #[cfg(windows)]
    pub(crate) unsafe fn windows_configure_client(
        this: *mut Self,
        pipe_fd: Fd,
    ) -> Result<(), bun_jsc::CrateError> {
        log!("configureClient");
        let ipc_pipe: *mut uv::Pipe =
            bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<uv::Pipe>()));
        // SAFETY: ipc_pipe just allocated above.
        if let Some(err) =
            unsafe { (*ipc_pipe).init(uv::Loop::get(), true) }.to_error(bun_sys::Tag::pipe)
        {
            // SAFETY: ipc_pipe was heap-allocated above and init failed before libuv took ownership.
            let _ = unsafe { bun_core::heap::take(ipc_pipe) };
            return Err(err.into());
        }
        // SAFETY: ipc_pipe is a live initialized uv_pipe_t.
        if let Some(err) = unsafe { (*ipc_pipe).open(pipe_fd.uv()) }.to_error(bun_sys::Tag::open) {
            // SAFETY: ipc_pipe is a live initialized uv_pipe_t; close_and_destroy frees the Box.
            unsafe { uv::Pipe::close_and_destroy(ipc_pipe) };
            return Err(err.into());
        }
        // SAFETY: ipc_pipe is a live initialized uv_pipe_t.
        unsafe { (*ipc_pipe).unref() };
        // SAFETY: caller contract — `this` is a live SendQueue.
        let self_ = unsafe { &*this };
        self_.socket.set(SocketUnion::Open(ipc_pipe));
        uv::open_handles::set_owner(
            ipc_pipe.cast(),
            this.cast(),
            Some(Self::stop_for_vm_teardown),
        );
        self_.windows.with_mut(|w| w.is_server = false);

        // SAFETY: ipc_pipe is the live uv handle just stored in the socket cell.
        let stream = unsafe { (*ipc_pipe).as_stream() };

        // SAFETY: stream points to the live uv handle; `this` is the root-raw
        // context pointer (see fn safety contract) so storing it in
        // `handle.data` is sound for the handle's lifetime.
        if let Some(err) =
            unsafe { (*stream).read_start_ctx::<SendQueue>(this) }.to_error(bun_sys::Tag::listen)
        {
            self_.close_socket(CloseReason::Failure, CloseFrom::User);
            return Err(err.into());
        }
        Ok(())
    }
}

/// Adapter from `UvStream::read_start_ctx` to the `IPCHandlers::WindowsNamedPipe`
/// callbacks. The three fns are baked
/// into the trait impl so the `extern "C"` trampoline is monomorphised over
/// `SendQueue` with zero per-handle storage.
#[cfg(windows)]
impl uv::StreamReader for SendQueue {
    #[inline]
    fn on_read_alloc(this: &mut Self, suggested_size: usize) -> &mut [u8] {
        IPCHandlers::WindowsNamedPipe::on_read_alloc(this, suggested_size)
    }
    #[inline]
    fn on_read_error(this: &mut Self, err: core::ffi::c_int) {
        // Map the raw libuv errno
        // to `bun_sys::E`, defaulting to CANCELED for unmapped codes.
        let e = bun_sys::windows::translate_uv_error_to_e(err);
        IPCHandlers::WindowsNamedPipe::on_read_error(this, e);
    }
    #[inline]
    unsafe fn on_read(this: *mut Self, data: &[u8]) {
        // `data` points into `(*this).incoming` (it was returned from
        // `on_read_alloc`); the callee re-derives the written tail from
        // `incoming` itself, so only the length is forwarded and only a shared
        // view of `*this` is formed.
        let nread = data.len();
        let _ = data;
        // SAFETY: `this` is the live `SendQueue` stashed in `handle.data` by
        // `read_start_ctx`; a shared reborrow only, and `data` is not used after.
        IPCHandlers::WindowsNamedPipe::on_read(unsafe { &*this }, nread);
    }
}

impl bun_event_loop::Taskable for SendQueue {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::SendQueueDeferred;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the SendQueue root queued with a held ref.
        unsafe { SendQueue::release_deferred_unrun(this) }
    }
}

impl Drop for SendQueue {
    fn drop(&mut self) {
        log!("SendQueue#deinit");
        self.close_event_sent.set(true);
        self.close_socket(CloseReason::Failure, CloseFrom::Deinit);

        // queue items / internal_msg_queue / incoming / waiting_for_ack: Drop handles them.

        // An SCM_RIGHTS fd can be stashed by `onFd` and not yet consumed by
        // the `NODE_HANDLE` decoder when the socket closes.
        if let Some(fd) = self.incoming_fd.take() {
            let _ = fd.close_allowing_standard_io(None);
        }
    }
}

const MAX_HANDLE_RETRANSMISSIONS: u32 = 3;

#[cfg(windows)]
pub fn windows_export_socket_hex(fd: Fd, peer_pid: u32) -> Option<Box<[u8]>> {
    let size = bun_uws::socket_transfer::bsd_socket_export_size() as usize;
    let mut info = vec![0u8; size];
    // SAFETY: `info` is `size` bytes as required; `fd.native()` is the SOCKET.
    let rc = unsafe {
        bun_uws::socket_transfer::bsd_socket_export(
            fd.native() as bun_uws::LIBUS_SOCKET_DESCRIPTOR,
            peer_pid,
            info.as_mut_ptr().cast::<core::ffi::c_void>(),
        )
    };
    if rc != 0 {
        return None;
    }
    let mut hex = vec![0u8; size * 2];
    let n = bun_core::strings::encode_bytes_to_hex(&mut hex, &info);
    debug_assert!(n == size * 2);
    hex.truncate(n);
    Some(hex.into_boxed_slice())
}

pub const WIN_SOCKET_INFO_KEY: &[u8] = b"$winSocketInfo";

#[cfg(windows)]
fn import_windows_socket_payload(
    global: &JSGlobalObject,
    msg_data: JSValue,
) -> JsResult<Option<Fd>> {
    let Some(info_value) = msg_data
        .get(global, WIN_SOCKET_INFO_KEY)?
        .filter(|v| v.is_string())
    else {
        return Ok(None);
    };
    let hex_view = info_value.to_js_string_view(global)?;
    let hex = hex_view.to_utf8();
    let expected = bun_uws::socket_transfer::bsd_socket_export_size() as usize;
    let mut info = vec![0u8; expected];
    let decoded = strings::decode_hex_to_bytes_truncate(&mut info, hex.slice());
    if decoded != expected {
        log!(
            "importWindowsSocketPayload: bad blob length {} (want {})",
            decoded,
            expected
        );
        return Ok(None);
    }
    let mut err: c_int = 0;
    // SAFETY: `info` is a live buffer of export_size() bytes holding the
    let sock = unsafe {
        bun_uws::socket_transfer::bsd_socket_import(info.as_mut_ptr().cast::<c_void>(), &mut err)
    };
    if sock == bun_uws::LIBUS_SOCKET_DESCRIPTOR::MAX {
        log!("importWindowsSocketPayload: WSASocketW failed: {}", err);
        return Ok(None);
    }
    let fd = Fd::from_system(sock as *mut c_void);
    if let Err(err) = msg_data.delete_property(global, WIN_SOCKET_INFO_KEY) {
        // The imported socket is not owned by anything yet; do not leak it
        // with the exception.
        fd.close();
        return Err(err);
    }
    Ok(Some(fd))
}

fn received_fd_to_js(fd: Fd) -> JSValue {
    #[cfg(windows)]
    {
        let v = fd.native() as u64;
        if v <= i32::MAX as u64 {
            JSValue::js_number_from_int32(v as i32)
        } else {
            JSValue::js_number_from_uint64(v)
        }
    }
    #[cfg(not(windows))]
    {
        JSValue::js_number_from_int32(fd.uv())
    }
}

enum IPCCommand {
    Handle(JSValue),
    Ack,
    Nack,
}

/// One decoded message's delivery. A JS exception raised while inspecting or delivering it is this message's
/// failure; the on-data callers fold it (reported as uncaught) and go on to the next message.
fn handle_ipc_message(
    send_queue: &SendQueue,
    message: DecodedIPCMessage,
    global_this: &JSGlobalObject,
) -> JsResult<()> {
    #[cfg(debug_assertions)]
    {
        // The `Formatter` runs its deinit in `Drop`.
        let mut formatter = jsc::ConsoleObject::Formatter::new(global_this);
        match &message {
            DecodedIPCMessage::Version(version) => {
                log!("received ipc message: version: {}", version)
            }
            DecodedIPCMessage::Data(jsvalue) => {
                log!("received ipc message: {}", jsvalue.to_fmt(&mut formatter))
            }
            DecodedIPCMessage::Internal(jsvalue) => {
                log!(
                    "received ipc message: internal: {}",
                    jsvalue.to_fmt(&mut formatter)
                )
            }
        }
    }
    let mut internal_command: Option<IPCCommand> = None;
    'handle_message: {
        if let DecodedIPCMessage::Data(msg_data) = &message {
            let msg_data = *msg_data;
            if msg_data.is_object() {
                let Some(cmd) = msg_data.fast_get(global_this, jsc::BuiltinName::cmd)? else {
                    break 'handle_message;
                };
                if cmd.is_string() {
                    if !cmd.is_cell() {
                        break 'handle_message;
                    }
                    let cmd_str = bun_core::String::from_js(cmd, global_this)?;
                    if cmd_str.eq_ascii(b"NODE_HANDLE") {
                        internal_command = Some(IPCCommand::Handle(msg_data));
                    } else if cmd_str.eq_ascii(b"NODE_HANDLE_ACK") {
                        internal_command = Some(IPCCommand::Ack);
                    } else if cmd_str.eq_ascii(b"NODE_HANDLE_NACK") {
                        internal_command = Some(IPCCommand::Nack);
                    }
                }
            }
        }
    }

    if let Some(icmd) = internal_command {
        match icmd {
            IPCCommand::Handle(msg_data) => {
                #[cfg(windows)]
                let imported = import_windows_socket_payload(global_this, msg_data)?;
                #[cfg(windows)]
                let ack = imported.is_some();
                #[cfg(not(windows))]
                let ack = send_queue.incoming_fd.get().is_some();

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
                handle_oom(handle.data.write(packet));

                // Insert at appropriate position in send queue
                send_queue.insert_message(handle);

                // Send if needed
                log!("IPC call continueSend() from handleIPCMessage");
                send_queue.continue_send(global_this, ContinueSendReason::NewMessageAppended);

                if !ack {
                    return Ok(());
                }

                // Get file descriptor and clear it
                #[cfg(windows)]
                let fd: Fd = imported.unwrap();
                #[cfg(not(windows))]
                let fd: Fd = send_queue.incoming_fd.take().unwrap();

                let Some(owner) = send_queue.owner_ref() else {
                    let _ = fd.close_allowing_standard_io(None);
                    return Ok(());
                };
                let target: JSValue = match owner.kind() {
                    SendQueueOwnerKind::Subprocess => owner.this_jsvalue(),
                    SendQueueOwnerKind::VirtualMachine => JSValue::NULL,
                };

                // RAII: `enter()` now, `exit()` on drop — covers both the
                // early-error return and the fall-through.
                let _scope = global_this.bun_vm().enter_event_loop_scope();
                let fd_js = received_fd_to_js(fd);
                if let Err(e) = ipc_parse(global_this, target, msg_data, fd_js) {
                    // ack written already, that's okay.
                    let _ = fd.close_allowing_standard_io(None);
                    return Err(e);
                }
                drop(_scope);

                // ipc_parse will call the callback which calls handleIPCMessage()
                // we have sent the ack already so the next message could arrive at any time. maybe even before
                // parseHandle calls emit(). however, node does this too and its messages don't end up out of order.
                // so hopefully ours won't either.
                return Ok(());
            }
            IPCCommand::Ack => {
                send_queue.on_ack_nack(global_this, AckNack::Ack);
                return Ok(());
            }
            IPCCommand::Nack => {
                send_queue.on_ack_nack(global_this, AckNack::Nack);
                return Ok(());
            }
        }
    } else {
        // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/cluster/utils.js#L33-L49
        let mut handle_js = JSValue::UNDEFINED;
        let mut received_fd: Option<Fd> = None;
        if let DecodedIPCMessage::Internal(msg_data) = &message {
            let msg_data = *msg_data;
            if msg_data.is_object() {
                if let Some(marker) = msg_data.get(global_this, "$hasHandle")?
                    && marker.to_boolean()
                {
                    #[cfg(windows)]
                    let imported = import_windows_socket_payload(global_this, msg_data)?;
                    #[cfg(windows)]
                    let ack = imported.is_some();
                    #[cfg(not(windows))]
                    let ack = send_queue.incoming_fd.get().is_some();
                    let packet = if ack {
                        get_ack_packet(send_queue.mode)
                    } else {
                        get_nack_packet(send_queue.mode)
                    };
                    let mut reply = SendHandle {
                        data: StreamBuffer::default(),
                        handle: None,
                        callbacks: CallbackList::AckNack,
                    };
                    handle_oom(reply.data.write(packet));
                    send_queue.insert_message(reply);
                    log!("IPC call continueSend() from internal $hasHandle ack");
                    send_queue.continue_send(global_this, ContinueSendReason::NewMessageAppended);
                    if !ack {
                        return Ok(());
                    }
                    #[cfg(windows)]
                    let fd = imported.unwrap();
                    #[cfg(not(windows))]
                    let fd = send_queue.incoming_fd.take().unwrap();
                    received_fd = Some(fd);
                    handle_js = received_fd_to_js(fd);
                }
            }
        }
        match send_queue.owner.get() {
            Some(owner) => owner.handle_ipc_message(&message, handle_js)?,
            // Owner already torn down: nobody will adopt the descriptor we just acked.
            None => {
                if let Some(fd) = received_fd {
                    let _ = fd.close_allowing_standard_io(None);
                }
            }
        }
    }
    Ok(())
}

enum DecodeStep {
    Message(DecodeIPCMessageResult),
    Wait,
    Fail(IPCDecodeError),
}

fn finish_decode(send_queue: &SendQueue, step: &DecodeStep) {
    match step {
        DecodeStep::Message(_) => unreachable!("caller dispatches Message"),
        DecodeStep::Wait => {
            log!("hit NotEnoughBytes");
        }
        DecodeStep::Fail(IPCDecodeError::Js(JsError::OutOfMemory)) => {
            Output::print_errorln("IPC message is too long.");
            send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
        }
        // Materializing the message (structured-clone deserialize, buffer
        // restore) threw: that is this message's delivery failing, folded like
        // a throwing listener, and the channel is closed as for any undecodable
        // input.
        DecodeStep::Fail(IPCDecodeError::Js(err)) => {
            crate::dispatch::fold(Err(*err));
            send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
        }
        DecodeStep::Fail(_) => {
            send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
        }
    }
}

fn decode_next_json(incoming: &JsCell<IncomingBuffer>, global: &JSGlobalObject) -> DecodeStep {
    incoming.with_mut(|inc| {
        let IncomingBuffer::Json(json_buf) = inc else {
            unreachable!()
        };
        let Some(msg) = json_buf.next() else {
            return DecodeStep::Wait;
        };
        match decode_ipc_message(Mode::Json, msg.data, global, Some(msg.newline_pos)) {
            Ok(r) => {
                let bytes_consumed = r.bytes_consumed;
                json_buf.consume(bytes_consumed);
                DecodeStep::Message(r)
            }
            Err(IPCDecodeError::NotEnoughBytes) => DecodeStep::Wait,
            Err(e) => DecodeStep::Fail(e),
        }
    })
}

fn decode_next_advanced(
    incoming: &JsCell<IncomingBuffer>,
    global: &JSGlobalObject,
    slice_start: &mut usize,
) -> DecodeStep {
    incoming.with_mut(|inc| {
        let IncomingBuffer::Advanced(adv_buf) = inc else {
            unreachable!()
        };
        let slice = &adv_buf.slice()[*slice_start..];
        match decode_ipc_message(Mode::Advanced, slice, global, None) {
            Ok(r) => {
                let consumed = r.bytes_consumed as usize;
                if consumed < slice.len() {
                    *slice_start += consumed;
                } else {
                    adv_buf.clear();
                    *slice_start = 0;
                }
                DecodeStep::Message(r)
            }
            Err(IPCDecodeError::NotEnoughBytes) => {
                // copy the remaining bytes to the start of the buffer
                adv_buf.drain_front(*slice_start);
                DecodeStep::Wait
            }
            Err(e) => DecodeStep::Fail(e),
        }
    })
}

fn on_data2(send_queue: &SendQueue, all_data: &[u8]) {
    let mut data = all_data;

    // In the VirtualMachine case, `globalThis` is an optional, in case
    // the vm is freed before the socket closes.
    let global_this = send_queue.get_global_this();

    match send_queue.mode {
        Mode::Json => {
            // JSON mode: append to buffer (scans only new data for newline),
            // then process complete messages using next().
            send_queue.incoming.with_mut(|inc| {
                let IncomingBuffer::Json(json_buf) = inc else {
                    unreachable!()
                };
                json_buf.append(data);
            });

            loop {
                match decode_next_json(&send_queue.incoming, &global_this) {
                    DecodeStep::Message(result) => {
                        crate::dispatch::fold(handle_ipc_message(
                            send_queue,
                            result.message,
                            &global_this,
                        ));
                    }
                    step => return finish_decode(send_queue, &step),
                }
            }
        }
        Mode::Advanced => {
            // Advanced mode: uses length-prefix, no newline scanning needed.
            // Try to decode directly from the incoming chunk first, only buffer if needed.
            let buffered = send_queue.incoming.with_mut(|inc| {
                let IncomingBuffer::Advanced(adv_buf) = inc else {
                    unreachable!()
                };
                adv_buf.len() != 0
            });
            if !buffered {
                loop {
                    match decode_ipc_message(Mode::Advanced, data, &global_this, None) {
                        Ok(result) => {
                            let consumed = result.bytes_consumed as usize;
                            crate::dispatch::fold(handle_ipc_message(
                                send_queue,
                                result.message,
                                &global_this,
                            ));
                            if consumed < data.len() {
                                data = &data[consumed..];
                            } else {
                                return;
                            }
                        }
                        Err(IPCDecodeError::NotEnoughBytes) => {
                            send_queue.incoming.with_mut(|inc| {
                                let IncomingBuffer::Advanced(adv_buf) = inc else {
                                    unreachable!()
                                };
                                handle_oom(adv_buf.write(data));
                            });
                            log!("hit NotEnoughBytes");
                            return;
                        }
                        Err(e) => return finish_decode(send_queue, &DecodeStep::Fail(e)),
                    }
                }
            }

            // Buffer has existing data, append and process
            send_queue.incoming.with_mut(|inc| {
                let IncomingBuffer::Advanced(adv_buf) = inc else {
                    unreachable!()
                };
                handle_oom(adv_buf.write(data));
            });
            let mut slice_start: usize = 0;
            loop {
                match decode_next_advanced(&send_queue.incoming, &global_this, &mut slice_start) {
                    DecodeStep::Message(result) => {
                        crate::dispatch::fold(handle_ipc_message(
                            send_queue,
                            result.message,
                            &global_this,
                        ));
                    }
                    step => return finish_decode(send_queue, &step),
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

        pub fn on_close(send_queue: &SendQueue, _: Socket, _: c_int, _: Option<*mut c_void>) {
            // uSockets has already freed the underlying socket
            log!("NewSocketIPCHandler#onClose\n");
            send_queue.socket_closed();
        }

        pub fn on_data(send_queue: &SendQueue, _: Socket, all_data: &[u8]) {
            let global_this = send_queue.get_global_this();
            // RAII: `enter()` now, `exit()` on drop. The guard holds the raw
            // `*mut EventLoop` so `&mut EventLoop` isn't held across `on_data2`.
            let _scope = global_this.bun_vm().enter_event_loop_scope();
            on_data2(send_queue, all_data);
        }

        pub fn on_fd(send_queue: &SendQueue, _: Socket, fd: c_int) {
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
                if let Some(existing_fd) = send_queue.incoming_fd.take() {
                    log!("onFd: incoming_fd already set; overwriting");
                    let _ = existing_fd.close_allowing_standard_io(None);
                }
                send_queue.incoming_fd.set(Some(Fd::from_native(fd)));
            }
        }

        pub fn on_writable(send_queue: &SendQueue, _: Socket) {
            log!("onWritable");

            let global_this = send_queue.get_global_this();
            // RAII: see `on_data`.
            let _scope = global_this.bun_vm().enter_event_loop_scope();
            log!("IPC call continueSend() from onWritable");
            send_queue.continue_send(&global_this, ContinueSendReason::OnWritable);
        }

        pub fn on_timeout(_: &SendQueue, _: Socket) {
            log!("onTimeout");
            // unref if needed
        }

        pub fn on_end(send_queue: &SendQueue, _: Socket) {
            log!("onEnd");
            send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
        }
    }

    #[cfg(windows)]
    pub(crate) mod WindowsNamedPipe {
        use super::*;

        pub(crate) fn on_read_alloc(send_queue: &SendQueue, suggested_size: usize) -> &mut [u8] {
            log!("NewNamedPipeIPCHandler#onReadAlloc {}", suggested_size);
            // SAFETY: the returned region is the buffer's spare capacity,
            // handed to libuv for the pending read; nothing else touches
            // `incoming` until `on_read` commits the byte count.
            let inc = unsafe { &mut *send_queue.incoming.as_ptr() };
            match inc {
                IncomingBuffer::Json(json_buf) => {
                    // SAFETY: libuv writes into this region before notify_written reads.
                    let spare = unsafe { json_buf.data.uv_alloc_spare_u8(suggested_size) };
                    &mut spare[..suggested_size]
                }
                IncomingBuffer::Advanced(adv_buf) => {
                    // SAFETY: libuv writes into this region before on_read commits.
                    let spare = unsafe { adv_buf.uv_alloc_spare_u8(suggested_size) };
                    &mut spare[..suggested_size]
                }
            }
        }

        pub(crate) fn on_read_error(send_queue: &SendQueue, err: bun_sys::E) {
            log!("NewNamedPipeIPCHandler#onReadError {:?}", err);
            send_queue.close_socket_next_tick(true);
        }

        /// `nread` is the byte count libuv reported into the slice handed out
        /// by `on_read_alloc` (i.e. the tail of `send_queue.incoming` past its
        /// current `len`).
        pub(crate) fn on_read(send_queue: &SendQueue, nread: usize) {
            log!("NewNamedPipeIPCHandler#onRead {}", nread);
            let global_this = send_queue.get_global_this();
            let _scope = global_this.bun_vm().enter_event_loop_scope();

            match send_queue.mode {
                Mode::Json => {
                    // For JSON mode on Windows, use notifyWritten to update length and scan for newlines
                    send_queue.incoming.with_mut(|inc| {
                        let IncomingBuffer::Json(json_buf) = inc else {
                            unreachable!()
                        };
                        debug_assert!(json_buf.data.len() + nread <= json_buf.data.capacity());
                        // libuv wrote `nread` bytes at `data[old_len..]` via the
                        // slice returned from `on_read_alloc`; only the count is
                        // forwarded.
                        json_buf.notify_written(nread);
                    });

                    // Process complete messages using next() - avoids O(n²) re-scanning
                    loop {
                        match decode_next_json(&send_queue.incoming, &global_this) {
                            DecodeStep::Message(result) => {
                                crate::dispatch::fold(handle_ipc_message(
                                    send_queue,
                                    result.message,
                                    &global_this,
                                ));
                            }
                            step => return finish_decode(send_queue, &step),
                        }
                    }
                }
                Mode::Advanced => {
                    send_queue.incoming.with_mut(|inc| {
                        let IncomingBuffer::Advanced(adv_buf) = inc else {
                            unreachable!()
                        };
                        // SAFETY: `on_read_alloc` reserved ≥ nread bytes; libuv initialised them.
                        unsafe { adv_buf.uv_commit(nread) };
                    });
                    let mut slice_start: usize = 0;
                    loop {
                        match decode_next_advanced(
                            &send_queue.incoming,
                            &global_this,
                            &mut slice_start,
                        ) {
                            DecodeStep::Message(result) => {
                                crate::dispatch::fold(handle_ipc_message(
                                    send_queue,
                                    result.message,
                                    &global_this,
                                ));
                            }
                            step => return finish_decode(send_queue, &step),
                        }
                    }
                }
            }
        }
    }
}

#[track_caller]
pub fn ipc_serialize(
    global_object: &JSGlobalObject,
    message: JSValue,
    handle: JSValue,
    options: JSValue,
) -> JsResult<JSValue> {
    // `[[ZIG_EXPORT(zero_is_throw)]]`
    bun_jsc::cpp::IPCSerialize(global_object, message, handle, options)
}

#[track_caller]
pub(crate) fn ipc_tag_advanced_buffers(
    global_object: &JSGlobalObject,
    message: JSValue,
) -> JsResult<JSValue> {
    // `[[ZIG_EXPORT(zero_is_throw)]]`; returns null when the message holds no
    // Buffers, else the `[message, buffers]` envelope (see Ipc.ts).
    bun_jsc::cpp::IPCTagAdvancedBuffers(global_object, message)
}

#[track_caller]
pub(crate) fn ipc_restore_advanced_buffers(
    global_object: &JSGlobalObject,
    envelope: JSValue,
) -> JsResult<JSValue> {
    // `[[ZIG_EXPORT(zero_is_throw)]]`
    bun_jsc::cpp::IPCRestoreAdvancedBuffers(global_object, envelope)
}

#[track_caller]
pub(crate) fn ipc_parse(
    global_object: &JSGlobalObject,
    target: JSValue,
    serialized: JSValue,
    fd: JSValue,
) -> JsResult<JSValue> {
    // `[[ZIG_EXPORT(zero_is_throw)]]`
    bun_jsc::cpp::IPCParse(global_object, target, serialized, fd)
}
