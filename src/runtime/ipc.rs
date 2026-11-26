use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::size_of;
use std::collections::VecDeque;

use bun_jsc::JsCell;
#[cfg(windows)]
use bun_ptr::CellExt as _;
use bun_ptr::{Attached, Detach, RefPtr};

use crate::json_line_buffer::JSONLineBuffer;
use bun_collections::VecExt;
use bun_core::{Output, handle_oom};
use bun_core::{String as BunString, StringView, strings};
use bun_io::KeepAlive;
use bun_io::StreamBuffer;
#[cfg(windows)]
use bun_io::pipe_reader::{ReadEvent, ReaderFlags};
#[cfg(windows)]
use bun_io::{
    BufferedReader, IoEvent, Owner, Pipe, PollTag, ReadResult, StreamingWriter, WriteHandler,
    WriteStatus,
};
use bun_jsc as jsc;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::js_value::Protected;
#[cfg(windows)]
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    JSGlobalObject, JSObject, JSValue, JsError, JsResult, SerializedFlags, StringJsc as _, Task,
};
#[cfg(not(windows))]
use bun_sys::CloseOnDrop;
use bun_sys::Fd;
#[cfg(windows)]
use bun_sys::windows_format::ipc_frame;

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

    // `deinit` body only freed owned fields (Strongs, map, Vec). All of those impl Drop in
    // Rust, so no explicit Drop body is needed.
}

bun_core::define_scoped_log!(log, IPC, visible);

/// Union type that switches between StreamBuffer (for advanced mode)
/// and JSONLineBuffer (for JSON mode with optimized newline tracking).
enum IncomingBuffer {
    /// For advanced mode - uses length-prefix, no scanning needed.
    /// The cursor is not a local of the reader: a handler can run the event loop, which reads on from it.
    Advanced(StreamBuffer),
    /// For JSON mode - tracks newline positions to avoid O(n²) scanning
    Json(JSONLineBuffer),
}

impl IncomingBuffer {
    fn init(mode: Mode) -> IncomingBuffer {
        match mode {
            Mode::Advanced => IncomingBuffer::Advanced(StreamBuffer::default()),
            Mode::Json => IncomingBuffer::Json(JSONLineBuffer::new(json::max_line_len())),
        }
    }
}

// deinit: StreamBuffer/JSONLineBuffer own their storage and Drop frees it.

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
    pub(crate) message: Unrestored,
}

pub(crate) enum Unrestored {
    Plain(DecodedIPCMessage),
    /// A `[message, buffers]` envelope.
    WithBuffers(JSValue),
}

impl Unrestored {
    /// Can run script, so nothing that was read can be borrowed.
    fn restore(self, global: &JSGlobalObject) -> JsResult<DecodedIPCMessage> {
        match self {
            Unrestored::Plain(message) => Ok(message),
            Unrestored::WithBuffers(envelope) => {
                ipc_restore_advanced_buffers(global, envelope).map(DecodedIPCMessage::Data)
            }
        }
    }
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
                message: Unrestored::Plain(DecodedIPCMessage::Version(message_len)),
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
                let deserialized = JSValue::deserialize(message, global)?;

                Ok(DecodeIPCMessageResult {
                    bytes_consumed: HEADER_LENGTH_U32 + message_len,
                    message: if x == IPCMessageType::SerializedInternalMessage as u8 {
                        Unrestored::Plain(DecodedIPCMessage::Internal(deserialized))
                    } else if x == IPCMessageType::SerializedMessageWithBuffers as u8 {
                        Unrestored::WithBuffers(deserialized)
                    } else {
                        Unrestored::Plain(DecodedIPCMessage::Data(deserialized))
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

    extern "C" fn json_ipc_data_string_free_cb(context: &Cell<bool>, _: *mut c_void, _: usize) {
        context.set(true);
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
        let was_ascii_string_freed = Cell::new(false);

        // Use ExternalString to avoid copying data if possible.
        // This is only possible for ascii data, as that fits into latin1
        // otherwise we have to convert it utf-8 into utf16-le.
        let parsed = if is_ascii {
            // SAFETY: `json_data` and the flag outlive `s`, and the check below panics if anything kept a ref past `s`.
            // .dead if `json_data` exceeds max length
            let s = unsafe {
                BunString::create_external::<&Cell<bool>>(
                    json_data,
                    &was_ascii_string_freed,
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
        if is_ascii && !was_ascii_string_freed.get() {
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
                message: Unrestored::Plain(DecodedIPCMessage::Data(deserialized)),
            }),
            Kind::Internal => Ok(DecodeIPCMessageResult {
                bytes_consumed: idx + 1,
                message: Unrestored::Plain(DecodedIPCMessage::Internal(deserialized)),
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

pub(crate) struct Handle {
    #[cfg(windows)]
    socket: ExportedSocket,
    #[cfg(not(windows))]
    duplicate: CloseOnDrop,
    pub js: Protected,
    pub close_on_complete: bool,
    pub cluster_seq: Option<i32>,
}

/// `WSAPROTOCOL_INFOW`.
#[cfg(windows)]
#[repr(C, align(4))]
struct ProtocolInfo([u8; ipc_frame::SOCKET_INFO_LEN]);

/// A socket duplicated for the peer process with `WSADuplicateSocketW`.
#[cfg(windows)]
struct ExportedSocket {
    fd: Fd,
    peer_pid: u32,
    info: Box<ProtocolInfo>,
    is_connected: bool,
}

#[cfg(windows)]
impl ExportedSocket {
    fn new(fd: Fd, peer_pid: u32) -> Option<Self> {
        let mut info = Box::new(ProtocolInfo([0; ipc_frame::SOCKET_INFO_LEN]));
        let socket = fd.native() as bun_uws::LIBUS_SOCKET_DESCRIPTOR;
        // SAFETY: `info` has the size and alignment of the `WSAPROTOCOL_INFOW` that the call writes.
        let rc = unsafe {
            bun_uws::socket_transfer::bsd_socket_export(socket, peer_pid, (&raw mut *info).cast())
        };
        (rc == 0).then(|| Self {
            fd,
            peer_pid,
            info,
            is_connected: bun_uws::socket_transfer::bsd_socket_is_listening(socket) == 0,
        })
    }

    fn as_socket_transfer(&self) -> ipc_frame::SocketTransfer<'_> {
        ipc_frame::SocketTransfer {
            info: &self.info.0,
            is_connected: self.is_connected,
        }
    }
}

#[cfg(windows)]
pub(crate) struct ImportedSocket(Fd);

#[cfg(windows)]
impl ImportedSocket {
    fn fd(&self) -> Fd {
        self.0
    }

    fn into_raw(self) -> Fd {
        core::mem::ManuallyDrop::new(self).0
    }
}

#[cfg(windows)]
impl Drop for ImportedSocket {
    fn drop(&mut self) {
        let socket = self.0.native() as bun_uws::LIBUS_SOCKET_DESCRIPTOR;
        bun_uws::socket_transfer::bsd_close_socket(socket);
    }
}

#[cfg(windows)]
fn import_socket(info: &[u8; ipc_frame::SOCKET_INFO_LEN]) -> Option<ImportedSocket> {
    let mut info = ProtocolInfo(*info);
    let mut err = 0;
    // SAFETY: `info` has the size and alignment of the `WSAPROTOCOL_INFOW` that the call reads.
    let socket = unsafe {
        bun_uws::socket_transfer::bsd_socket_import((&raw mut info).cast(), &raw mut err)
    };
    (socket != bun_uws::LIBUS_SOCKET_DESCRIPTOR::MAX)
        .then(|| ImportedSocket(Fd::from_system(socket as *mut c_void)))
}

impl Handle {
    #[cfg(windows)]
    pub(crate) fn init_export(
        fd: Fd,
        peer_pid: u32,
        js: JSValue,
        close_on_complete: bool,
    ) -> Option<Self> {
        Some(Self {
            socket: ExportedSocket::new(fd, peer_pid)?,
            js: js.protected(),
            close_on_complete,
            cluster_seq: None,
        })
    }

    #[cfg(not(windows))]
    pub(crate) fn init_dup(
        fd: Fd,
        js: JSValue,
        close_on_complete: bool,
    ) -> Result<Self, bun_sys::Error> {
        Ok(Self {
            duplicate: CloseOnDrop::new(bun_sys::dup(fd)?),
            js: js.protected(),
            close_on_complete,
            cluster_seq: None,
        })
    }

    #[cfg(not(windows))]
    fn fd(&self) -> Fd {
        self.duplicate.fd()
    }
}

pub(crate) enum CallbackList {
    AckNack,
    None,
    /// js callable
    Callback(Protected),
    /// js array, and its length
    CallbackArray(Protected, u32),
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
                *self = CallbackList::CallbackArray(arr, 2);
            }
            CallbackList::CallbackArray(arr, len) => {
                // Not `push`, which runs a setter on `Array.prototype` while the queue is borrowed.
                arr.value().put_index(global, *len, callback)?;
                *len += 1;
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
            CallbackList::CallbackArray(arr, _) => {
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

#[cfg(windows)]
struct WindowsState {
    reader: BufferedReader,
    writer: StreamingWriter,
    frame_decoder: Cell<ipc_frame::Decoder>,
    /// `Some` while a read is being decoded: what was read under a listener that runs the event loop.
    held_input: Cell<Option<Vec<u8>>>,
    /// Message bytes in the in-flight write, excluding the frame header.
    inflight_write_len: Cell<Option<usize>>,
    /// An ACK or NACK that arrived before the write of its handle reported completion.
    deferred_ack_nack: Cell<Option<AckNack>>,
    try_close_after_write: Cell<bool>,
    /// Messages sent since microtasks last drained.
    burst_message_count: Cell<u32>,
    is_flush_scheduled: Cell<bool>,
    /// The parent process. Only set in a child.
    parent: core::cell::OnceCell<(u32, std::os::windows::io::OwnedHandle)>,
}

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
    pub(crate) queue: JsCell<VecDeque<SendHandle>>,
    pub(crate) waiting_for_ack: JsCell<Option<SendHandle>>,

    pub(crate) retry_count: Cell<u32>,
    pub(crate) keep_alive: KeepAlive,
    #[cfg(debug_assertions)]
    pub(crate) has_written_version: Cell<u8>,
    pub(crate) mode: Mode,
    pub internal_msg_queue: JsCell<InternalMsgHolder>,
    incoming: JsCell<IncomingBuffer>,
    #[cfg(not(windows))]
    pub(crate) incoming_fd: Cell<Option<CloseOnDrop>>,
    #[cfg(windows)]
    pub(crate) incoming_fd: Cell<Option<ImportedSocket>>,

    pub socket: JsCell<SocketUnion>,
    pub(crate) owner: Cell<Option<SendQueueOwner>>,

    pub(crate) deferred_scheduled: Cell<bool>,
    pub(crate) pending_close: Cell<bool>,
    read_before_close: Cell<bool>,
    /// A user disconnect() waiting for the handle queue to flush; reported as disconnected meanwhile, cleared by any real close.
    pub(crate) close_after_flush: Cell<bool>,
    pub(crate) pending_after_close: Cell<bool>,
    pub(crate) write_in_progress: Cell<bool>,
    pub close_event_sent: Cell<bool>,

    #[cfg(windows)]
    windows: WindowsState,
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
            SendQueueOwner::Instance => {
                core::ptr::from_ref(bun_jsc::virtual_machine::VirtualMachine::get().global())
            }
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

    fn takes_cluster_handle(self) -> bool {
        match self {
            SendQueueOwner::Subprocess(_) => false,
            SendQueueOwner::Instance => crate::node::node_cluster_binding::is_child_listening(),
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

/// The pipe is in `SendQueue::windows`.
#[cfg(windows)]
pub(crate) type SocketType = ();
#[cfg(not(windows))]
pub(crate) type SocketType = Socket;

pub(crate) enum SocketUnion {
    Uninitialized,
    Open(SocketType),
    Closed,
}

impl Detach for SendQueue {
    fn detach(&self) {
        log!("SendQueue#detach");
        self.close_event_sent.set(true);
        self.close_socket(CloseReason::Failure, CloseFrom::Deinit);
        self.owner.set(None);
    }
}

impl SendQueue {
    #[inline]
    fn owner_ref(&self) -> Option<SendQueueOwner> {
        self.owner.get()
    }

    /// Script can run the event loop until the close is reported. This keeps a `Subprocess`, and so `self`, past that.
    fn hold_owner(&self) -> Option<jsc::EnsureStillAlive> {
        Some(jsc::EnsureStillAlive(self.owner_ref()?.this_jsvalue()))
    }

    pub(crate) fn new(
        mode: Mode,
        owner: Option<SendQueueOwner>,
        socket: SocketUnion,
    ) -> Attached<SendQueue> {
        log!("SendQueue#init");
        let this = RefPtr::new(Self {
            ref_count: Cell::new(1),
            root: Cell::new(None),
            queue: JsCell::new(VecDeque::new()),
            waiting_for_ack: JsCell::new(None),
            retry_count: Cell::new(0),
            keep_alive: KeepAlive::default(),
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
            read_before_close: Cell::new(false),
            close_after_flush: Cell::new(false),
            pending_after_close: Cell::new(false),
            write_in_progress: Cell::new(false),
            close_event_sent: Cell::new(false),
            #[cfg(windows)]
            windows: WindowsState {
                reader: BufferedReader::init(),
                writer: StreamingWriter::default(),
                frame_decoder: Cell::default(),
                held_input: Cell::new(None),
                inflight_write_len: Cell::new(None),
                try_close_after_write: Cell::new(false),
                deferred_ack_nack: Cell::new(None),
                burst_message_count: Cell::new(0),
                is_flush_scheduled: Cell::new(false),
                parent: core::cell::OnceCell::new(),
            },
        });
        this.root.set(Some(this.as_non_null()));
        this.into()
    }

    #[inline]
    fn root_ptr(&self) -> *mut SendQueue {
        self.root.get().expect("SendQueue::new sets root").as_ptr()
    }

    #[cfg(not(windows))]
    #[inline]
    pub(crate) fn as_ctx_ptr(&self) -> *mut SendQueue {
        self.root_ptr()
    }

    #[inline]
    fn socket_is_open(&self) -> bool {
        matches!(*self.socket.get(), SocketUnion::Open(_))
    }

    pub(crate) fn is_connected(&self) -> bool {
        #[cfg(windows)]
        if self.windows.try_close_after_write.get() {
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
        #[cfg(windows)]
        {
            let _ = reason;
            if from != CloseFrom::Deinit {
                self.flush_deferred_write();
            }
            self.windows.reader.pause();
            if self.windows.inflight_write_len.get().is_some() && from != CloseFrom::Deinit {
                log!("SendQueue#closeSocket -> mark ready for close");
                // currently writing; wait for the write to complete
                self.windows.try_close_after_write.set(true);
                return;
            }
        }
        #[cfg(not(windows))]
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
        #[cfg(windows)]
        {
            self.unschedule_flush();
            self.windows.inflight_write_len.set(None);
            self.windows.reader.deinit();
            self.windows.writer.close_without_reporting(self);
        }
        self.keep_alive.disable();
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
        // SAFETY: the root of the live allocation that holds `self`.
        let queue = unsafe { RefPtr::init_ref(self.root_ptr()) };
        self.get_global_this()
            .bun_vm()
            .event_loop()
            .enqueue_task(Task::from_ref::<Self>(queue));
    }

    /// `task_tag::SendQueueDeferred` dispatch, under the task's ref: drain the pending flags.
    pub(crate) fn run_deferred(&self) {
        let _alive = self.hold_owner();
        self.deferred_scheduled.set(false);
        if self.pending_close.get() {
            log!("SendQueue#closeSocketTask");
            #[cfg(not(windows))]
            if self.read_before_close.get()
                && let SocketUnion::Open(socket) = *self.socket.get()
            {
                // `pending_close` is still set, so a callback finds the channel disconnected.
                socket.read_now();
            }
            #[cfg(windows)]
            if self.read_before_close.get() {
                let reader = &self.windows.reader;
                // No read is requested while a listener runs.
                reader.pause();
                let _ = reader.unpause();
                // What was read ahead, then what is in the pipe.
                for event in core::iter::from_fn(|| reader.try_read()).take(2) {
                    self.on_io(event);
                }
            }
            self.pending_close.set(false);
            self.close_socket(CloseReason::Normal, CloseFrom::User);
        }
        if self.pending_after_close.replace(false) {
            log!("SendQueue#_onAfterIPCClosed");
            if !self.close_event_sent.replace(true) {
                let global = self.get_global_this();
                #[cfg(windows)]
                self.incoming_fd.set(None);
                self.write_in_progress.set(false);
                if let Some(item) = self.waiting_for_ack.with_mut(|w| w.take()) {
                    item.complete(&global);
                }
                // on_write_complete already dequeued everything fully written; the rest was never delivered.
                for item in self.queue.with_mut(std::mem::take) {
                    item.abort_unsent(&global);
                }
                if let Some(owner) = self.owner.get() {
                    owner.handle_ipc_close();
                }
            }
        }
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

    /// The peer's process has exited. Its last messages can still be in the socket.
    pub(crate) fn close_after_exit(&self) {
        if self.is_connected() || self.close_after_flush.get() {
            self.read_before_close.set(true);
        }
        self.close_socket_next_tick(true);
    }

    /// User disconnect(): reports disconnected now but, like node, closes only once a handle awaiting its ack and the queue behind it have gone out.
    pub(crate) fn disconnect(&self) {
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
            // this is rare. it will only happen if messages stack up after sending a handle.
            let use_last = if handle.is_none() && !queue.is_empty() {
                let len = queue.len();
                let last = &queue[len - 1];
                last.handle.is_none()
                    && !last.is_ack_nack()
                    && last.data.cursor == 0
                    && !(len == 1 && write_in_progress)
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
                queue.push_back(SendHandle {
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
            #[cfg(windows)]
            if self.write_in_progress.get()
                && self
                    .queue
                    .get()
                    .front()
                    .is_some_and(|first| first.handle.is_some())
            {
                return self.windows.deferred_ack_nack.set(Some(ack_nack));
            }
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
                        if let Some(Handle { socket, .. }) = &mut item.handle
                            && !self.pending_close.get()
                            && !self.windows.try_close_after_write.get()
                            && let Some(reexported) =
                                ExportedSocket::new(socket.fd, socket.peer_pid)
                        {
                            *socket = reexported;
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
        // routed through `bun_io::js_vm_ctx` which `bun_runtime` registers.
        let ctx = bun_io::js_vm_ctx();
        let should_ref = self.should_ref();
        if should_ref {
            self.keep_alive.ref_(ctx);
        } else {
            self.keep_alive.unref(ctx);
        }
    }

    fn continue_send(&self, global: &JSGlobalObject, mut reason: ContinueSendReason) {
        while let Some(next) = self.send_next(global, reason) {
            reason = next;
        }
        self.update_ref(global);
        #[cfg(windows)]
        if self.windows.try_close_after_write.get() {
            self.close_socket(CloseReason::Normal, CloseFrom::User);
        }
    }

    /// Returns the reason to go on with the next item, if there is one.
    fn send_next(
        &self,
        global: &JSGlobalObject,
        reason: ContinueSendReason,
    ) -> Option<ContinueSendReason> {
        log!(
            "IPC continueSend: {}",
            match reason {
                ContinueSendReason::NewMessageAppended => "new_message_appended",
                ContinueSendReason::OnWritable => "on_writable",
            }
        );
        self.debug_log_message_queue();

        if self.write_in_progress.get() {
            return None;
        }

        enum Next {
            Nothing,
            EmptyItem(SendHandle),
            Send,
        }
        let waiting_for_ack = self.waiting_for_ack.get().is_some();
        let next = self.queue.with_mut(|queue| {
            let Some(first) = queue.front() else {
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
                return queue.pop_front().map_or(Next::Nothing, Next::EmptyItem);
            }
            Next::Send
        });
        match next {
            Next::Nothing => {
                if self.close_after_flush.get() && !waiting_for_ack && self.queue.get().is_empty() {
                    self.close_socket_next_tick(true);
                }
                None
            }
            Next::EmptyItem(itm) => {
                itm.complete(global); // call the callback & deinit
                log!("IPC call continueSend() from empty item");
                Some(reason)
            }
            #[cfg(windows)]
            Next::Send
                if reason == ContinueSendReason::NewMessageAppended && self.try_defer_write() =>
            {
                None
            }
            Next::Send => {
                debug_assert!(!self.write_in_progress.get());
                self.write_in_progress.set(true);
                self.write().then_some(ContinueSendReason::OnWritable)
            }
        }
    }

    /// Returns whether to write on.
    fn on_write_complete(&self, n: i32) -> bool {
        log!("SendQueue#_onWriteComplete {}", n);
        self.debug_log_message_queue();
        if !self.write_in_progress.get() || self.queue.get().is_empty() {
            debug_assert!(false);
            return false;
        }
        self.write_in_progress.set(false);

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
                    let item = queue.pop_front();
                    self.waiting_for_ack.with_mut(|w| {
                        if w.is_some() {
                            log!("[error] already waiting for ack. this should never happen.");
                        }
                        // shift the item off the queue and move it to waiting_for_ack
                        *w = item;
                    });
                    Done::AwaitAck
                } else {
                    // the message was fully sent, but there may be more items in the queue.
                    // shift the queue and try to send the next item immediately.
                    queue.pop_front().map_or(Done::Error, Done::Completed)
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
                #[cfg(windows)]
                if let Some(ack_nack) = self.windows.deferred_ack_nack.take() {
                    self.on_ack_nack(&self.get_global_this(), ack_nack);
                    return false;
                }
                true
            }
            Done::Completed(item) => {
                item.complete(&self.get_global_this()); // call the callback & deinit
                true
            }
            // The transport accepted all `MAX_WRITE_LEN` bytes, so it won't send a writable event.
            Done::Capped => true,
            Done::Partial | Done::NoProgress => false,
            Done::Error => {
                // error. close socket.
                self.close_socket(CloseReason::Failure, CloseFrom::User);
                false
            }
        }
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
                queue.push_back(SendHandle {
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
        let mut payload = StreamBuffer::default();
        let payload_length = match serialize(mode, &mut payload, global, value, is_internal) {
            Ok(n) => n,
            Err(_) => return SerializeAndSendResult::Failure,
        };
        debug_assert!(payload.list.len() == payload_length);
        if self.close_event_sent.get() {
            // The queue was emptied for the last time, maybe while script serialized `value`.
            let unsent = SendHandle {
                data: payload,
                handle,
                callbacks: CallbackList::None,
            };
            unsent.abort_unsent(global);
        } else if self
            .start_message(global, callback, handle, payload)
            .is_err()
        {
            return SerializeAndSendResult::Failure;
        } else {
            log!("IPC call continueSend() from serializeAndSend");
            self.continue_send(global, ContinueSendReason::NewMessageAppended);
        }

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

    #[cfg(not(windows))]
    fn get_socket(&self) -> Option<SocketType> {
        match *self.socket.get() {
            SocketUnion::Open(s) => Some(s),
            _ => None,
        }
    }

    /// Coalesces a burst of messages into large writes. Returns `true` if the write is left to `flush_deferred_write`.
    #[cfg(windows)]
    fn try_defer_write(&self) -> bool {
        const MAX_UNCOALESCED_MESSAGES: u32 = 3;
        const MAX_COALESCED_LEN: usize = 64 * 1024;
        let vm = VirtualMachine::get();
        if vm.is_inside_deferred_task_queue.get() || vm.is_shutting_down() || !self.socket_is_open()
        {
            return false;
        }
        if !self.windows.is_flush_scheduled.replace(true) {
            for tasks in vm.deferred_tasks_of_both_loops() {
                tasks.post_task(self.root.get().map(|root| root.cast()), Self::on_flush);
            }
        }
        self.windows.burst_message_count.update(|count| count + 1);
        if self.windows.burst_message_count.get() == MAX_UNCOALESCED_MESSAGES + 1 {
            // A microtask checkpoint does not follow every call into script, but it follows every wait.
            vm.wakeup();
        }
        let queue = self.queue.get();
        self.windows.burst_message_count.get() > MAX_UNCOALESCED_MESSAGES
            && queue.len() == 1
            && queue[0].handle.is_none()
            && queue[0].data.list.len() < MAX_COALESCED_LEN
    }

    #[cfg(windows)]
    fn unschedule_flush(&self) {
        if self.windows.is_flush_scheduled.take() {
            for tasks in VirtualMachine::get().deferred_tasks_of_both_loops() {
                tasks.unregister_task(self.root.get().map(|root| root.cast()));
            }
        }
    }

    #[cfg(windows)]
    unsafe extern "C" fn on_flush(this: *mut c_void) -> bool {
        // SAFETY: the root of a `SendQueue`, which `socket_closed_notify` unregisters before it is freed.
        let this = unsafe { RefPtr::init_ref(this.cast::<SendQueue>()) };
        this.unschedule_flush();
        this.flush_deferred_write();
        this.windows.is_flush_scheduled.get()
    }

    #[cfg(windows)]
    fn flush_deferred_write(&self) {
        if self.windows.burst_message_count.take() > 0 && self.socket_is_open() {
            self.continue_send(&self.get_global_this(), ContinueSendReason::OnWritable);
        }
    }

    #[cfg(windows)]
    pub(crate) fn parent_pid(&self) -> u32 {
        self.windows.parent.get().map_or(0, |&(pid, _)| pid)
    }

    /// starts a write request. on posix, this always calls _onWriteComplete immediately. on windows, it may
    /// call _onWriteComplete later.
    ///
    /// The outbound bytes are read from `queue[0]` *inside* this method. Returns whether to write on.
    fn write(&self) -> bool {
        #[cfg(windows)]
        {
            if !self.socket_is_open() {
                return self.on_write_complete(-1);
            }
            let first = &self.queue.get()[0];
            let data = &first.data.list[first.data.cursor..];
            log!("SendQueue#write len {}", data.len());
            let data = &data[..data.len().min(MAX_WRITE_LEN)];
            let handle = first.handle.as_ref().filter(|_| first.data.cursor == 0);
            let socket = handle.map(|handle| handle.socket.as_socket_transfer());
            let mut header = [0; ipc_frame::MAX_HEADER_LEN];
            let header_len = ipc_frame::write_header(&mut header, data.len() as u32, socket);
            let header = &header[..header_len];
            self.windows.inflight_write_len.set(Some(data.len()));
            let writer = &self.windows.writer;
            if VirtualMachine::get().is_inside_deferred_task_queue.get() {
                // The nextTick queue has already drained, so complete through `on_io`, which drains it again.
                writer.enqueue(header);
                writer.enqueue(data);
                let _ = writer.flush(self);
            } else if writer.try_write(self, &[header, data]) {
                self.windows.inflight_write_len.set(None);
                return self.on_write_complete(data.len() as i32);
            }
            false
        }
        #[cfg(not(windows))]
        {
            let Some(socket) = self.get_socket() else {
                return self.on_write_complete(-1);
            };
            let n: i32 = self.queue.with_mut(|queue| {
                let first = &queue[0];
                let data = &first.data.list[first.data.cursor..];
                log!("SendQueue#write len {}", data.len());
                let data = &data[..data.len().min(MAX_WRITE_LEN)];
                if let Some(handle) = first.handle.as_ref().filter(|_| first.data.cursor == 0) {
                    socket.write_fd(data, handle.fd().native())
                } else {
                    socket.write(data)
                }
            });
            self.on_write_complete(n)
        }
    }

    #[cfg(windows)]
    fn windows_on_write_complete(&self) {
        log!("SendQueue#_windowsOnWriteComplete");
        let Some(len) = self.windows.inflight_write_len.take() else {
            return;
        };
        if self.on_write_complete(len as i32) {
            self.continue_send(&self.get_global_this(), ContinueSendReason::OnWritable);
        }
    }

    #[cfg(windows)]
    pub(crate) fn on_io(&self, event: IoEvent) {
        if let IoEvent::Read(ReadEvent::VmTeardown) = event {
            return self.socket_closed();
        }
        let _alive = self.hold_owner();
        let vm = VirtualMachine::get();
        if let IoEvent::Write(_) = event {
            let _scope = vm.enter_event_loop_scope();
            return self.windows.writer.on_io(self, event);
        }
        let reader = &self.windows.reader;
        let result = reader.read_chunks(vm.loop_ctx(), Some(event), |chunk, _| {
            let held_input = &self.windows.held_input;
            if let Some(mut held) = held_input.replace(Some(Vec::new())) {
                held.extend_from_slice(&chunk);
                held_input.set(Some(held));
                return true;
            }
            self.decode_frames(&chunk);
            while let Some(held) = held_input.take().filter(|held| !held.is_empty()) {
                held_input.set(Some(Vec::new()));
                self.decode_frames(&held);
            }
            true
        });
        if !matches!(result, ReadResult::Pending) {
            self.close_after_exit();
        }
    }

    #[cfg(windows)]
    fn decode_frames(&self, mut rest: &[u8]) {
        let reader = &self.windows.reader;
        while !reader.has_flag(ReaderFlags::IS_PAUSED) || self.read_before_close.get() {
            match self
                .windows
                .frame_decoder
                .with_taken(|decoder| decoder.decode(&mut rest))
            {
                // After `disconnect()`.
                Ok(Some(ipc_frame::Item::Data(_)))
                    if self.pending_close.get() && !self.read_before_close.get() => {}
                Ok(Some(ipc_frame::Item::Data(data))) => {
                    let _scope = VirtualMachine::get().enter_event_loop_scope();
                    on_data2(self, data);
                }
                Ok(Some(ipc_frame::Item::Socket(info))) => {
                    self.incoming_fd.set(None);
                    self.incoming_fd.set(import_socket(&info));
                }
                Ok(None) => break,
                Err(ipc_frame::InvalidFrame) => {
                    reader.pause();
                    self.read_before_close.set(false);
                    self.close_socket_next_tick(true);
                }
            }
        }
    }

    fn get_global_this(&self) -> bun_jsc::GlobalRef {
        let owner = self.owner_ref().expect("SendQueue used after detach");
        bun_jsc::GlobalRef::from(JSGlobalObject::opaque_ref(owner.global_this()))
    }

    #[cfg(windows)]
    pub(crate) fn windows_configure_server(&self, pipe: Pipe) -> bun_sys::Result<()> {
        log!("configureServer");
        pipe.update_ref(false);
        pipe.enable_eager_drain();
        let owner = Owner::new(PollTag::IpcChannel, self.root_ptr().cast());
        // SAFETY: `owner` points to the heap allocation that holds the reader and the writer.
        unsafe {
            self.windows.reader.set_owner(owner);
            self.windows.writer.set_owner(owner);
        }
        self.windows.writer.set_pipe(pipe.clone());
        self.socket.set(SocketUnion::Open(()));
        self.windows
            .reader
            .start_with_pipe(pipe)
            .inspect_err(|_| self.close_socket(CloseReason::Failure, CloseFrom::User))
    }

    #[cfg(windows)]
    pub(crate) fn windows_configure_client(&self, pipe_fd: Fd) -> bun_sys::Result<()> {
        use bun_sys::windows as w;
        log!("configureClient");
        if !w::named_pipe::is_duplex(pipe_fd.native()) {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::EINVAL,
                bun_sys::Tag::open,
            ));
        }
        let pipe = Pipe::open_duplex(VirtualMachine::get().uws_loop().port(), pipe_fd)?;
        pipe.enable_read_ahead();
        if let Some(pid) = pipe.peer_process_id().or_else(w::parent_process_id)
            && let Some(process) = w::open_parent_process(pid)
        {
            let _ = self.windows.parent.set((pid, process));
        }
        self.windows_configure_server(pipe)
    }
}

#[cfg(windows)]
impl WriteHandler for SendQueue {
    fn on_write(&self, _: usize, _: WriteStatus) {
        self.windows_on_write_complete();
    }

    fn on_error(&self, _: bun_sys::Error) {
        self.windows.inflight_write_len.set(None);
        self.close_after_exit();
    }

    fn on_close(&self) {}
}

impl bun_event_loop::RefTask for SendQueue {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::SendQueueDeferred;
    type Ref = RefPtr<Self>;
    fn release_unrun(_: Self::Ref) {}
    /// The channel's own close hop.
    fn context(_: &Self::Ref) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl Drop for SendQueue {
    fn drop(&mut self) {
        log!("SendQueue#deinit");
        self.close_event_sent.set(true);
        self.close_socket(CloseReason::Failure, CloseFrom::Deinit);
    }
}

const MAX_HANDLE_RETRANSMISSIONS: u32 = 3;

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

    if let Some(icmd) = internal_command {
        match icmd {
            IPCCommand::Handle(msg_data) => {
                let received = send_queue.incoming_fd.take();

                let packet = if received.is_some() {
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

                let Some(received) = received else {
                    return Ok(());
                };
                let Some(owner) = send_queue.owner_ref() else {
                    return Ok(());
                };
                let target: JSValue = match owner.kind() {
                    SendQueueOwnerKind::Subprocess => owner.this_jsvalue(),
                    SendQueueOwnerKind::VirtualMachine => JSValue::NULL,
                };

                // RAII: `enter()` now, `exit()` on drop — covers both the
                // early-error return and the fall-through.
                let _scope = global_this.bun_vm().enter_event_loop_scope();
                let fd_js = received_fd_to_js(received.fd());
                let emit = ipc_parse(global_this, target, msg_data, fd_js)?;
                // The object that `ipc_parse` made closes it. Before the listener, which can end the thread.
                received.into_raw();
                if emit.is_callable() {
                    emit.call_for_running_script(global_this, JSValue::UNDEFINED, &[])?;
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
        let mut received = None;
        if let DecodedIPCMessage::Internal(msg_data) = &message {
            let msg_data = *msg_data;
            if msg_data.is_object() {
                if let Some(marker) = msg_data.get(global_this, "$hasHandle")?
                    && marker.to_boolean()
                {
                    received = send_queue.incoming_fd.take();
                    let packet = if received.is_some() {
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
                    if received.is_none() {
                        return Ok(());
                    }
                }
            }
        }
        if let Some(owner) = send_queue.owner.get() {
            let handle_js = received
                .filter(|_| owner.takes_cluster_handle())
                .map_or(JSValue::UNDEFINED, |fd| received_fd_to_js(fd.into_raw()));
            owner.handle_ipc_message(&message, handle_js)?;
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
    if let DecodeStep::Fail(_) = step {
        // A read that is being delivered further up the stack has nothing left to report.
        (send_queue.incoming).set(IncomingBuffer::init(send_queue.mode));
        send_queue.read_before_close.set(false);
    }
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

fn deliver(send_queue: &SendQueue, message: Unrestored, global: &JSGlobalObject) {
    match message.restore(global) {
        Ok(message) => crate::dispatch::fold(handle_ipc_message(send_queue, message, global)),
        Err(err) => finish_decode(send_queue, &DecodeStep::Fail(err.into())),
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
        let IncomingBuffer::Advanced(adv_buf) = inc else {
            unreachable!()
        };
        match decode_ipc_message(Mode::Advanced, adv_buf.slice(), global, None) {
            Ok(r) => {
                adv_buf.cursor += r.bytes_consumed as usize;
                DecodeStep::Message(r)
            }
            Err(IPCDecodeError::NotEnoughBytes) => {
                // copy the remaining bytes to the start of the buffer
                adv_buf
                    .list
                    .drain_front(core::mem::take(&mut adv_buf.cursor));
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
                        deliver(send_queue, result.message, &global_this)
                    }
                    step => return finish_decode(send_queue, &step),
                }
            }
        }
        Mode::Advanced => {
            // Advanced mode: uses length-prefix, no newline scanning needed.
            // Try to decode the first message directly from the incoming chunk, and buffer the rest.
            let buffered = send_queue.incoming.with_mut(|inc| {
                let IncomingBuffer::Advanced(adv_buf) = inc else {
                    unreachable!()
                };
                adv_buf.is_not_empty()
            });
            let mut first = None;
            if !buffered {
                match decode_ipc_message(Mode::Advanced, data, &global_this, None) {
                    Ok(result) => {
                        data = &data[result.bytes_consumed as usize..];
                        first = Some(result.message);
                    }
                    Err(IPCDecodeError::NotEnoughBytes) => {}
                    Err(e) => return finish_decode(send_queue, &DecodeStep::Fail(e)),
                }
            }

            // `data` is the loop's receive buffer, which a handler that runs the event loop overwrites.
            let capacity = send_queue.incoming.with_mut(|inc| {
                let IncomingBuffer::Advanced(adv_buf) = inc else {
                    unreachable!()
                };
                let capacity = adv_buf.list.capacity();
                handle_oom(adv_buf.write(data));
                capacity
            });
            let read_in_place = first.is_some();
            if let Some(message) = first {
                deliver(send_queue, message, &global_this);
                if data.is_empty() {
                    return;
                }
            }
            loop {
                match decode_next_advanced(&send_queue.incoming, &global_this) {
                    DecodeStep::Message(result) => {
                        deliver(send_queue, result.message, &global_this)
                    }
                    step => break finish_decode(send_queue, &step),
                }
            }
            if read_in_place {
                // Only a message that is split over reads grows the buffer for good.
                send_queue.incoming.with_mut(|inc| {
                    let IncomingBuffer::Advanced(adv_buf) = inc else {
                        unreachable!()
                    };
                    adv_buf.list.shrink_to(capacity);
                });
            }
        }
    }
}

/// Used on POSIX
#[allow(non_snake_case)]
pub(crate) mod IPCHandlers {
    use super::*;

    pub(crate) mod PosixSocket {
        use super::*;

        pub(crate) fn on_close(
            send_queue: &SendQueue,
            _: Socket,
            _: c_int,
            _: Option<*mut c_void>,
        ) {
            // uSockets has already freed the underlying socket
            log!("NewSocketIPCHandler#onClose\n");
            send_queue.socket_closed();
        }

        pub(crate) fn on_data(send_queue: &SendQueue, _: Socket, all_data: &[u8]) {
            let _alive = send_queue.hold_owner();
            let global_this = send_queue.get_global_this();
            let _scope = global_this.bun_vm().enter_event_loop_scope();
            on_data2(send_queue, all_data);
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
                let received = CloseOnDrop::new(Fd::from_native(fd));
                send_queue.incoming_fd.set(Some(received));
            }
        }

        pub(crate) fn on_writable(send_queue: &SendQueue, _: Socket) {
            log!("onWritable");

            let _alive = send_queue.hold_owner();
            let global_this = send_queue.get_global_this();
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
