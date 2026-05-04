use core::ffi::{c_int, c_void};
use core::mem::size_of;

use bun_aio::KeepAlive;
use bun_collections::ByteList;
use bun_core::Output;
use bun_io::StreamBuffer;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult, ManagedTask, Task,
    VirtualMachine, ZigString,
};
use bun_runtime::api::Subprocess;
use bun_runtime::node::node_cluster_binding;
use bun_str::{strings, String as BunString};
use bun_sys::windows::libuv as uv;
use bun_sys::Fd;
use bun_uws;

use crate::json_line_buffer::JSONLineBuffer;

bun_output::declare_scope!(IPC, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(IPC, $($arg)*) };
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
enum IsInternal {
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
        // TODO(port): ComptimeStringMap.fromJS — get string from JSValue then from_string
        let _ = (global, value);
        Err(JsError::Thrown) // placeholder
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
    ) -> Result<usize, bun_core::Error> {
        // TODO(port): narrow error set
        let serialized = value.serialize(
            global,
            jsc::SerializeOptions {
                // IPC sends across process.
                for_cross_process_transfer: true,
                for_storage: false,
            },
        )?;
        // `serialized` Drops at scope exit (defer serialized.deinit()).

        let size: u32 = u32::try_from(serialized.data().len()).unwrap();

        let payload_length: usize = size_of::<IPCMessageType>() + size_of::<u32>() + size as usize;

        writer.ensure_unused_capacity(payload_length)?;

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
                let found = strings::index_of_char(data, b'\n')
                    .ok_or(IPCDecodeError::NotEnoughBytes)?;
                // Individual IPC messages should not exceed 4GB, and idx+1 must not overflow
                if found >= u32::MAX as usize {
                    return Err(IPCDecodeError::InvalidFormat);
                }
                u32::try_from(found).unwrap()
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
            let s = BunString::create_external::<bool>(
                json_data,
                true,
                &mut was_ascii_string_freed,
                json_ipc_data_string_free_cb,
            );
            if s.tag() == bun_str::Tag::Dead {
                #[cold]
                fn cold() {}
                cold();
                return Err(IPCDecodeError::OutOfMemory);
            }
            s
        } else {
            BunString::borrow_utf8(json_data)
        };

        // TODO(port): scopeguard for the post-deref panic check below — Drop on
        // BunString handles `str.deref()`, but the ascii-freed assertion needs
        // to fire after deref. Phase B: wrap in scopeguard.
        let deserialized = match str.to_js_by_parse_json(global_this) {
            Ok(v) => v,
            Err(JsError::Thrown) => {
                global_this.clear_exception();
                drop(str);
                if is_ascii && !was_ascii_string_freed {
                    panic!("Expected ascii string to be freed by ExternalString, but it wasn't. This is a bug in Bun.");
                }
                return Err(IPCDecodeError::InvalidFormat);
            }
            Err(JsError::Terminated) => {
                global_this.clear_exception();
                drop(str);
                if is_ascii && !was_ascii_string_freed {
                    panic!("Expected ascii string to be freed by ExternalString, but it wasn't. This is a bug in Bun.");
                }
                return Err(IPCDecodeError::InvalidFormat);
            }
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
        };

        drop(str);
        if is_ascii && !was_ascii_string_freed {
            panic!("Expected ascii string to be freed by ExternalString, but it wasn't. This is a bug in Bun.");
        }

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
    ) -> Result<usize, bun_core::Error> {
        // TODO(port): narrow error set
        let mut out: BunString = BunString::default();
        // Use jsonStringifyFast which passes undefined for the space parameter,
        // triggering JSC's SIMD-optimized FastStringifier code path.
        value.json_stringify_fast(global, &mut out)?;
        // `out` Drops (deref) at scope exit.

        if out.tag() == bun_str::Tag::Dead {
            return Err(bun_core::err!("SerializationFailed"));
        }

        // TODO: it would be cool to have a 'toUTF8Into' which can write directly into 'ipc_data.outgoing.list'
        let str = out.to_utf8();
        let slice = str.as_bytes();

        let mut result_len: usize = slice.len() + 1;
        if is_internal == IsInternal::Internal {
            result_len += 1;
        }

        writer.ensure_unused_capacity(result_len)?;

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
) -> Result<usize, bun_core::Error> {
    // TODO(port): narrow error set
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
                prev.unprotect(); // owned by the array now
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
                cb.call_next_tick(global, &[JSValue::NULL])?;
                cb.unprotect();
                *self = CallbackList::None;
            }
            CallbackList::CallbackArray(arr) => {
                let mut iter = arr.array_iterator(global)?;
                while let Some(item) = iter.next()? {
                    item.call_next_tick(global, &[JSValue::NULL])?;
                }
                arr.unprotect();
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

pub struct WindowsWrite {
    pub write_req: uv::uv_write_t,
    pub write_buffer: uv::uv_buf_t,
    pub write_slice: Box<[u8]>,
    pub owner: Option<*mut SendQueue>,
}

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
    pub windows_write: Option<Box<WindowsWrite>>,
    // TODO(port): lifetime — LIFETIMES.tsv classes this OWNED Box<WindowsWrite>,
    // but the box is leaked into libuv via raw ptr and reclaimed in
    // _windowsOnWriteComplete. Phase B: likely Option<*mut WindowsWrite>.
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
    pub internal_msg_queue: node_cluster_binding::InternalMsgHolder,
    incoming: IncomingBuffer,
    pub incoming_fd: Option<Fd>,

    pub socket: SocketUnion,
    pub owner: SendQueueOwner,

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

pub enum SendQueueOwner {
    Subprocess(*mut Subprocess),
    VirtualMachine(*mut jsc::virtual_machine::IPCInstance),
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
    pub fn init(mode: Mode, owner: SendQueueOwner, socket: SocketUnion) -> Self {
        log!("SendQueue#init");
        Self {
            queue: Vec::new(),
            waiting_for_ack: None,
            retry_count: 0,
            keep_alive: KeepAlive::default(),
            #[cfg(debug_assertions)]
            has_written_version: 0,
            mode,
            internal_msg_queue: node_cluster_binding::InternalMsgHolder::default(),
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
            if let Some(windows_write) = self.windows.windows_write.as_mut() {
                windows_write.owner = None; // so _windowsOnWriteComplete doesn't try to continue writing
            }
            self.windows.windows_write = None; // will be freed by _windowsOnWriteComplete
            // TODO(port): lifetime — see WindowsState.windows_write note; this drops the Box
            // but Zig leaves freeing to the libuv callback. Phase B must reconcile.
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
            let task = ManagedTask::new::<SendQueue>(Self::_on_after_ipc_closed, self);
            self.after_close_task = Some(task);
            self.get_global_this()
                .bun_vm()
                .enqueue_task(self.after_close_task.unwrap());
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
        let task = ManagedTask::new::<SendQueue>(Self::_close_socket_task, self);
        self.close_next_tick = Some(task);
        VirtualMachine::get().enqueue_task(self.close_next_tick.unwrap());
    }

    fn _close_socket_task(this: &mut SendQueue) {
        log!("SendQueue#closeSocketTask");
        debug_assert!(this.close_next_tick.is_some());
        this.close_next_tick = None;
        this.close_socket(CloseReason::Normal, CloseFrom::User);
    }

    fn _on_after_ipc_closed(this: &mut SendQueue) {
        log!("SendQueue#_onAfterIPCClosed");
        this.after_close_task = None;
        if this.close_event_sent {
            return;
        }
        this.close_event_sent = true;
        match this.owner {
            SendQueueOwner::Subprocess(owner) => {
                // SAFETY: BACKREF — Subprocess embeds this SendQueue inline and outlives it.
                unsafe { (*owner).handle_ipc_close() };
            }
            SendQueueOwner::VirtualMachine(owner) => {
                // SAFETY: BACKREF — IPCInstance owns this SendQueue inline.
                unsafe { (*owner).handle_ipc_close() };
            }
        }
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
        if handle.is_none() && !self.queue.is_empty() {
            // PORT NOTE: reshaped for borrowck — capture scalars before re-borrowing last.
            let len = self.queue.len();
            let write_in_progress = self.write_in_progress;
            let last = &mut self.queue[len - 1];
            if last.handle.is_none()
                && !last.is_ack_nack()
                && !(len == 1 && write_in_progress)
            {
                if callback.is_callable() {
                    last.callbacks.push(callback, global)?;
                }
                // caller can append now
                return Ok(last);
            }
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
                BunString::static_("Handle did not reach the receiving process correctly");
            let mut warning_name = BunString::static_("SentHandleNotReceivedWarning");
            if let Ok(warning_js) = warning.transfer_to_js(global) {
                if let Ok(warning_name_js) = warning_name.transfer_to_js(global) {
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
        if self.should_ref() {
            self.keep_alive.ref_(global.bun_vm());
        } else {
            self.keep_alive.unref(global.bun_vm());
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
        let to_send_len = first.data.list.len() - first.data.cursor as usize;
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
        // PORT NOTE: reshaped for borrowck — recompute slice/fd via raw to avoid &mut self overlap.
        let fd = self.queue[0].handle.as_ref().map(|h| h.fd);
        let to_send: *const [u8] = &self.queue[0].data.list[self.queue[0].data.cursor as usize..];
        // SAFETY: `to_send` borrows queue[0].data which is not reallocated by _write
        // (only _on_write_complete may pop the queue, and that runs after the write).
        self._write(unsafe { &*to_send }, fd);
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
        let to_send_len = first.data.list.len() - first.data.cursor as usize;
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
            first.data.cursor += u32::try_from(n).unwrap();
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
            self.queue[last].data.write(bytes);
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
                    item.data.list.len() - item.data.cursor as usize
                );
            } else {
                log!(
                    "  \"{}\"|\"{}\"",
                    bstr::BStr::new(&item.data.list[0..item.data.cursor as usize]),
                    bstr::BStr::new(&item.data.list[item.data.cursor as usize..])
                );
            }
        }
    }

    fn get_socket(&self) -> Option<SocketType> {
        match &self.socket {
            SocketUnion::Open(s) => Some(*s),
            _ => None,
        }
    }

    /// starts a write request. on posix, this always calls _onWriteComplete immediately. on windows, it may
    /// call _onWriteComplete later.
    fn _write(&mut self, data: &[u8], fd: Option<Fd>) {
        log!("SendQueue#_write len {}", data.len());
        let Some(socket) = self.get_socket() else {
            self._on_write_complete(-1);
            return;
        };
        #[cfg(windows)]
        {
            if let Some(_) = fd {
                // TODO: send fd on windows
            }
            let pipe: *mut uv::Pipe = socket;
            let write_len = data.len().min(i32::MAX as usize);

            // create write request
            let write_req_slice: Box<[u8]> = Box::from(&data[0..write_len]);
            let write_req = Box::new(WindowsWrite {
                owner: Some(self as *mut SendQueue),
                write_slice: write_req_slice,
                // SAFETY: all-zero is a valid uv_write_t (C struct, initialized by uv_write).
                write_req: unsafe { core::mem::zeroed() },
                write_buffer: uv::uv_buf_t::init(b""), // re-init below after slice address is stable
            });
            // TODO(port): lifetime — Zig stores raw ptr; Box ownership here conflicts with
            // libuv reclaiming via _windowsOnWriteComplete. Phase B: into_raw / from_raw.
            debug_assert!(self.windows.windows_write.is_none());
            self.windows.windows_write = Some(write_req);
            let write_req: &mut WindowsWrite =
                self.windows.windows_write.as_mut().unwrap().as_mut();
            write_req.write_buffer = uv::uv_buf_t::init(&write_req.write_slice);

            // SAFETY: pipe is live (socket == .open).
            unsafe { (*pipe).ref_() }; // ref on write
            let result = unsafe {
                write_req.write_req.write(
                    (*pipe).as_stream(),
                    &mut write_req.write_buffer,
                    write_req as *mut WindowsWrite,
                    Self::_windows_on_write_complete,
                )
            };
            if let Some(err) = result.as_err() {
                // SAFETY: err.errno is a valid uv errno.
                Self::_windows_on_write_complete(
                    write_req as *mut WindowsWrite,
                    unsafe {
                        core::mem::transmute::<c_int, uv::ReturnCode>(-(err.errno as c_int))
                    },
                );
            }
            // write request is queued. it will call _onWriteComplete when it completes.
        }
        #[cfg(not(windows))]
        {
            if let Some(fd_unwrapped) = fd {
                self._on_write_complete(socket.write_fd(data, fd_unwrapped));
            } else {
                self._on_write_complete(socket.write(data));
            }
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
    #[cfg(not(windows))]
    fn _windows_on_write_complete(_write_req: *mut WindowsWrite, _status: uv::ReturnCode) {}

    fn get_global_this(&self) -> &JSGlobalObject {
        match self.owner {
            // SAFETY: BACKREF — owner outlives this SendQueue (embedded inline).
            SendQueueOwner::Subprocess(owner) => unsafe { (*owner).global_this },
            SendQueueOwner::VirtualMachine(owner) => unsafe { (*owner).global_this },
        }
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
            fd.close();
        }

        // if there is a close next tick task, cancel it so it doesn't get called and then UAF
        if let Some(close_next_tick_task) = self.close_next_tick {
            let managed: &mut ManagedTask = close_next_tick_task.as_::<ManagedTask>();
            managed.cancel();
        }
        // Same for the close-notification task. `closeSocket` above may have
        // just enqueued this (VM-shutdown path with the socket still open),
        // or it may be left over from an earlier `_socketClosed` that hasn't
        // drained yet; either way the owner is about to free our storage.
        if let Some(after_close_task) = self.after_close_task {
            let managed: &mut ManagedTask = after_close_task.as_::<ManagedTask>();
            managed.cancel();
            self.after_close_task = None;
        }
    }
}

const MAX_HANDLE_RETRANSMISSIONS: u32 = 3;

#[bun_jsc::host_fn]
fn emit_process_error_event(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [ex] = callframe.arguments_as_array::<1>();
    VirtualMachine::process_emit_error_event(global_this, ex);
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
        callback.call_next_tick(global_object, &[ex])?;
        return Ok(JSValue::FALSE);
    }
    if from == FromEnum::Process {
        let target = jsc::JSFunction::create(
            global_object,
            BunString::empty(),
            emit_process_error_event,
            1,
            Default::default(),
        );
        target.call_next_tick(global_object, &[ex])?;
        return Ok(JSValue::FALSE);
    }
    // Bun.spawn().send() should throw an error (unless callback is passed)
    global_object.throw_value(ex)
}

pub fn do_send(
    ipc: Option<&mut SendQueue>,
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
    from: FromEnum,
) -> JsResult<JSValue> {
    let [mut message, mut handle, mut options_, mut callback] =
        call_frame.arguments_as_array::<4>();

    if handle.is_callable() {
        callback = handle;
        handle = JSValue::UNDEFINED;
        options_ = JSValue::UNDEFINED;
    } else if options_.is_callable() {
        callback = options_;
        options_ = JSValue::UNDEFINED;
    } else if !options_.is_undefined() {
        global_object.validate_object("options", options_, Default::default())?;
    }

    let connected = ipc.as_ref().map_or(false, |i| i.is_connected());
    if !connected {
        let ex = global_object
            .err(
                jsc::ErrorCode::IPC_CHANNEL_CLOSED,
                "{}",
                &[match from {
                    FromEnum::Process => {
                        "process.send() can only be used if the IPC channel is open."
                    }
                    FromEnum::Subprocess => {
                        "Subprocess.send() can only be used if an IPC channel is open."
                    }
                    FromEnum::SubprocessExited => {
                        "Subprocess.send() cannot be used after the process has exited."
                    }
                }],
            )
            .to_js();
        // TODO(port): globalObject.ERR(...) — verify Rust API shape for templated error builder
        return do_send_err(global_object, callback, ex, from);
    }

    let ipc_data = ipc.unwrap();

    if message.is_undefined() {
        return global_object.throw_missing_arguments_value(&["message"]);
    }
    if !message.is_string()
        && !message.is_object()
        && !message.is_number()
        && !message.is_boolean()
        && !message.is_null()
    {
        return global_object.throw_invalid_argument_type_value_one_of(
            "message",
            "string, object, number, or boolean",
            message,
        );
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
        if let Some(listener) = bun_runtime::api::Listener::from_js(handle) {
            log!("got listener");
            match &listener.listener {
                bun_runtime::api::ListenerKind::Uws(socket_uws) => {
                    // may need to handle ssl case
                    let fd = socket_uws.get_socket().get_fd();
                    zig_handle = Some(Handle::init(fd, handle));
                }
                bun_runtime::api::ListenerKind::NamedPipe(named_pipe) => {
                    let _ = named_pipe;
                }
                bun_runtime::api::ListenerKind::None => {}
            }
            // TODO(port): bun.jsc.API.Listener — verify Rust enum shape & module path
        } else {
            //
        }
    }

    let status =
        ipc_data.serialize_and_send(global_object, message, IsInternal::External, callback, zig_handle);

    if status == SerializeAndSendResult::Failure {
        let ex = global_object.create_type_error_instance("process.send() failed", &[]);
        ex.put(
            global_object,
            ZigString::static_("syscall"),
            BunString::static_("write").to_js(global_object)?,
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

#[bun_jsc::host_fn]
pub fn emit_handle_ipc_message(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [target, message, handle] = callframe.arguments_as_array::<3>();
    if target.is_null() {
        let Some(ipc) = global_this.bun_vm().get_ipc_instance() else {
            return Ok(JSValue::UNDEFINED);
        };
        ipc.handle_ipc_message(DecodedIPCMessage::Data(message), handle);
    } else {
        if !target.is_cell() {
            return Ok(JSValue::UNDEFINED);
        }
        let Some(subprocess) = Subprocess::from_js_direct(target) else {
            return Ok(JSValue::UNDEFINED);
        };
        subprocess.handle_ipc_message(DecodedIPCMessage::Data(message), handle);
    }
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
        let mut formatter = jsc::ConsoleObject::Formatter {
            global_this,
            ..Default::default()
        };
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
        // formatter Drops here.
    }
    let mut internal_command: Option<IPCCommand> = None;
    'handle_message: {
        if let DecodedIPCMessage::Data(msg_data) = &message {
            let msg_data = *msg_data;
            if msg_data.is_object() {
                let cmd = match msg_data.fast_get(global_this, jsc::BuiltinName::Cmd) {
                    Err(_) => {
                        global_this.clear_exception();
                        break 'handle_message;
                    }
                    Ok(None) => break 'handle_message,
                    Ok(Some(v)) => v,
                };
                if cmd.is_string() {
                    if !cmd.is_cell() {
                        break 'handle_message;
                    }
                    let cmd_str = match BunString::from_js(cmd, global_this) {
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
                handle.data.write(packet);

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

                let target: JSValue = match send_queue.owner {
                    SendQueueOwner::Subprocess(subprocess) => {
                        // SAFETY: BACKREF — see SendQueueOwner.
                        unsafe { (*subprocess).this_value.try_get() }.unwrap_or(JSValue::ZERO)
                    }
                    SendQueueOwner::VirtualMachine(_) => JSValue::NULL,
                };

                let vm = global_this.bun_vm();
                vm.event_loop().enter();
                // TODO(port): errdefer — scopeguard for event_loop().exit()
                let res = ipc_parse(global_this, target, msg_data, fd.to_js(global_this));
                if let Err(e) = res {
                    // ack written already, that's okay.
                    global_this.report_active_exception_as_unhandled(e);
                    vm.event_loop().exit();
                    return;
                }
                vm.event_loop().exit();

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
        match send_queue.owner {
            SendQueueOwner::Subprocess(owner) => {
                // SAFETY: BACKREF — see SendQueueOwner.
                unsafe { (*owner).handle_ipc_message(message, JSValue::UNDEFINED) };
            }
            SendQueueOwner::VirtualMachine(owner) => {
                // SAFETY: BACKREF — see SendQueueOwner.
                unsafe { (*owner).handle_ipc_message(message, JSValue::UNDEFINED) };
            }
        }
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
                        Output::print_errorln("IPC message is too long.", &[]);
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
                                Output::print_errorln("IPC message is too long.", &[]);
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
                                core::ptr::copy(
                                    adv_buf.ptr.add(slice_start),
                                    adv_buf.ptr,
                                    slice_len,
                                );
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
                            Output::print_errorln("IPC message is too long.", &[]);
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
            let loop_ = global_this.bun_vm().event_loop();
            loop_.enter();
            // TODO(port): errdefer — scopeguard for loop.exit()
            on_data2(send_queue, all_data);
            loop_.exit();
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
            let loop_ = global_this.bun_vm().event_loop();
            loop_.enter();
            // TODO(port): errdefer — scopeguard for loop.exit()
            log!("IPC call continueSend() from onWritable");
            send_queue.continue_send(global_this, ContinueSendReason::OnWritable);
            loop_.exit();
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
            match &mut send_queue.incoming {
                IncomingBuffer::Json(json_buf) => {
                    let mut available = json_buf.unused_capacity_slice();
                    if available.len() < suggested_size {
                        json_buf.ensure_unused_capacity(suggested_size);
                        available = json_buf.unused_capacity_slice();
                    }
                    log!("NewNamedPipeIPCHandler#onReadAlloc {}", suggested_size);
                    // SAFETY: returning a sub-slice of the unused-capacity region; libuv writes into it.
                    unsafe {
                        core::slice::from_raw_parts_mut(available.as_mut_ptr(), suggested_size)
                    }
                }
                IncomingBuffer::Advanced(adv_buf) => {
                    let mut available = adv_buf.unused_capacity_slice();
                    if available.len() < suggested_size {
                        adv_buf.ensure_unused_capacity(suggested_size);
                        available = adv_buf.unused_capacity_slice();
                    }
                    log!("NewNamedPipeIPCHandler#onReadAlloc {}", suggested_size);
                    // SAFETY: same as above.
                    unsafe {
                        core::slice::from_raw_parts_mut(available.as_mut_ptr(), suggested_size)
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
            let loop_ = global_this.bun_vm().event_loop();
            loop_.enter();
            // TODO(port): errdefer — scopeguard for loop.exit()

            match &mut send_queue.incoming {
                IncomingBuffer::Json(_) => {
                    // For JSON mode on Windows, use notifyWritten to update length and scan for newlines
                    let IncomingBuffer::Json(json_buf) = &mut send_queue.incoming else {
                        unreachable!()
                    };
                    debug_assert!(
                        json_buf.data.len as usize + buffer.len() <= json_buf.data.cap as usize
                    );
                    debug_assert!(bun_core::is_slice_in_buffer(
                        buffer,
                        json_buf.data.allocated_slice()
                    ));

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
                                loop_.exit();
                                return;
                            }
                            Err(
                                IPCDecodeError::InvalidFormat
                                | IPCDecodeError::JSError
                                | IPCDecodeError::JSTerminated,
                            ) => {
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                loop_.exit();
                                return;
                            }
                            Err(IPCDecodeError::OutOfMemory) => {
                                Output::print_errorln("IPC message is too long.", &[]);
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                loop_.exit();
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
                    debug_assert!(bun_core::is_slice_in_buffer(
                        buffer,
                        adv_buf.allocated_slice()
                    ));

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
                                    core::ptr::copy(
                                        adv_buf.ptr.add(slice_start),
                                        adv_buf.ptr,
                                        slice_len,
                                    );
                                }
                                // slice.len is guaranteed <= adv_buf.len (u32) since it's derived from adv_buf.slice()
                                debug_assert!(slice_len <= u32::MAX as usize);
                                adv_buf.len = u32::try_from(slice_len).unwrap();
                                log!("hit NotEnoughBytes3");
                                loop_.exit();
                                return;
                            }
                            Err(
                                IPCDecodeError::InvalidFormat
                                | IPCDecodeError::JSError
                                | IPCDecodeError::JSTerminated,
                            ) => {
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                loop_.exit();
                                return;
                            }
                            Err(IPCDecodeError::OutOfMemory) => {
                                Output::print_errorln("IPC message is too long.", &[]);
                                send_queue.close_socket(CloseReason::Failure, CloseFrom::User);
                                loop_.exit();
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
                            loop_.exit();
                            return;
                        }
                    }
                }
            }
            #[allow(unreachable_code)]
            loop_.exit();
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
//   todos:      23
//   notes:      WindowsWrite Box vs raw-ptr ownership conflicts with libuv callback reclaim; on_data2/on_read reshaped heavily for borrowck (re-match on send_queue.incoming each iteration); defer update_ref/loop.exit inlined at returns pending scopeguard; windows_configure_* / on_server_pipe_close cfg(windows)-gated (SocketType differs by platform)
// ──────────────────────────────────────────────────────────────────────────
