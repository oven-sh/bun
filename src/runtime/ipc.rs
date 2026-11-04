use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::size_of;

use bun_jsc::JsCell;
use bun_ptr::RefPtr;

use crate::json_line_buffer::JSONLineBuffer;
use bun_collections::{ByteVecExt, VecExt};
use bun_core::{Output, handle_oom};
use bun_core::{String as BunString, StringView, strings};
use bun_io::KeepAlive;
use bun_io::StreamBuffer;
use bun_jsc as jsc;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::js_value::Protected;
use bun_jsc::{
    JSGlobalObject, JSObject, JSValue, JsError, JsResult, SerializedFlags, StringJsc as _, Task,
};
use bun_sys::Fd;
#[cfg(not(windows))]
use bun_sys::FdExt;

// `bun.cpp.*` — generated C++ dispatch shims for IPC handle (de)serialization
// (`IPCSerialize` / `IPCParse`) are declared once in `bun_jsc::cpp` and called
// through that module's safe wrappers; no local extern block needed.

// `SendQueue.owner` is a [`SendQueueOwner`] enum over the two concrete owner
// types (`Subprocess`, parent side, stored as a BACKREF; the thread's one
// `ipc_host::IPCInstance`, child side), cleared before the owner drops.

// TODO: rewrite this code.
/// Queue for messages sent between parent and child processes in an IPC environment. node:cluster sends json serialized messages
/// to describe different events it performs. It will send a message with an incrementing sequence number and then call a callback
/// when a message is received with an 'ack' property of the same sequence number.
pub(crate) struct InternalMsgHolder {
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
    pub(crate) fn is_ready(&self) -> bool {
        self.worker.has() && self.cb.has()
    }

    pub(crate) fn enqueue(&mut self, message: JSValue, global: &JSGlobalObject) {
        self.messages
            .push(bun_jsc::StrongOptional::create(message, global));
    }

    pub(crate) fn dispatch(
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

        event_loop.run_callback(
            bun_event_loop::ContextId::NONE,
            cb,
            global,
            worker,
            &[message, handle],
        );
        Ok(())
    }

    pub(crate) fn flush(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        debug_assert!(self.is_ready());
        let messages = core::mem::take(&mut self.messages);
        // `&mut self` carries LLVM `noalias`, but
        // `dispatch_unsafe` → `event_loop.run_callback` runs the JS IPC
        // listener which can re-enter via a fresh `&mut Self` from the
        // owner's JS wrapper and write `self.cb` / `self.worker` /
        // `self.callbacks`. With the loop body inlined, LLVM was hoisting the
        // `self.cb`/`self.worker` reads (at the top of `dispatch_unsafe`) out
        // of the loop — ASM-verified PROVEN_CACHED. Launder so each iteration
        // re-reads through an opaque pointer.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
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
    Advanced {
        bytes: Vec<u8>,
        /// How much of `bytes` has been delivered.
        delivered: usize,
    },
    /// For JSON mode - tracks newline positions to avoid O(n²) scanning
    Json(JSONLineBuffer),
}

impl IncomingBuffer {
    fn init(mode: Mode) -> IncomingBuffer {
        match mode {
            Mode::Advanced => IncomingBuffer::Advanced {
                bytes: Vec::new(),
                delivered: 0,
            },
            Mode::Json => IncomingBuffer::Json(JSONLineBuffer::new(json::max_line_len())),
        }
    }
}

// deinit: Vec<u8>/JSONLineBuffer own their storage and Drop frees it.

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum IsInternal {
    Internal,
    External,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum SerializeAndSendResult {
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
pub(crate) enum DecodedIPCMessage {
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

    /// Returns the longest body the deserializer's `WTF::Vector<uint8_t>` can store without crashing.
    fn max_message_len() -> usize {
        BunString::max_length()
    }
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
    bun_core::impl_no_uninit!(IPCMessageType);

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
                // Reject based on the header, before buffering the body.
                if message_len as usize > max_message_len() {
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

    /// Returns the longest line, not counting the newline, that can become a string.
    pub(super) fn max_line_len() -> usize {
        // The longest string in UTF-8 (at most 3 bytes per code unit), plus an internal message's tag byte.
        BunString::max_length().saturating_mul(3).saturating_add(1)
    }

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

        #[derive(Copy, Clone, Eq, PartialEq)]
        enum Kind {
            Regular,
            Internal,
        }
        let mut kind = Kind::Regular;
        if json_data.first() == Some(&2) {
            // internal message
            json_data = &json_data[1..];
            kind = Kind::Internal;
        }
        // A bare newline or a lone tag byte is invalid JSON.
        if json_data.is_empty() {
            return Err(IPCDecodeError::InvalidFormat);
        }

        let is_ascii = strings::is_all_ascii(json_data);
        let mut was_ascii_string_freed = false;

        // Use ExternalString to avoid copying data if possible.
        // This is only possible for ascii data, as that fits into latin1
        // otherwise we have to convert it utf-8 into utf16-le.
        let parsed = if is_ascii {
            // SAFETY: `json_data` outlives `s`, and the check below panics if anything kept a ref past `s`.
            // .dead if `json_data` exceeds max length
            let s = unsafe {
                BunString::create_external::<*mut bool>(
                    json_data,
                    &raw mut was_ascii_string_freed,
                    json_ipc_data_string_free_cb,
                )
            };
            if s.tag() == bun_core::Tag::Dead {
                bun_core::hint::cold();
                return Err(IPCDecodeError::Js(JsError::OutOfMemory));
            }
            s.to_js_by_parse_json(global_this)
        } else {
            StringView::borrow_utf8(json_data).to_js_by_parse_json(global_this)
        };
        // The ASCII-path free callback (`json_ipc_data_string_free_cb`) only
        // fires when the WTFStringImpl refcount hits zero — i.e. *during* the
        // drop of `s` — so the freed-flag check must follow it.
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
pub(crate) type Socket = bun_uws::SocketHandler<false>;

/// The frames of libuv's pipes on Windows, so of Node's end: https://github.com/libuv/libuv/blob/v1.51.0/src/win/pipe.c#L62-L91
#[cfg(windows)]
mod frame {
    use bun_uws::socket_transfer::SocketInfo;

    const HEADER_LEN: usize = 16;
    /// `sizeof(uv__ipc_socket_xfer_info_t)`: a `SocketInfo`, then a delayed `listen` error that Bun never sets.
    const SOCKET_LEN: usize = size_of::<SocketInfo>() + 4;

    const HAS_DATA: u32 = 1;
    const HAS_SOCKET_INFO: u32 = 2;
    const SOCKET_IS_CONNECTION: u32 = 4;

    /// How much of a frame comes before its data.
    pub(super) const fn prefix_len(has_socket: bool) -> usize {
        if has_socket {
            HEADER_LEN + SOCKET_LEN
        } else {
            HEADER_LEN
        }
    }

    /// Frames `buffer`, which starts with room for the prefix, so that both leave in one write.
    pub(super) fn seal(buffer: &mut [u8], handle: Option<&super::Handle>) -> bool {
        let (prefix, data) = buffer.split_at_mut(prefix_len(handle.is_some()));
        let Ok(data_len) = u32::try_from(data.len()) else {
            return false;
        };
        let mut flags = HAS_DATA;
        prefix.fill(0);
        if let Some(handle) = handle {
            flags |= HAS_SOCKET_INFO;
            if handle.kind == super::HandleKind::Connection {
                flags |= SOCKET_IS_CONNECTION;
            }
            prefix[HEADER_LEN..][..size_of::<SocketInfo>()].copy_from_slice(&handle.info.0);
        }
        prefix[..4].copy_from_slice(&flags.to_le_bytes());
        prefix[8..12].copy_from_slice(&data_len.to_le_bytes());
        true
    }

    pub(super) struct Invalid;

    pub(super) enum Item<'a> {
        Data(&'a [u8]),
        /// Comes before the data of its frame.
        Socket(Box<SocketInfo>),
    }

    #[derive(Default)]
    pub(super) struct Reader {
        header: [u8; HEADER_LEN],
        header_len: usize,
        /// What has come of the socket of the current frame, if that has one.
        socket: Option<Vec<u8>>,
        /// How much of the current frame's data is yet to come.
        data_remaining: u32,
    }

    fn take<'a>(input: &mut &'a [u8], at_most: usize) -> &'a [u8] {
        let (taken, rest) = input.split_at(input.len().min(at_most));
        *input = rest;
        taken
    }

    impl Reader {
        /// Takes the next item off `input`, or all of it if it has none.
        pub(super) fn next<'a>(
            &mut self,
            input: &mut &'a [u8],
        ) -> Result<Option<Item<'a>>, Invalid> {
            while !input.is_empty() {
                if let Some(socket) = &mut self.socket {
                    socket.extend_from_slice(take(input, SOCKET_LEN - socket.len()));
                    if socket.len() < SOCKET_LEN {
                        break;
                    }
                    let mut info = Box::new(SocketInfo([0; _]));
                    info.0.copy_from_slice(&socket[..size_of::<SocketInfo>()]);
                    self.socket = None;
                    return Ok(Some(Item::Socket(info)));
                }
                if self.data_remaining > 0 {
                    let data = take(input, self.data_remaining as usize);
                    self.data_remaining -= data.len() as u32;
                    return Ok(Some(Item::Data(data)));
                }
                let part = take(input, HEADER_LEN - self.header_len);
                self.header[self.header_len..][..part.len()].copy_from_slice(part);
                self.header_len += part.len();
                if self.header_len < HEADER_LEN {
                    break;
                }
                self.header_len = 0;

                let h = &self.header;
                let word = |at: usize| u32::from_le_bytes([h[at], h[at + 1], h[at + 2], h[at + 3]]);
                let (flags, data_len, reserved) = (word(0), word(8), word(12));
                let has = |flag: u32| flags & flag != 0;
                if flags & !(HAS_DATA | HAS_SOCKET_INFO | SOCKET_IS_CONNECTION) != 0
                    || reserved != 0
                    || (has(SOCKET_IS_CONNECTION) && !has(HAS_SOCKET_INFO))
                    || (data_len != 0 && !has(HAS_DATA))
                {
                    return Err(Invalid);
                }
                if has(HAS_SOCKET_INFO) {
                    self.socket = Some(Vec::with_capacity(SOCKET_LEN));
                }
                self.data_remaining = data_len;
            }
            Ok(None)
        }
    }
}

#[cfg(not(windows))]
mod frame {
    pub(super) const fn prefix_len(_has_socket: bool) -> usize {
        0
    }

    pub(super) fn seal(_: &mut [u8], _: Option<&super::Handle>) -> bool {
        true
    }
}

/// What the data of a `SendHandle` starts as: the room that `frame::seal` fills in.
fn new_send_buffer(has_handle: bool) -> StreamBuffer {
    let mut buffer = StreamBuffer::default();
    handle_oom(buffer.write(&[0; frame::prefix_len(true)][..frame::prefix_len(has_handle)]));
    buffer
}

/// What libuv on Windows has to be told about a socket that it is sent.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum HandleKind {
    Server,
    Connection,
    Datagram,
    /// An end of a named pipe, or a server on one.
    Pipe,
}

pub(crate) struct Handle {
    pub fd: Fd,
    pub js: Protected,
    pub close_on_complete: bool,
    pub cluster_seq: Option<i32>,
    #[cfg(windows)]
    kind: HandleKind,
    #[cfg(windows)]
    peer_pid: u32,
    #[cfg(windows)]
    info: Box<bun_uws::socket_transfer::SocketInfo>,
}

impl Handle {
    /// What goes to the process `peer_pid` is a duplicate of `fd` that is made now.
    pub(crate) fn new(
        fd: Fd,
        js: JSValue,
        kind: HandleKind,
        close_on_complete: bool,
        peer_pid: u32,
    ) -> Result<Self, bun_sys::Error> {
        #[cfg(not(windows))]
        {
            let _ = (kind, peer_pid);
            Ok(Self {
                fd: bun_sys::dup(fd)?,
                js: js.protected(),
                close_on_complete,
                cluster_seq: None,
            })
        }
        #[cfg(windows)]
        {
            // libuv's frame can describe a TCP socket and nothing else, and this is what it says.
            if matches!(kind, HandleKind::Datagram | HandleKind::Pipe) {
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::ENOTSUP,
                    bun_sys::Tag::write,
                ));
            }
            let mut this = Self {
                fd,
                js: js.protected(),
                close_on_complete,
                cluster_seq: None,
                kind,
                peer_pid,
                info: Box::new(bun_uws::socket_transfer::SocketInfo([0; _])),
            };
            this.export()?;
            Ok(this)
        }
    }

    /// The peer can open `info` once, so each time that the handle is sent takes a new one.
    #[cfg(windows)]
    fn export(&mut self) -> Result<(), bun_sys::Error> {
        let socket = self.fd.native() as bun_uws::LIBUS_SOCKET_DESCRIPTOR;
        match bun_uws::socket_transfer::bsd_socket_export(socket, self.peer_pid, &mut self.info) {
            0 => Ok(()),
            code => Err(bun_sys::Error::from_win32(
                bun_sys::windows::Win32Error(code as u16),
                bun_sys::Tag::dup,
            )),
        }
    }
}

#[cfg(not(windows))]
impl Drop for Handle {
    fn drop(&mut self) {
        // Owned dup/received descriptors may legitimately be 0-2 (stdio closed); close them regardless.
        let _ = self.fd.close_allowing_standard_io(None);
    }
}

pub(crate) enum CallbackList {
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

pub(crate) struct SendHandle {
    // when a message has a handle, make sure it has a new SendHandle - so that if we retry sending it,
    // we only retry sending the message with the handle, not the original message.
    pub(crate) data: StreamBuffer,
    /// A write was tried with `data`: the next one has to start with the same bytes (a Windows pipe has them queued).
    pub(crate) is_offered: bool,
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

    pub(crate) fn abort_unsent(self, global: &JSGlobalObject) {
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

pub(crate) fn close_sent_handle<'a>(
    cx: &mut JsScope<'a>,
    handle: Option<JsLocal<'a, JSObject>>,
) -> JsResult<()> {
    let global = cx.global();
    if let Some(handle) = handle {
        let js = handle.to_js();
        if let Some(f) = js.get(global, "close")? {
            if f.is_callable() {
                f.call(global, js, &[])?;
            }
        }
    }
    Ok(())
}

fn close_sent_handle_fn(global: &JSGlobalObject) -> JSValue {
    jsc::JSFunction::create(
        global,
        "",
        crate::generated_bindgen::ipc::Bun__IPC__closeSentHandle,
        1,
        Default::default(),
    )
}

// SendHandle.deinit: all fields Drop; no explicit impl needed.

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
pub(crate) enum AckNack {
    Ack,
    Nack,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum ContinueSendReason {
    NewMessageAppended,
    OnWritable,
}

/// The transport returns the number of bytes written as an `i32`.
const MAX_WRITE_LEN: usize = i32::MAX as usize;

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct SendQueue {
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
    pub close_event_sent: Cell<bool>,

    #[cfg(windows)]
    frames: JsCell<frame::Reader>,
}

#[derive(Copy, Clone)]
pub(crate) enum SendQueueOwner {
    Subprocess(core::ptr::NonNull<crate::api::bun::subprocess::Subprocess<'static>>),
    Instance,
}

impl SendQueueOwner {
    #[inline]
    pub(crate) fn kind(self) -> SendQueueOwnerKind {
        match self {
            SendQueueOwner::Subprocess(_) => SendQueueOwnerKind::Subprocess,
            SendQueueOwner::Instance => SendQueueOwnerKind::VirtualMachine,
        }
    }

    #[inline]
    fn global_this(self) -> *const JSGlobalObject {
        match self {
            // SAFETY: an attached owner is live (it holds a ref on the SendQueue).
            SendQueueOwner::Subprocess(p) => unsafe { p.as_ref() }.global_this.as_ptr(),
            SendQueueOwner::Instance => core::ptr::from_ref(
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
            SendQueueOwner::Instance => crate::ipc_host::IPCInstance::handle_ipc_close(),
        }
    }

    fn handle_ipc_message(self, msg: &DecodedIPCMessage, handle: JSValue) -> JsResult<()> {
        match self {
            // SAFETY: an attached owner is live (it holds a ref on the SendQueue).
            SendQueueOwner::Subprocess(p) => unsafe { p.as_ref() }.handle_ipc_message(msg, handle),
            SendQueueOwner::Instance => {
                crate::ipc_host::IPCInstance::handle_ipc_message(msg, handle)
            }
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
            SendQueueOwner::Instance => JSValue::ZERO,
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum SendQueueOwnerKind {
    Subprocess,
    VirtualMachine,
}

pub(crate) enum SocketUnion {
    Uninitialized,
    Open(Socket),
    Closed,
}

impl SendQueue {
    #[inline]
    fn owner_ref(&self) -> Option<SendQueueOwner> {
        self.owner.get()
    }

    pub(crate) fn detach(&self) {
        log!("SendQueue#detach");
        self.close_event_sent.set(true);
        self.close_socket(CloseReason::Failure, CloseFrom::Deinit);
        self.owner.set(None);
    }

    pub(crate) fn new(
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
            close_event_sent: Cell::new(false),
            #[cfg(windows)]
            frames: JsCell::new(frame::Reader::default()),
        });
        this.root.set(Some(this.as_non_null()));
        this
    }

    #[inline]
    fn root_ptr(&self) -> *mut SendQueue {
        self.root.get().expect("SendQueue::new sets root").as_ptr()
    }

    #[inline]
    pub(crate) fn as_ctx_ptr(&self) -> *mut SendQueue {
        self.root_ptr()
    }

    #[inline]
    fn socket_is_open(&self) -> bool {
        matches!(*self.socket.get(), SocketUnion::Open(_))
    }

    pub(crate) fn is_connected(&self) -> bool {
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
        if let Some(s) = self.get_socket() {
            s.close(match reason {
                CloseReason::Normal => bun_uws::CloseCode::Normal,
                CloseReason::Failure => bun_uws::CloseCode::Failure,
            });
        }
        self.socket_closed_notify(from != CloseFrom::Deinit);
    }

    fn socket_closed(&self) {
        self.socket_closed_notify(true);
    }

    fn socket_closed_notify(&self, notify: bool) {
        log!("SendQueue#_socketClosed");
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
    pub(crate) unsafe fn run_deferred(this: *mut SendQueue) {
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
    pub(crate) unsafe fn release_deferred_unrun(this: *mut SendQueue) {
        // SAFETY: caller contract.
        unsafe { <SendQueue as bun_ptr::CellRefCounted>::deref(this) };
    }

    pub(crate) fn close_socket_next_tick(&self, next_tick: bool) {
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

    /// User disconnect(): reports disconnected now, but closes only once a handle awaiting its ack and the queue have gone out.
    pub(crate) fn disconnect(&self) {
        if self.socket_is_open()
            && !self.pending_close.get()
            && (self.waiting_for_ack.get().is_some() || !self.queue.get().is_empty())
        {
            self.close_after_flush.set(true);
            return;
        }
        self.close_socket_next_tick(true);
    }

    /// Node's `_handleQueue !== null`: a handle of ours awaits its ack or has yet to go out.
    fn has_unacked_handle(&self) -> bool {
        self.waiting_for_ack.get().is_some()
            || self.queue.get().iter().any(|item| item.handle.is_some())
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

        self.queue.with_mut(|queue| {
            // optimal case: appending a message without a handle to the end of the queue when the last message also doesn't have a handle and isn't ack/nack
            // this is rare. it will only happen if messages stack up after sending a handle.
            let use_last = if handle.is_none() && !queue.is_empty() {
                let len = queue.len();
                let last = &queue[len - 1];
                last.handle.is_none() && !last.is_ack_nack() && !last.is_offered
            } else {
                false
            };
            if use_last {
                let len = queue.len();
                let last = &mut queue[len - 1];
                if callback.is_callable() {
                    last.callbacks.push(callback, global)?;
                }
                handle_oom(last.data.write(&payload.list[frame::prefix_len(false)..]));
            } else {
                queue.push(SendHandle {
                    data: payload,
                    is_offered: false,
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
        let waiting_for_ack = self.waiting_for_ack.get().is_some();
        self.queue.with_mut(|queue| {
            if queue.is_empty() || !queue[0].is_offered {
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
                        item.is_offered = false;
                        #[cfg(windows)]
                        if let Some(handle) = &mut item.handle
                            && handle.close_on_complete
                        {
                            // A socket that stays with its owner may be closed by now, so the peer gets its last export again.
                            let _ = handle.export();
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
        let ctx = bun_io::file_poll::get_vm_ctx(bun_io::AllocatorType::Js);
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
            if reason != ContinueSendReason::OnWritable && first.is_offered {
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
                self.write(fd);
                self.update_ref(global);
            }
        }
    }

    fn on_write_complete(&self, n: i32) {
        log!("SendQueue#_onWriteComplete {}", n);
        self.debug_log_message_queue();
        if self.queue.get().is_empty() {
            debug_assert!(false);
            return;
        }
        let global_this = self.get_global_this();

        enum Done {
            AwaitAck,
            Completed(SendHandle),
            Capped,
            Partial,
            NoProgress,
            Error,
        }
        let done = self.queue.with_mut(|queue| {
            let first = &mut queue[0];
            let to_send_len = first.data.list.len() - first.data.cursor;
            let Ok(written) = usize::try_from(n) else {
                return Done::Error;
            };
            if written == to_send_len {
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
            } else if written > 0 && written < to_send_len {
                // the item was partially sent; update the cursor and wait for writable to send the rest
                // (if we tried to send a handle, a partial write means the handle wasn't sent yet.)
                first.data.cursor += written;
                if written == MAX_WRITE_LEN {
                    Done::Capped
                } else {
                    Done::Partial
                }
            } else if written == 0 {
                // no bytes written; wait for writable
                Done::NoProgress
            } else {
                Done::Error
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
            Done::Capped => {
                // The transport accepted all `MAX_WRITE_LEN` bytes, so it won't send a writable event.
                self.continue_send(&global_this, ContinueSendReason::OnWritable);
            }
            Done::Partial | Done::NoProgress => {}
            Done::Error => {
                // error. close socket.
                self.close_socket(CloseReason::Failure, CloseFrom::User);
            }
        }
        self.update_ref(&global_this);
    }

    pub(crate) fn write_version_packet(&self, global: &JSGlobalObject) {
        log!("SendQueue#writeVersionPacket");
        #[cfg(debug_assertions)]
        debug_assert!(self.has_written_version.get() == 0);
        debug_assert!(self.queue.get().is_empty());
        debug_assert!(self.waiting_for_ack.get().is_none());
        let bytes = get_version_packet(self.mode);
        if !bytes.is_empty() {
            self.queue.with_mut(|queue| {
                queue.push(SendHandle {
                    data: new_send_buffer(false),
                    is_offered: false,
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

    pub(crate) fn serialize_and_send(
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
        let mut payload = new_send_buffer(handle.is_some());
        let payload_length = match serialize(mode, &mut payload, global, value, is_internal) {
            Ok(n) => n,
            Err(_) => return SerializeAndSendResult::Failure,
        };
        debug_assert!(payload.list.len() == frame::prefix_len(handle.is_some()) + payload_length);
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

    /// The message that says what the descriptor is comes after it.
    fn set_incoming_fd(&self, fd: Option<Fd>) {
        if let Some(unclaimed) = self.incoming_fd.replace(fd) {
            log!("incoming_fd: nothing took {}", unclaimed);
            close_received_fd(unclaimed);
        }
    }

    fn get_socket(&self) -> Option<Socket> {
        match *self.socket.get() {
            SocketUnion::Open(s) => Some(s),
            _ => None,
        }
    }

    /// The process that a handle is exported to, for the end of the channel that did not start it.
    pub(crate) fn peer_pid(&self) -> u32 {
        #[cfg(windows)]
        {
            use bun_sys::windows::{parent_pid, pipe_peer_pid};
            self.get_socket()
                .map(|socket| socket.fd())
                .filter(|pipe| pipe.is_valid())
                .and_then(|pipe| pipe_peer_pid(pipe.native()))
                .unwrap_or_else(parent_pid)
        }
        #[cfg(not(windows))]
        0
    }

    /// The outbound bytes are read from `queue[0]` *inside* this method.
    fn write(&self, fd: Option<Fd>) {
        let Some(socket) = self.get_socket() else {
            self.on_write_complete(-1);
            return;
        };
        let n: i32 = self.queue.with_mut(|queue| {
            let first = &mut queue[0];
            if !first.is_offered && !frame::seal(&mut first.data.list, first.handle.as_ref()) {
                return -1;
            }
            first.is_offered = true;
            let data = &first.data.list[first.data.cursor..];
            log!("SendQueue#write len {}", data.len());
            let data = &data[..data.len().min(MAX_WRITE_LEN)];
            #[cfg(not(windows))]
            if let Some(fd) = fd {
                return socket.write_fd(data, fd.native());
            }
            // The frame says how to open the handle.
            #[cfg(windows)]
            let _ = fd;
            socket.write(data)
        });
        self.on_write_complete(n);
    }

    fn get_global_this(&self) -> bun_jsc::GlobalRef {
        let owner = self.owner_ref().expect("SendQueue used after detach");
        bun_jsc::GlobalRef::from(JSGlobalObject::opaque_ref(owner.global_this()))
    }
}

impl bun_event_loop::Taskable for SendQueue {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::SendQueueDeferred;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the SendQueue root queued with a held ref.
        unsafe { SendQueue::release_deferred_unrun(this) }
    }
    /// The channel's own close hop.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
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
        self.set_incoming_fd(None);
    }
}

const MAX_HANDLE_RETRANSMISSIONS: u32 = 3;

/// Closes a descriptor that came over the channel and that nothing took.
fn close_received_fd(fd: Fd) {
    #[cfg(windows)]
    bun_uws::socket_transfer::bsd_close_socket(fd.native() as bun_uws::LIBUS_SOCKET_DESCRIPTOR);
    #[cfg(not(windows))]
    let _ = fd.close_allowing_standard_io(None);
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
        JSValue::js_number_from_int32(fd.crt())
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

    // As in Node, a disconnect() that waits for the ack of a handle still delivers, and any other delivers nothing more.
    if !send_queue.is_connected() && !send_queue.has_unacked_handle() {
        send_queue.set_incoming_fd(None);
        return Ok(());
    }

    if let Some(icmd) = internal_command {
        match icmd {
            IPCCommand::Handle(msg_data) => {
                let ack = send_queue.incoming_fd.get().is_some();

                let packet = if ack {
                    get_ack_packet(send_queue.mode)
                } else {
                    get_nack_packet(send_queue.mode)
                };
                let mut handle = SendHandle {
                    data: new_send_buffer(false),
                    is_offered: false,
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
                let fd: Fd = send_queue.incoming_fd.take().unwrap();

                let Some(owner) = send_queue.owner_ref() else {
                    close_received_fd(fd);
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
                    close_received_fd(fd);
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
                    let ack = send_queue.incoming_fd.get().is_some();
                    let packet = if ack {
                        get_ack_packet(send_queue.mode)
                    } else {
                        get_nack_packet(send_queue.mode)
                    };
                    let mut reply = SendHandle {
                        data: new_send_buffer(false),
                        is_offered: false,
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
                    close_received_fd(fd);
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
            if json_buf.is_too_long() {
                // Fail the same way as a complete line that's too long to become a string.
                return DecodeStep::Fail(IPCDecodeError::Js(JsError::OutOfMemory));
            }
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

fn decode_next_advanced(incoming: &JsCell<IncomingBuffer>, global: &JSGlobalObject) -> DecodeStep {
    incoming.with_mut(|inc| {
        let IncomingBuffer::Advanced { bytes, delivered } = inc else {
            unreachable!()
        };
        match decode_ipc_message(Mode::Advanced, &bytes[*delivered..], global, None) {
            Ok(r) => {
                *delivered += r.bytes_consumed as usize;
                if *delivered == bytes.len() {
                    bytes.clear();
                    *delivered = 0;
                }
                DecodeStep::Message(r)
            }
            Err(IPCDecodeError::NotEnoughBytes) => {
                // copy the remaining bytes to the start of the buffer
                bytes.drain_front(*delivered);
                *delivered = 0;
                DecodeStep::Wait
            }
            Err(e) => DecodeStep::Fail(e),
        }
    })
}

/// Runs no JavaScript.
fn buffer_data(send_queue: &SendQueue, data: &[u8]) {
    send_queue.incoming.with_mut(|inc| match inc {
        IncomingBuffer::Advanced { bytes, .. } => {
            handle_oom(bytes.write(data));
        }
        // Scans only the new data for a newline.
        IncomingBuffer::Json(json_buf) => json_buf.append(data),
    });
}

/// The buffer keeps where the next message starts.
fn deliver_buffered(send_queue: &SendQueue, global_this: &JSGlobalObject) {
    loop {
        let step = match send_queue.mode {
            Mode::Json => decode_next_json(&send_queue.incoming, global_this),
            Mode::Advanced => decode_next_advanced(&send_queue.incoming, global_this),
        };
        match step {
            DecodeStep::Message(result) => {
                crate::dispatch::fold(handle_ipc_message(send_queue, result.message, global_this));
            }
            step => return finish_decode(send_queue, &step),
        }
    }
}

fn on_data2(send_queue: &SendQueue, global_this: &JSGlobalObject, data: &[u8]) {
    let nothing_is_buffered = send_queue
        .incoming
        .with_mut(|inc| matches!(inc, IncomingBuffer::Advanced { bytes, .. } if bytes.is_empty()));
    if nothing_is_buffered {
        // Mostly `data` is one message, and this way that is not copied.
        match decode_ipc_message(Mode::Advanced, data, global_this, None) {
            Ok(result) => {
                buffer_data(send_queue, &data[result.bytes_consumed as usize..]);
                crate::dispatch::fold(handle_ipc_message(send_queue, result.message, global_this));
                return deliver_buffered(send_queue, global_this);
            }
            Err(IPCDecodeError::NotEnoughBytes) => {}
            Err(e) => return finish_decode(send_queue, &DecodeStep::Fail(e)),
        }
    }
    buffer_data(send_queue, data);
    deliver_buffered(send_queue, global_this);
}

#[allow(non_snake_case)]
pub(crate) mod IPCHandlers {
    use super::*;

    pub(crate) fn on_close(send_queue: &SendQueue, _: Socket, _: c_int, _: Option<*mut c_void>) {
        // uSockets has already freed the underlying socket
        log!("NewSocketIPCHandler#onClose\n");
        send_queue.socket_closed();
    }

    pub(crate) fn on_data(send_queue: &SendQueue, _: Socket, all_data: &[u8]) {
        let global_this = send_queue.get_global_this();
        // RAII: `enter()` now, `exit()` on drop. The guard holds the raw
        // `*mut EventLoop` so `&mut EventLoop` isn't held across `on_data2`.
        let _scope = global_this.bun_vm().enter_event_loop_scope();
        #[cfg(not(windows))]
        on_data2(send_queue, &global_this, all_data);
        #[cfg(windows)]
        {
            let mut rest = all_data;
            loop {
                match send_queue.frames.with_mut(|frames| frames.next(&mut rest)) {
                    Ok(Some(frame::Item::Data(data))) if rest.is_empty() => {
                        return on_data2(send_queue, &global_this, data);
                    }
                    Ok(Some(frame::Item::Data(data))) => buffer_data(send_queue, data),
                    Ok(Some(frame::Item::Socket(mut info))) => {
                        let mut error = 0;
                        let socket =
                            bun_uws::socket_transfer::bsd_socket_import(&mut info, &mut error);
                        log!("socket in frame: {} (error {})", socket, error);
                        send_queue.set_incoming_fd(
                            (socket != bun_uws::LIBUS_SOCKET_DESCRIPTOR::MAX)
                                .then(|| Fd::from_system(socket as *mut c_void)),
                        );
                    }
                    Ok(None) => return deliver_buffered(send_queue, &global_this),
                    Err(frame::Invalid) => {
                        deliver_buffered(send_queue, &global_this);
                        return send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                    }
                }
            }
        }
    }

    pub(crate) fn on_fd(send_queue: &SendQueue, _: Socket, fd: c_int) {
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
            send_queue.set_incoming_fd(Some(Fd::from_native(fd)));
        }
    }

    pub(crate) fn on_writable(send_queue: &SendQueue, _: Socket) {
        log!("onWritable");

        let global_this = send_queue.get_global_this();
        // RAII: see `on_data`.
        let _scope = global_this.bun_vm().enter_event_loop_scope();
        log!("IPC call continueSend() from onWritable");
        send_queue.continue_send(&global_this, ContinueSendReason::OnWritable);
    }

    pub(crate) fn on_timeout(_: &SendQueue, _: Socket) {
        log!("onTimeout");
        // unref if needed
    }

    pub(crate) fn on_end(send_queue: &SendQueue, _: Socket) {
        log!("onEnd");
        send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
    }
}

#[track_caller]
pub(crate) fn ipc_serialize(
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
