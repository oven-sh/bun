//! The native session of `node:http2`: the JS binding, the transport and the send half. `h2/` has the protocol state and the receive half.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use std::borrow::Cow;
use std::collections::VecDeque;
use std::rc::Rc;

use crate::api::h2::connection::{Connection, FeedEnd, Sink, lib_error};
use crate::api::h2::outbound_fields::{BlockRole, collect_fields, header_value_bytes};
use crate::api::h2::stream::{
    PaddingStrategy, PendingFrame, RequestMethod, ResetBy, Stream, update,
};
use crate::api::socket::{TCPSocket, TLSSocket};
use crate::node::{Encoding, StringOrBuffer};
use crate::socket::NativeCallbacks;
use crate::webcore::AutoFlusher;
use bstr::BStr;
use bun_collections::{ByteVecExt, HiveArrayFallback, VecExt};
use bun_http::lshpack;
use bun_http_types::h2::flow_control::DEFAULT_WINDOW_SIZE;
use bun_http_types::h2::frame::{
    CONNECTION_PREFACE, ErrorCode, FRAME_HEADER_SIZE, FrameHeader, FrameType, MAX_STREAM_ID, flags,
    unparsed_rest,
};
use bun_http_types::h2::settings::{self, SettingId, Settings};
use bun_http_types::h2::stream::{Event as StreamEvent, State};
use bun_jsc::StringJsc as _;
use bun_jsc::array_buffer::BinaryType;
use bun_jsc::bindgen::{Callable, JsBytes, JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::rare_data::H2HeaderScratch;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    GlobalRef, JSGlobalObject, JSValue, JsCell, JsClass, JsRef, JsResult, Strong, StrongOptional,
};
use bun_ptr::RefPtr;

use crate::generated_bindgen::h2_frame_parser::{
    H2FrameParserOptions, H2Handlers, js_H2FrameParser as js,
};

bun_output::declare_scope!(H2FrameParser, visible);

/// A `js::on_*_get_cached` accessor: reads one handler from the JS wrapper.
type GetCached = fn(JSValue) -> Option<JSValue>;

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const MAX_PAYLOAD_SIZE_WITHOUT_FRAME: usize = 16384 - FRAME_HEADER_SIZE - 1;

/// `Copy` view of [`NativeSocket`] for call sites to snapshot across
/// re-entrant writes. BACKREF — the socket strictly outlives the attachment:
/// `Tls`/`Tcp` are kept alive by the `RefPtr<H2FrameParser>` stored in the
/// socket's `native_callback` slot, `*Writeonly` by the ref [`NativeSocket`]
/// holds on them.
#[derive(Default, Clone, Copy)]
enum BunSocket {
    #[default]
    None,
    Tls(bun_ptr::BackRef<TLSSocket>),
    TlsWriteonly(bun_ptr::BackRef<TLSSocket>),
    Tcp(bun_ptr::BackRef<TCPSocket>),
    TcpWriteonly(bun_ptr::BackRef<TCPSocket>),
}

/// The parser's attachment to a native socket, and its owner: attaching either
/// installs the parser as the socket's native callback (`Tls`/`Tcp`) or, when
/// that slot is taken, takes a ref on the socket (`*Writeonly`); `detach` /
/// `Drop` undo whichever one it was. Readers take a [`BunSocket`] snapshot.
#[derive(Default)]
struct NativeSocket {
    socket: Cell<BunSocket>,
    /// The attached socket closed. Sticky until `attach`; `onWrite` tells the session.
    closed: Cell<bool>,
}

impl NativeSocket {
    #[inline]
    fn get(&self) -> BunSocket {
        self.socket.get()
    }

    /// `attach_native_callback` stores `h2` (a ref on the parser) in the
    /// socket, dropped in `NewSocket::detach_native_callback` (or inside
    /// `attach_native_callback` when rejected); when rejected we fall back to
    /// write-only mode and hold a ref on the socket instead.
    fn attach<const SSL: bool>(
        &self,
        socket: *mut crate::socket::NewSocket<SSL>,
        h2: RefPtr<H2FrameParser>,
    ) {
        debug_assert!(matches!(self.socket.get(), BunSocket::None));
        self.closed.set(false);
        // BACKREF: the caller's JS socket holds a ref on it.
        let socket_nn = NonNull::new(socket).expect("non-null socket");
        let socket = bun_ptr::BackRef::from(socket_nn);
        self.socket
            .set(if socket.attach_native_callback(NativeCallbacks::H2(h2)) {
                if SSL {
                    BunSocket::Tls(bun_ptr::BackRef::from(socket_nn.cast::<TLSSocket>()))
                } else {
                    BunSocket::Tcp(bun_ptr::BackRef::from(socket_nn.cast::<TCPSocket>()))
                }
            } else {
                // The ref `detach` releases.
                socket.ref_();
                if SSL {
                    BunSocket::TlsWriteonly(bun_ptr::BackRef::from(socket_nn.cast::<TLSSocket>()))
                } else {
                    BunSocket::TcpWriteonly(bun_ptr::BackRef::from(socket_nn.cast::<TCPSocket>()))
                }
            });
    }

    fn detach(&self) {
        match self.socket.replace(BunSocket::None) {
            BunSocket::Tcp(socket) => socket.detach_native_callback(),
            BunSocket::Tls(socket) => socket.detach_native_callback(),
            // The ref `attach` took.
            BunSocket::TcpWriteonly(socket) => TCPSocket::deref(socket.get()),
            BunSocket::TlsWriteonly(socket) => TLSSocket::deref(socket.get()),
            BunSocket::None => {}
        }
    }

    /// The socket released the parser. `detach` gets here too, but with nothing attached.
    fn note_socket_closed(&self) {
        if !matches!(self.socket.get(), BunSocket::None) {
            self.closed.set(true);
        }
    }
}

impl Drop for NativeSocket {
    fn drop(&mut self) {
        self.detach();
    }
}

unsafe extern "C" {
    /// One-call materialization of a decoded header block: returns the
    /// [rawHeadersArray, headersObject, sensitiveArray|undefined] tuple, or a
    /// zero JSValue with a JS exception pending. See H2HeadersMaterializer.cpp.
    fn Bun__h2__materializeHeaders(
        global_object: &JSGlobalObject,
        packed: *const u8,
        meta: *const u32,
        field_count: usize,
    ) -> JSValue;
}

// node's kMaxALTSVC: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L241
const MAX_ALTSVC_LENGTH: usize = 16384 - 2;
// writeStream() return-value flag (bitwise-OR'd with the settled stream state, which is < 8):
// the data was flushed without queueing and the engine did not invoke the write callback —
// the JS caller (Http2Stream._write/_writev) completes it asynchronously. Mirrored in
// src/js/node/http2.ts (kWriteFlushedWithoutCallback).
const WRITE_FLUSHED_WITHOUT_CALLBACK: u32 = 0x10;
// https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_frame.h#L58
const NGHTTP2_MAX_HEADERSLEN: u32 = 65536;
// Maximum number of custom settings (same as Node.js MAX_ADDITIONAL_SETTINGS)
const MAX_CUSTOM_SETTINGS: usize = 10;

// Bits of `H2FrameParser::explicit_settings`: which standard SETTINGS were explicitly provided by
// JS (only those go on the wire — node never serializes defaults).
const SETTING_BIT_HEADER_TABLE_SIZE: u8 = 1 << 0;
const SETTING_BIT_ENABLE_PUSH: u8 = 1 << 1;
const SETTING_BIT_MAX_CONCURRENT_STREAMS: u8 = 1 << 2;
const SETTING_BIT_INITIAL_WINDOW_SIZE: u8 = 1 << 3;
const SETTING_BIT_MAX_FRAME_SIZE: u8 = 1 << 4;
const SETTING_BIT_MAX_HEADER_LIST_SIZE: u8 = 1 << 5;
const SETTING_BIT_ENABLE_CONNECT_PROTOCOL: u8 = 1 << 6;

/// Maximum on-wire size of a SETTINGS payload we emit: the 7 standard parameters plus
/// MAX_CUSTOM_SETTINGS custom entries, 6 bytes each.
const MAX_SETTINGS_PAYLOAD_SIZE: usize = (7 + MAX_CUSTOM_SETTINGS) * 6;

fn settings_to_js(settings: &Settings, global_object: &JSGlobalObject) -> JSValue {
    let result = JSValue::create_empty_object(global_object, 8);
    let number = |key: &'static [u8], value: u32| {
        result.put(global_object, key, JSValue::js_number(value as f64));
    };
    number(b"headerTableSize", settings.header_table_size);
    result.put(
        global_object,
        b"enablePush",
        JSValue::from(settings.enable_push),
    );
    number(b"maxConcurrentStreams", settings.max_concurrent_streams);
    number(b"initialWindowSize", settings.initial_window_size);
    number(b"maxFrameSize", settings.max_frame_size);
    number(b"maxHeaderListSize", settings.max_header_list_size);
    number(b"maxHeaderSize", settings.max_header_list_size);
    result.put(
        global_object,
        b"enableConnectProtocol",
        JSValue::from(settings.enable_connect_protocol),
    );
    result
}

// ──────────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────────

struct Handlers {
    vm: &'static VirtualMachine,
    global_object: GlobalRef, // JSC_BORROW
}

impl Handlers {
    /// Safe accessor for the JSC_BORROW global.
    #[inline]
    fn global(&self) -> GlobalRef {
        self.global_object
    }

    /// A zero/empty arg means a value failed to materialize (e.g. a header
    /// materializer bailed); skip the callback rather than passing it to JS.
    /// The pending-termination-exception guard lives in `run_callback`.
    fn should_skip_dispatch(&self, data: &[JSValue]) -> bool {
        data.contains(&JSValue::ZERO)
    }

    pub(crate) fn call_event_handler(
        &self,
        event: GetCached,
        this_value: JSValue,
        context: JSValue,
        data: &[JSValue],
    ) -> bool {
        let Some(callback) = event(this_value) else {
            return false;
        };
        // A zero/empty arg means a value failed to materialize (e.g. the VM is
        // terminating); skip the callback rather than passing it to JS, which
        // asserts/crashes in Bun__JSValue__call.
        if self.should_skip_dispatch(data) {
            return false;
        }
        self.vm.event_loop_ref().run_callback(
            bun_event_loop::ContextId::NONE,
            callback,
            &self.global(),
            context,
            data,
        );
        true
    }

    pub(crate) fn call_write_callback(&self, callback: JSValue, data: &[JSValue]) -> bool {
        if !callback.is_callable() {
            return false;
        }
        if self.should_skip_dispatch(data) {
            return false;
        }
        self.vm.event_loop_ref().run_callback(
            bun_event_loop::ContextId::NONE,
            callback,
            &self.global(),
            JSValue::UNDEFINED,
            data,
        );
        true
    }

    pub(crate) fn call_event_handler_with_result(
        &self,
        event: GetCached,
        this_value: JSValue,
        data: &[JSValue],
    ) -> JSValue {
        let Some(callback) = event(this_value) else {
            return JSValue::ZERO;
        };
        if self.should_skip_dispatch(data) {
            return JSValue::ZERO;
        }
        self.vm.event_loop_ref().run_callback_with_result(
            bun_event_loop::ContextId::NONE,
            callback,
            &self.global(),
            this_value,
            data,
        )
    }

    fn new(global_object: &JSGlobalObject) -> Handlers {
        Handlers {
            // SAFETY: bun_vm() never returns null; VM outlives every JS object (effectively 'static).
            vm: global_object.bun_vm(),
            global_object: GlobalRef::from(global_object),
        }
    }

    /// Keeps the callbacks on the wrapper.
    fn install(global_object: &JSGlobalObject, handlers: &H2Handlers<'_>, this_value: JSValue) {
        macro_rules! install {
            ($set_cached:ident, $callback:expr) => {{
                if let Some(callback) = $callback {
                    js::$set_cached(
                        this_value,
                        global_object,
                        callback.to_js().with_async_context_if_needed(global_object),
                    );
                }
            }};
        }
        install!(on_stream_start_set_cached, handlers.stream_start);
        install!(on_stream_headers_set_cached, handlers.stream_headers);
        install!(on_stream_end_set_cached, handlers.stream_end);
        install!(on_stream_data_set_cached, handlers.stream_data);
        install!(on_stream_error_set_cached, handlers.stream_error);
        install!(on_remote_settings_set_cached, handlers.remote_settings);
        install!(on_local_settings_set_cached, handlers.local_settings);
        install!(on_want_trailers_set_cached, handlers.want_trailers);
        install!(on_ping_set_cached, handlers.ping);
        install!(on_end_set_cached, handlers.end);
        install!(on_error_set_cached, handlers.error);
        install!(on_go_away_set_cached, handlers.goaway);
        install!(on_aborted_set_cached, handlers.aborted);
        install!(on_write_set_cached, Some(handlers.write));
        install!(on_alt_svc_set_cached, handlers.altsvc);
        install!(on_origin_set_cached, handlers.origin);
        install!(on_frame_error_set_cached, handlers.frame_error);
        install!(on_stream_push_set_cached, handlers.stream_push);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser
// ──────────────────────────────────────────────────────────────────────────

const ENABLE_AUTO_CORK: bool = true;
const ENABLE_ALLOCATOR_POOL: bool = true; // ENABLE HIVE ALLOCATOR OPTIMIZATION
const MAX_BUFFER_SIZE: u32 = 32768;

/// `bun.HiveArray(H2FrameParser, 256).Fallback` — per-thread slab of 256
/// parser slots with heap fallback. Lazily boxed on first use (the inline
/// array is ~tens of KB and would otherwise sit in every thread's TLS).
type H2FrameParserHiveAllocator = HiveArrayFallback<H2FrameParser, 256>;

// Exactly one max-size TLS record of plaintext: every full-buffer flush is one SSL_write
// producing one full 16 KB record (uSockets' BIO sends per record, so corking beyond a
// record adds memcpy without saving syscalls). write() fills to this boundary and keeps
// corking the remainder, so frame headers corked ahead of a DATA payload no longer force
// a tiny flush of their own.
const H2_CORK_BUFFER_SIZE: usize = 16384;

thread_local! {
    // Boxed so only a pointer lives in static TLS — a 16 KB buffer would otherwise
    // dominate PT_TLS MemSiz on every thread (see test/js/bun/binary/tls-segment-size).
    // Lazily allocated on first HTTP/2 access; threads that never touch h2 pay nothing.
    static CORK_BUFFER: RefCell<Box<[u8; H2_CORK_BUFFER_SIZE]>> =
        RefCell::new(Box::new([0u8; H2_CORK_BUFFER_SIZE]));
    static CORK_OFFSET: Cell<u16> = const { Cell::new(0) };
    // Multi-frame DATA batches (send_data): all frame headers + payload slices of one
    // write are serialized here and hit the socket in a single _write, instead of one
    // cork flush per 16 KB frame. Reused across calls; capacity is capped after use.
    static BATCH_BUFFER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    // Wire-order segments of the in-progress send_data batch: frame headers (and any
    // padded frames) live in BATCH_BUFFER and are referenced by offset; payload slices
    // of plain-TCP writes are referenced directly so flush can writev them without
    // copying 16 KB per frame into the batch.
    static BATCH_SEGMENTS: RefCell<Vec<BatchSegment>> = const { RefCell::new(Vec::new()) };
    // Reused iovec scratch for the vectored flush.
    static BATCH_IOVECS: RefCell<Vec<bun_uws_sys::UsIoVec>> = const { RefCell::new(Vec::new()) };
    /// The parser whose frames `CORK_BUFFER` holds; the slot keeps a ref on it.
    /// `ManuallyDrop` so the slot needs no TLS destructor (a bare
    /// `#[thread_local]`, and nothing derefs a parser at thread exit).
    static CORKED_H2: Cell<ManuallyDrop<Option<RefPtr<H2FrameParser>>>> =
        const { Cell::new(ManuallyDrop::new(None)) };
    // `ManuallyDrop` inside the `Box`: the TLS destructor runs after
    // `WebWorker::destroy` has raw-deallocated the VM, so `HiveArray::Drop`
    // on any leaked parser would touch freed JSC/uws state. Skip slot
    // teardown (a leaked parser is a bug anyway) while still freeing the
    // pool allocation itself.
    static POOL: RefCell<Option<Box<ManuallyDrop<H2FrameParserHiveAllocator>>>> =
        const { RefCell::new(None) };
}

/// One wire-order piece of a multi-frame send_data batch (see BATCH_SEGMENTS).
#[derive(Clone, Copy)]
enum BatchSegment {
    /// Bytes inside BATCH_BUFFER (frame headers, padded frames, corked prefix).
    Batch { off: u32, len: u32 },
    /// A borrowed payload slice, valid for the duration of the send_data call.
    Ext { ptr: *const u8, len: u32 },
}

impl BatchSegment {
    #[inline(always)]
    fn raw_parts(self, batch: &[u8]) -> (*const u8, usize) {
        match self {
            BatchSegment::Batch { off, len } => (batch[off as usize..].as_ptr(), len as usize),
            BatchSegment::Ext { ptr, len } => (ptr, len as usize),
        }
    }
}

/// Flags for one `H2FrameParser::send_data` call.
#[derive(Clone, Copy)]
struct SendDataOptions {
    close: bool,
    /// Report a HALF_CLOSED_LOCAL transition through the return value instead of onStreamEnd.
    suppress_half_closed_local_dispatch: bool,
    /// Hand an unqueued payload's write callback back to the caller instead of invoking it here.
    defer_write_callback: bool,
}

/// Frames count as sent once serialized, so `detach(true)` keeps the parser attached until the socket has taken them.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Draining {
    #[default]
    No,
    /// Attached only to write the buffered output. No streams, no JS context, no inbound frames.
    Output,
    /// Also sends the FIN the socket asked for in the meantime (`defer_shutdown`).
    OutputThenFin,
}

struct FlagGuard<'a>(&'a Cell<bool>);

impl<'a> FlagGuard<'a> {
    fn set(flag: &'a Cell<bool>) -> Self {
        flag.set(true);
        FlagGuard(flag)
    }
}

impl Drop for FlagGuard<'_> {
    fn drop(&mut self) {
        self.0.set(false);
    }
}

/// A callback queued while `engine.receive()` runs, so that JS only runs between frames. `receive` calls it.
enum Deferred {
    /// `handlers.<event>(ctx, args...)`
    Event {
        event: GetCached,
        args: [DeferredArg; 4],
        argc: u8,
    },
    WriteCallback(Strong),
    /// Runs all of `Sink::on_stream_end`. It changes stream state JS can observe, so it must stay behind earlier callbacks.
    StreamEnd(Rc<Stream>),
    /// Runs all of `Sink::on_stream_reset`, queued for the same reason.
    StreamReset {
        stream: Rc<Stream>,
        code: u32,
    },
}

enum DeferredArg {
    Immediate(JSValue),
    Cell(Strong),
    /// The stream's JS context, looked up at delivery like an inline dispatch does.
    StreamCtx(u32),
}

/// The first argument of an event: a value, or the stream whose JS context to pass.
#[derive(Clone, Copy)]
enum Target {
    Value(JSValue),
    Stream(u32),
}

/// Follows the byte stream `write()` emits over a JS-backed transport and reports when it
/// sits at a point where another frame may legally begin: between frames, and not inside a
/// header block (HEADERS / PUSH_PROMISE without END_HEADERS up to the CONTINUATION that carries
/// it, RFC 9113 §4.3). See `write_to_js_transport`.
#[derive(Clone, Copy, Default)]
struct TxFrameTracker {
    /// Payload bytes still owed on the current frame.
    remaining: u32,
    /// A frame header split across chunks is collected here until all 9 bytes are known.
    header: [u8; FRAME_HEADER_SIZE],
    header_len: u8,
    /// A HEADERS/PUSH_PROMISE/CONTINUATION without END_HEADERS went out; the block is open.
    header_block_open: bool,
}

impl TxFrameTracker {
    fn at_boundary(&self) -> bool {
        self.remaining == 0 && self.header_len == 0 && !self.header_block_open
    }

    fn advance(&mut self, mut chunk: &[u8]) {
        while !chunk.is_empty() {
            if self.remaining > 0 {
                let take = (self.remaining as usize).min(chunk.len());
                self.remaining -= take as u32;
                chunk = &chunk[take..];
                continue;
            }
            if self.header_len == 0 && chunk.starts_with(CONNECTION_PREFACE) {
                // The client magic precedes the first SETTINGS frame; it is not a frame.
                chunk = &chunk[CONNECTION_PREFACE.len()..];
                continue;
            }
            let have = self.header_len as usize;
            let take = (FRAME_HEADER_SIZE - have).min(chunk.len());
            self.header[have..have + take].copy_from_slice(&chunk[..take]);
            self.header_len += take as u8;
            chunk = &chunk[take..];
            if self.header_len as usize == FRAME_HEADER_SIZE {
                let header = FrameHeader::parse(&self.header);
                self.header_len = 0;
                self.remaining = header.length;
                if matches!(
                    FrameType::from_u8(header.frame_type),
                    Some(FrameType::Headers | FrameType::PushPromise | FrameType::Continuation)
                ) {
                    self.header_block_open = !header.has(flags::END_HEADERS);
                }
            }
        }
    }
}

/// The `+1` a native frame holds on the parser while it runs code that can free it (an inbound
/// dispatch, a write that re-enters JS). Live guards are counted in
/// `H2FrameParser::native_keepalives` so `finalize` can release the ones whose frame will never
/// return — see `release_refs_stranded_by_exit`.
struct Keepalive<'a>(&'a H2FrameParser);

impl Drop for Keepalive<'_> {
    fn drop(&mut self) {
        let parser = self.0;
        debug_assert!(parser.native_keepalives.get() > 0);
        // Decrement first: this `deref()` can be the last one and free `parser`.
        parser
            .native_keepalives
            .set(parser.native_keepalives.get() - 1);
        parser.deref();
    }
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::release)]
pub(crate) struct H2FrameParser {
    /// A session is closed from script (`detach_from_js`, when its socket closes). The script of a
    /// `Bun.ModuleGraph` that was disposed is told nothing, so the graph's context closes it.
    abort_handle: bun_jsc::AbortHandle,
    strong_this: JsCell<JsRef>,
    global_this: GlobalRef, // JSC_BORROW — read-only after construction
    // allocator field dropped — global mimalloc
    handlers: Handlers,
    native_socket: NativeSocket,
    /// Bitmask (SETTING_BIT_*) of standard SETTINGS explicitly provided by JS. node only
    /// serializes explicitly submitted settings — defaults are never put on the wire, so the
    /// initial SETTINGS frame for default options is empty.
    explicit_settings: Cell<u8>,
    /// Custom (non-standard id) settings provided by JS, accumulated across every settings()
    /// call. Reported on localSettings.customSettings (node's Http2Settings::Update reads the
    /// session-level custom_settings_state, which is cumulative).
    custom_settings: JsCell<Vec<(u16, u32)>>,
    /// Custom settings carried by the most recent settings() call only. Node's
    /// updateSettingsBuffer resets numCustomSettings per call, so the wire SETTINGS frame must
    /// carry only this submission's keys.
    wire_custom_settings: JsCell<Vec<(u16, u32)>>,
    /// Setting ids from the remoteCustomSettings option: received SETTINGS entries with these
    /// (non-standard) ids are exposed on remoteSettings.customSettings.
    remote_custom_settings_filter: JsCell<Vec<u16>>,
    /// Captured (id, value) pairs for the ids in remote_custom_settings_filter.
    remote_custom_settings: JsCell<Vec<(u16, u32)>>,

    // local Window limits the download of data
    // current window size for the connection
    window_size: Cell<u64>,

    max_rejected_streams: Cell<u32>,
    rejected_streams: Cell<u32>,
    queued_data_size: Cell<u64>, // this is in bytes
    max_outstanding_pings: Cell<u64>,
    out_standing_pings: Cell<u64>,
    max_send_header_block_length: Cell<u32>,
    /// node strictSingleValueFields session option (default true): when false, duplicate
    /// single-value headers and array values for them are encoded as-is instead of rejected.
    strict_single_value_fields: Cell<bool>,
    /// A frame callback left an exception pending in this batch (`Sink::should_stop`).
    left_exception: Cell<bool>,
    // we buffer requests until we get the first settings ACK
    write_buffer: JsCell<Vec<u8>>,
    write_buffer_offset: Cell<usize>,
    /// True while flush_stream_queue() is on the stack.
    flushing_stream_queue: Cell<bool>,
    // TODO: this will be removed when I re-add header and data priorization
    outbound_queue_size: Cell<usize>,

    has_nonnative_backpressure: Cell<bool>,
    /// True while flush() has bytes out in an onWrite dispatch to a JS-backed socket.
    js_socket_flushing: Cell<bool>,
    /// A native write returned a terminal result (socket closed, shut down, or the kernel
    /// rejected the send). Latched once; the deferred tick closes the transport.
    transport_write_fatal: Cell<bool>,
    draining: Cell<Draining>,
    /// An outbound header block the HPACK encoder could not emit. Latched once; the deferred
    /// tick reports it, because it is detected inside a user submit call.
    pending_header_compression_error: Cell<bool>,
    /// Where the bytes emitted through `write()` over a JS-backed transport stand relative to
    /// frame and header-block boundaries.
    tx_tracker: Cell<TxFrameTracker>,
    ref_count: bun_ptr::RefCount<Self>, // intrusive — bun.ptr.RefCount(@This(), "ref_count", deinit, .{})
    /// Number of live `Keepalive` guards: the `+1`s held by native frames currently on the stack.
    /// Read only by `release_refs_stranded_by_exit()`.
    native_keepalives: Cell<u32>,

    auto_flusher: JsCell<AutoFlusher>,

    engine: Connection,
    /// Frames written, for the perf_hooks session entry.
    frames_sent: Cell<u64>,
    /// Unconsumed inbound tail (the engine holds no reassembly buffer — design B): bytes after the
    /// last complete frame are kept here and prepended to the next read().
    inbound_tail: JsCell<Vec<u8>>,
    /// Read cursor into `inbound_tail` while a batch has its remainder parked there, otherwise 0.
    inbound_tail_pos: Cell<usize>,
    /// `engine.receive()` is on the stack, so events go to `deferred`.
    receiving: Cell<bool>,
    deferred: JsCell<VecDeque<Deferred>>,
    /// Promised stream id whose PUSH_PROMISE header block is being delivered by the engine (its
    /// on_headers_complete dispatches onStreamPush instead of onStreamHeaders).
    pending_push: Cell<u32>,
    /// In-progress decoded header array + sensitive-name array, accumulated across on_header.
    /// Packed name/value bytes of the header block being decoded (reused per block).
    hdr_block: JsCell<Vec<u8>>,
    /// Per-field metadata for `hdr_block`: [nameLen | (sensitive << 31), valueLen].
    hdr_meta: JsCell<Vec<u32>>,
}

impl H2FrameParser {
    /// `RefCounted` destructor (and the constructor's error path): drop in
    /// place, then return the slot to the pool (or free the Box).
    fn release(this: *mut Self) {
        if ENABLE_ALLOCATOR_POOL {
            POOL.with_borrow_mut(|pool| {
                // SAFETY: `this` is a live, fully-initialised allocation we exclusively
                // own; `put` drops it in place and recycles the storage.
                unsafe {
                    pool.as_mut()
                        .expect("H2FrameParser released before constructor initialised pool")
                        .put(this)
                }
            });
        } else {
            // SAFETY: `this` was `heap::alloc`'d in `constructor`.
            unsafe { bun_core::heap::destroy(this) };
        }
    }

    /// Safe accessor for the JSC_BORROW global.
    #[inline]
    fn global(&self) -> GlobalRef {
        self.global_this
    }

    /// `self`'s address as `*mut Self` for uSockets / deferred-task ctx slots.
    /// The callbacks deref it as `&*const` (shared) — see `on_auto_flush_trampoline`
    /// — so no write provenance is required; the `*mut` spelling is purely to
    /// match the C signature. All mutation goes through `Cell`/`JsCell` fields.
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    /// Hold a `+1` for the extent of a native frame that can re-enter JS (and therefore free the
    /// parser). Counted, so `finalize` can release it if `process.exit()` strands the frame.
    fn keepalive(&self) -> Keepalive<'_> {
        self.ref_();
        self.native_keepalives.set(self.native_keepalives.get() + 1);
        Keepalive(self)
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    pub(crate) fn ref_(&self) {
        // SAFETY: `self` is live; `RefCount::ref_` only reads/writes the
        // embedded `ref_count` Cell (interior-mutable), so `&self`→`*mut`
        // is sound for that single field access.
        unsafe { bun_ptr::RefCount::<Self>::ref_(self.as_ctx_ptr()) };
    }
    // R-2: `&self` — `RefCount` is `Cell`-backed and every other field is
    // `Cell`/`JsCell`, so `Drop` writes only through `UnsafeCell`-derived
    // pointers; the `*mut` cast is signature-only.
    pub(crate) fn deref(&self) {
        // SAFETY: `self` is live; `deref` decrements the intrusive count and,
        // on zero, drops and releases the slot. The caller must not touch
        // `self` after this returns when count was 1.
        unsafe { bun_ptr::RefCount::<Self>::deref(self.as_ctx_ptr()) };
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FlushState {
    NoAction,
    Flushed,
    Backpressure,
}

impl H2FrameParser {
    /// Takes a DATA frame's payload out of both send windows (RFC 9113 §6.9.1).
    fn consume_send_windows(&self, stream: &Stream, payload_size: usize) {
        update(&stream.send_window, |w| w.consume(payload_size));
        update(&self.engine.send_window, |w| w.consume(payload_size));
    }

    /// Sends the first queued frame of `stream`, or as much of it as the send windows allow.
    fn flush_queue(&self, stream: &Stream, written: &mut usize) -> FlushState {
        if !stream.state().can_send() {
            return FlushState::NoAction;
        }
        let Some((is_empty_frame, unsent)) = stream
            .queue
            .get()
            .front()
            .map(|frame| (frame.buffer.is_empty(), frame.unsent().len()))
        else {
            return FlushState::NoAction;
        };
        let max_size = unsent.min(self.sendable_data_size(stream));
        if !is_empty_frame && max_size == 0 {
            // An empty connection window stops every stream, so the caller can stop looking.
            return if self.engine.send_window.get().available() == 0 {
                FlushState::Backpressure
            } else {
                FlushState::NoAction
            };
        }
        self.queued_data_size
            .set(self.queued_data_size.get() - max_size as u64);
        *written += max_size;
        self.consume_send_windows(stream, max_size);

        if max_size < unsent {
            // Copied out, because JS under the write can queue more on this stream.
            let chunk = stream.queue.with_mut(|queue| {
                let frame = queue.front_mut()?;
                let chunk = frame.unsent()[..max_size].to_vec();
                frame.offset += max_size;
                Some(chunk)
            });
            let sent = chunk
                .is_none_or(|chunk| self.write_frame(FrameType::Data, 0, stream.id, &[&chunk]));
            return if sent {
                FlushState::Flushed
            } else {
                FlushState::Backpressure
            };
        }

        let Some(frame) = stream.queue.with_mut(VecDeque::pop_front) else {
            return FlushState::NoAction;
        };
        let end_stream = frame.end_stream && !stream.wait_for_trailers.get();
        // Peers count an empty DATA frame without END_STREAM as a flood, so never send one.
        let sent = (is_empty_frame && !end_stream)
            || self.write_frame(
                FrameType::Data,
                if end_stream { flags::END_STREAM } else { 0 },
                stream.id,
                &[frame.unsent()],
            );
        self.outbound_queue_size
            .set(self.outbound_queue_size.get() - 1);
        if let Some(callback) = frame.callback.get() {
            self.dispatch_write_callback(callback);
        }
        if frame.end_stream && stream.queue.get().is_empty() {
            if stream.wait_for_trailers.get() {
                self.dispatch(js::on_want_trailers_get_cached, stream.context());
            } else {
                self.sent_end_stream(stream, false);
            }
        }
        if sent {
            FlushState::Flushed
        } else {
            FlushState::Backpressure
        }
    }

    /// Queues DATA that can't go out now. Writes are merged into full frames.
    fn queue_frame(&self, stream: &Stream, bytes: &[u8], callback: JSValue, end_stream: bool) {
        let global = self.global_this;
        let callback = if callback.is_callable() {
            StrongOptional::create(callback, &global)
        } else {
            StrongOptional::empty()
        };
        // Top up the last queued frame first.
        let mut rest = bytes;
        let mut callback = Some(callback);
        let superseded = stream.queue.with_mut(|queue| {
            let last = queue.back_mut()?;
            if last.buffer.is_empty() && !rest.is_empty() {
                last.buffer = Vec::with_capacity(MAX_PAYLOAD_SIZE_WITHOUT_FRAME);
            }
            let room = MAX_PAYLOAD_SIZE_WITHOUT_FRAME - last.buffer.len();
            let (merged, after) = rest.split_at(rest.len().min(room));
            last.buffer.extend_from_slice(merged);
            rest = after;
            if !rest.is_empty() {
                return None;
            }
            last.end_stream = end_stream;
            Some(core::mem::replace(&mut last.callback, callback.take()?))
        });
        self.queued_data_size
            .set(self.queued_data_size.get() + (bytes.len() - rest.len()) as u64);
        // A frame holds one callback, so the one it had is called now.
        if let Some(superseded) = superseded {
            if let Some(superseded) = superseded.get() {
                self.dispatch_write_callback(superseded);
            }
            return;
        }

        let mut buffer = Vec::new();
        if !rest.is_empty() {
            // Room for a full frame, so later writes merge into this one without reallocating.
            buffer.reserve_exact(MAX_PAYLOAD_SIZE_WITHOUT_FRAME);
            buffer.extend_from_slice(rest);
            global.vm().deprecated_report_extra_memory(rest.len());
        }
        stream.queue.with_mut(|queue| {
            queue.push_back(PendingFrame {
                end_stream,
                offset: 0,
                buffer,
                callback: callback.take().unwrap_or_default(),
            })
        });
        self.outbound_queue_size
            .set(self.outbound_queue_size.get() + 1);
        self.queued_data_size
            .set(self.queued_data_size.get() + rest.len() as u64);
    }

    /// Drops the DATA a closed stream still had queued and calls the write callbacks.
    fn drop_queued_data(&self, stream: &Stream) {
        // A write callback can destroy the session and drop the socket's ref on this parser.
        let _keepalive = self.keepalive();
        for frame in stream.queue.take() {
            self.queued_data_size
                .set(self.queued_data_size.get() - frame.unsent().len() as u64);
            if let Some(callback) = frame.callback.get() {
                self.dispatch_write_callback(callback);
            }
            self.outbound_queue_size
                .set(self.outbound_queue_size.get() - 1);
        }
    }

    /// We sent END_STREAM. Tells JS the state the stream is in now and returns it. `quiet` skips that for half-closed (local).
    fn sent_end_stream(&self, stream: &Stream, quiet: bool) -> State {
        let context = stream.context();
        context.ensure_still_alive();
        let _ = self
            .engine
            .streams
            .apply(stream, StreamEvent::SendEndStream);
        let state = stream.state();
        if state == State::Closed {
            stream.close_delivered.set(true);
            self.drop_queued_data(stream);
        }
        if !(quiet && state == State::HalfClosedLocal) {
            self.dispatch_with_extra(
                js::on_stream_end_get_cached,
                context,
                JSValue::js_number(state as u8 as f64),
            );
        }
        state
    }
}

/// The per-VM header scratch, held for one outbound header call and put back on drop.
struct HeaderScratch<'a> {
    global: &'a JSGlobalObject,
    scratch: H2HeaderScratch,
}

impl<'a> HeaderScratch<'a> {
    fn take(global: &'a JSGlobalObject) -> Self {
        Self {
            global,
            scratch: global
                .bun_vm()
                .as_mut()
                .rare_data()
                .take_h2_header_scratch(),
        }
    }
}

impl Drop for HeaderScratch<'_> {
    fn drop(&mut self) {
        self.global
            .bun_vm()
            .as_mut()
            .rare_data()
            .put_back_h2_header_scratch(core::mem::take(&mut self.scratch));
    }
}

impl core::ops::Deref for HeaderScratch<'_> {
    type Target = H2HeaderScratch;
    fn deref(&self) -> &H2HeaderScratch {
        &self.scratch
    }
}

impl core::ops::DerefMut for HeaderScratch<'_> {
    fn deref_mut(&mut self) -> &mut H2HeaderScratch {
        &mut self.scratch
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — core methods
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    /// nghttp2 counts the priority bytes of every HEADERS frame: https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_session.c#L2095-L2101
    fn is_over_send_limit(&self, block: &lshpack::HeaderBlock) -> bool {
        const PRIORITY_SPEC_LEN: usize = 5;
        block.deflate_bound() + PRIORITY_SPEC_LEN > self.max_send_header_block_length.get() as usize
    }

    /// Encodes all of `scratch.block` into `scratch.encoded`, or nothing on error.
    fn encode_header_list(&self, scratch: &mut H2HeaderScratch) -> crate::Result<()> {
        scratch.encoded.clear();
        // 256 extra bytes for a PADDED frame's pad-length byte and padding.
        scratch
            .encoded
            .try_reserve(lshpack::MAX_SIZE_UPDATE_BYTES + scratch.block.encode_bound() + 256)
            .map_err(|_| bun_alloc::AllocError)?;
        bun_output::scoped_log!(
            H2FrameParser,
            "encode header block: {} fields",
            scratch.block.len()
        );
        self.engine.hpack.with_mut(|hpack| {
            hpack.encode_block(&scratch.block, &mut scratch.encoded)?;
            Ok(())
        })
    }

    /// Serialize the SETTINGS entries that go on the wire: only the standard parameters JS set
    /// explicitly plus any custom settings (node never serializes defaults — a session created
    /// with default options sends an empty SETTINGS frame). Returns the payload length.
    fn write_settings_payload(&self, out: &mut [u8; MAX_SETTINGS_PAYLOAD_SIZE]) -> usize {
        let s = self.engine.local_settings.get();
        let mask = self.explicit_settings.get();
        let mut off = 0usize;
        let mut put = |out: &mut [u8; MAX_SETTINGS_PAYLOAD_SIZE], id: u16, value: u32| {
            out[off..off + settings::ENTRY_SIZE].copy_from_slice(&settings::entry(id, value));
            off += settings::ENTRY_SIZE;
        };
        let standard = [
            (
                SETTING_BIT_HEADER_TABLE_SIZE,
                SettingId::HeaderTableSize,
                s.header_table_size,
            ),
            (
                SETTING_BIT_ENABLE_PUSH,
                SettingId::EnablePush,
                u32::from(s.enable_push),
            ),
            (
                SETTING_BIT_MAX_CONCURRENT_STREAMS,
                SettingId::MaxConcurrentStreams,
                s.max_concurrent_streams,
            ),
            (
                SETTING_BIT_INITIAL_WINDOW_SIZE,
                SettingId::InitialWindowSize,
                s.initial_window_size,
            ),
            (
                SETTING_BIT_MAX_FRAME_SIZE,
                SettingId::MaxFrameSize,
                s.max_frame_size,
            ),
            (
                SETTING_BIT_MAX_HEADER_LIST_SIZE,
                SettingId::MaxHeaderListSize,
                s.max_header_list_size,
            ),
            (
                SETTING_BIT_ENABLE_CONNECT_PROTOCOL,
                SettingId::EnableConnectProtocol,
                u32::from(s.enable_connect_protocol),
            ),
        ];
        for (bit, id, value) in standard {
            if mask & bit != 0 {
                put(out, id as u16, value);
            }
        }
        for (id, value) in self.wire_custom_settings.get().iter() {
            put(out, *id, *value);
        }
        off
    }

    fn set_settings(&self, settings: Settings) {
        self.engine.local_settings.set(settings);
        let mut payload = [0u8; MAX_SETTINGS_PAYLOAD_SIZE];
        let payload_len = self.write_settings_payload(&mut payload);

        // §6.5.3: the peer's ACKs apply to the outstanding SETTINGS frames in order.
        self.engine
            .pending_local_settings_acks
            .with_mut(|v| v.push_back(settings));
        self.write_frame(FrameType::Settings, 0, 0, &[&payload[..payload_len]]);
    }

    /// Resets a stream that is still open and tells JS. `on_wire` is false if the peer never heard of the stream or the session is over.
    fn reset_stream(&self, stream: &Stream, rst_code: ErrorCode, on_wire: bool) {
        if !self.engine.streams.close(stream) {
            return;
        }
        stream.reset.set(Some(ResetBy::Us));
        stream.close_delivered.set(true);
        let context = stream.context();
        context.ensure_still_alive();
        self.drop_queued_data(stream);
        if on_wire {
            // Written before the handler runs: it can submit a queued request, whose HEADERS must follow this frame.
            self.write_frame(
                FrameType::RstStream,
                0,
                stream.id,
                &[&rst_code.0.to_be_bytes()],
            );
        }
        if on_wire && rst_code == ErrorCode::NO_ERROR {
            self.dispatch_with_extra(
                js::on_stream_end_get_cached,
                context,
                JSValue::js_number(State::Closed as u8 as f64),
            );
        } else {
            self.dispatch_with_extra(
                js::on_stream_error_get_cached,
                context,
                JSValue::js_number(rst_code.0 as f64),
            );
        }
    }

    pub(crate) fn send_go_away(
        &self,
        rst_code: ErrorCode,
        debug_data: &[u8],
        last_stream_id: u32,
        emit_error: bool,
    ) {
        self.engine
            .write_go_away(self, last_stream_id, rst_code, debug_data);
        let global = self.global();
        let chunk = match BinaryType::Buffer.to_js(debug_data, &global) {
            Ok(v) => v,
            Err(err) => {
                self.dispatch(js::on_error_get_cached, self.global().take_exception(err));
                return;
            }
        };

        if emit_error {
            if rst_code != ErrorCode::NO_ERROR {
                self.dispatch_with_2_extra(
                    js::on_error_get_cached,
                    JSValue::js_number(rst_code.0 as f64),
                    JSValue::js_number(self.engine.last_stream_id.get() as f64),
                    chunk,
                );
            }
            self.dispatch_with_extra(
                js::on_end_get_cached,
                JSValue::js_number(self.engine.last_stream_id.get() as f64),
                chunk,
            );
        }
    }

    pub(crate) fn send_alt_svc(&self, stream_identifier: u32, origin_str: &[u8], alt: &[u8]) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_ALTSVC stream {} origin {} alt {}",
            stream_identifier,
            BStr::new(origin_str),
            BStr::new(alt)
        );

        let origin_len = u16::try_from(origin_str.len()).expect("int cast");
        self.write_frame(
            FrameType::AltSvc,
            0,
            stream_identifier,
            &[&origin_len.to_be_bytes(), origin_str, alt],
        );
    }

    fn send_ping(&self, payload: &[u8]) {
        self.out_standing_pings
            .set(self.out_standing_pings.get() + 1);
        self.write_frame(FrameType::Ping, 0, 0, &[payload]);
    }

    pub(crate) fn send_preface_and_settings(&self) {
        bun_output::scoped_log!(H2FrameParser, "sendPrefaceAndSettings");
        // PREFACE + Settings Frame
        let mut payload = [0u8; MAX_SETTINGS_PAYLOAD_SIZE];
        let payload_len = self.write_settings_payload(&mut payload);
        self.engine
            .pending_local_settings_acks
            .with_mut(|v| v.push_back(self.engine.local_settings.get()));
        let _ = self.write(CONNECTION_PREFACE);
        self.write_frame(FrameType::Settings, 0, 0, &[&payload[..payload_len]]);
    }

    /// Calls `handlers.<event>(ctx, args...)` now.
    fn deliver(&self, event: GetCached, args: &[JSValue]) {
        let Some(this_value) = self.strong_this.get().try_get() else {
            return;
        };
        let Some(ctx_value) = js::context_get_cached(this_value) else {
            return;
        };
        let mut argv = [ctx_value; 5];
        argv[1..=args.len()].copy_from_slice(args);
        let _ =
            self.handlers
                .call_event_handler(event, this_value, ctx_value, &argv[..=args.len()]);
    }

    /// Delivers an event, or queues it while `receive()` is on the stack.
    fn dispatch_event(&self, event: GetCached, target: Target, extra: &[JSValue]) {
        for value in extra {
            value.ensure_still_alive();
        }
        if !self.receiving.get() {
            let mut args = [JSValue::UNDEFINED; 4];
            args[0] = match target {
                Target::Value(value) => value,
                Target::Stream(stream_id) => self.stream_context(stream_id),
            };
            args[0].ensure_still_alive();
            args[1..=extra.len()].copy_from_slice(extra);
            return self.deliver(event, &args[..=extra.len()]);
        }
        // An empty value failed to materialize. `should_skip_dispatch` would drop the event, and a `Strong` can't hold it.
        if extra.contains(&JSValue::ZERO)
            || matches!(target, Target::Value(v) if v == JSValue::ZERO)
        {
            return;
        }
        let global = self.global();
        let root = |value: JSValue| {
            if value.is_cell() {
                DeferredArg::Cell(Strong::create(value, &global))
            } else {
                DeferredArg::Immediate(value)
            }
        };
        let mut args = [const { DeferredArg::Immediate(JSValue::UNDEFINED) }; 4];
        args[0] = match target {
            Target::Value(value) => root(value),
            Target::Stream(stream_id) => DeferredArg::StreamCtx(stream_id),
        };
        for (slot, value) in args[1..].iter_mut().zip(extra) {
            *slot = root(*value);
        }
        let argc = 1 + extra.len() as u8;
        self.deferred
            .with_mut(|q| q.push_back(Deferred::Event { event, args, argc }));
    }

    /// Runs the callbacks the last `receive()` queued. A callback can re-enter `receive`, which drains the same queue.
    fn run_deferred(&self) {
        while let Some(entry) = self.deferred.with_mut(|q| q.pop_front()) {
            match entry {
                Deferred::Event { event, args, argc } => {
                    let mut values = [JSValue::UNDEFINED; 4];
                    for (value, arg) in values.iter_mut().zip(&args[..argc as usize]) {
                        *value = match arg {
                            DeferredArg::Immediate(v) => *v,
                            DeferredArg::Cell(strong) => strong.get(),
                            DeferredArg::StreamCtx(id) => self.stream_context(*id),
                        };
                    }
                    self.deliver(event, &values[..argc as usize]);
                }
                Deferred::WriteCallback(callback) => self.dispatch_write_callback(callback.get()),
                Deferred::StreamEnd(stream) => self.stream_end_now(&stream),
                Deferred::StreamReset { stream, code } => self.stream_reset_now(&stream, code),
            }
        }
    }

    pub(crate) fn dispatch(&self, event: GetCached, value: JSValue) {
        self.dispatch_event(event, Target::Value(value), &[]);
    }

    /// `onWrite(context, bytes, transportClosed)`. The flag is true once the native socket closed.
    fn call_on_write(&self, bytes: JSValue) -> JSValue {
        let Some(this_value) = self.strong_this.get().try_get() else {
            return JSValue::ZERO;
        };
        let Some(ctx_value) = js::context_get_cached(this_value) else {
            return JSValue::ZERO;
        };
        bytes.ensure_still_alive();
        self.handlers.call_event_handler_with_result(
            js::on_write_get_cached,
            this_value,
            &[
                ctx_value,
                bytes,
                JSValue::from(self.native_socket.closed.get()),
            ],
        )
    }

    pub(crate) fn dispatch_write_callback(&self, callback: JSValue) {
        if self.receiving.get() {
            if callback.is_callable() {
                let callback = Strong::create(callback, &self.global());
                self.deferred
                    .with_mut(|q| q.push_back(Deferred::WriteCallback(callback)));
            }
            return;
        }
        let _ = self.handlers.call_write_callback(callback, &[]);
    }

    pub(crate) fn dispatch_with_extra(&self, event: GetCached, value: JSValue, extra: JSValue) {
        self.dispatch_event(event, Target::Value(value), &[extra]);
    }

    pub(crate) fn dispatch_with_2_extra(
        &self,
        event: GetCached,
        value: JSValue,
        extra: JSValue,
        extra2: JSValue,
    ) {
        self.dispatch_event(event, Target::Value(value), &[extra, extra2]);
    }

    /// A header block the HPACK encoder cannot emit fails the whole session in nghttp2, so node
    /// reports ERR_HTTP2_SESSION_ERROR (COMPRESSION_ERROR) rather than resetting the stream.
    /// The stream is left open for the session teardown to error, matching node's request error.
    fn schedule_header_compression_session_error(&self) {
        if self.pending_header_compression_error.get() {
            return;
        }
        // Detected inside the caller's own submit(): node delivers session errors from the
        // event loop, so that call still returns with its stream usable for the rest of the tick.
        self.pending_header_compression_error.set(true);
        self.register_auto_flush();
    }

    fn set_corked(parser: Option<RefPtr<H2FrameParser>>) -> Option<RefPtr<H2FrameParser>> {
        CORKED_H2.with(|c| ManuallyDrop::into_inner(c.replace(ManuallyDrop::new(parser))))
    }

    /// The parser holding the cork slot, if any.
    fn corked() -> Option<*mut H2FrameParser> {
        // SAFETY: JS-thread-local; peeks without moving the ref out.
        CORKED_H2.with(|c| unsafe { (**c.as_ptr()).as_ref().map(RefPtr::as_ptr) })
    }

    fn cork(&self) {
        if let Some(corked) = Self::corked() {
            if std::ptr::eq(corked, self.as_ctx_ptr()) {
                // already corked
                return;
            }
            // force uncork
            // SAFETY: CORKED_H2 holds a ref()'d *mut H2FrameParser; valid until matching deref() in uncork
            unsafe { (*corked.cast_const()).uncork() };
        }
        // cork
        Self::set_corked(Some(self.ref_guard()));
        self.register_auto_flush();
        bun_output::scoped_log!(H2FrameParser, "cork {:p}", self);
        CORK_OFFSET.with(|c| c.set(0));
    }

    /// Takes the pending bytes out for the write: JS re-entering under it would send them again.
    fn write_pending_through_js<S: NativeSocketWrite>(
        &self,
        mut socket: S,
        bytes: &[u8],
    ) -> (usize, usize) {
        let offset = self.write_buffer_offset.replace(0);
        let mut pending = self.write_buffer.take();
        let _ = pending.write(bytes);
        let result: i32 = socket.write_maybe_corked(&pending[offset..]);
        self.restore_unwritten_pending(pending, offset, bytes.len(), result)
    }

    fn restore_unwritten_pending(
        &self,
        pending: Vec<u8>,
        offset: usize,
        appended: usize,
        result: i32,
    ) -> (usize, usize) {
        let total = pending.len() - offset;
        let written: usize = if result < 0 {
            if Self::is_transport_fatal_write_result(result) {
                self.note_transport_write_fatal();
            }
            0
        } else {
            usize::try_from(result).expect("int cast")
        };
        if written < total {
            // The rest goes back in front of whatever a re-entrant write buffered meanwhile.
            let reentrant_offset = self.write_buffer_offset.replace(offset + written);
            let reentrant = self.write_buffer.replace(pending);
            let _ = self
                .write_buffer
                .with_mut(|wb| wb.write(&reentrant[reentrant_offset..]));
            self.global()
                .vm()
                .deprecated_report_extra_memory(appended.min(total - written));
        }
        (written, total)
    }

    pub(crate) fn generic_flush<S: NativeSocketWrite>(&self, mut socket: S) -> usize {
        let buffer_len = self.write_buffer.get().slice()[self.write_buffer_offset.get()..].len();
        if buffer_len > 0 {
            if self.transport_write_runs_js() {
                let (written, _) = self.write_pending_through_js(socket, b"");
                bun_output::scoped_log!(H2FrameParser, "_genericFlush {}", written);
                return written;
            }
            let result: i32 = socket.write_maybe_corked(
                &self.write_buffer.get().slice()[self.write_buffer_offset.get()..],
            );
            let written: u32 = if result < 0 {
                if Self::is_transport_fatal_write_result(result) {
                    self.note_transport_write_fatal();
                }
                0
            } else {
                u32::try_from(result).expect("int cast")
            };

            if (written as usize) < buffer_len {
                self.write_buffer_offset
                    .set(self.write_buffer_offset.get() + written as usize);
                bun_output::scoped_log!(H2FrameParser, "_genericFlush {}", written);
                return written as usize;
            }

            // all the buffer was written! reset things
            self.write_buffer_offset.set(0);
            self.write_buffer.with_mut(|wb| {
                wb.clear();
                // lets keep size under control
                if wb.capacity() > MAX_BUFFER_SIZE as usize {
                    wb.shrink_to(MAX_BUFFER_SIZE as usize);
                }
            });
            bun_output::scoped_log!(H2FrameParser, "_genericFlush {}", buffer_len);
        } else {
            bun_output::scoped_log!(H2FrameParser, "_genericFlush 0");
        }
        buffer_len
    }

    pub(crate) fn generic_write<S: NativeSocketWrite>(&self, mut socket: S, bytes: &[u8]) -> bool {
        bun_output::scoped_log!(H2FrameParser, "_genericWrite {}", bytes.len());

        let global = self.global();
        let buffered_len = self.write_buffer.get().slice()[self.write_buffer_offset.get()..].len();
        if buffered_len > 0 {
            if self.transport_write_runs_js() {
                let (written, total) = self.write_pending_through_js(socket, bytes);
                return written == total;
            }
            {
                let result: i32 = socket.write_maybe_corked(
                    &self.write_buffer.get().slice()[self.write_buffer_offset.get()..],
                );
                let written: u32 = if result < 0 {
                    if Self::is_transport_fatal_write_result(result) {
                        self.note_transport_write_fatal();
                    }
                    0
                } else {
                    u32::try_from(result).expect("int cast")
                };
                if (written as usize) < buffered_len {
                    self.write_buffer_offset
                        .set(self.write_buffer_offset.get() + written as usize);

                    // we still have more to buffer and even more now
                    let _ = self.write_buffer.with_mut(|wb| wb.write(bytes));
                    global.vm().deprecated_report_extra_memory(bytes.len());

                    bun_output::scoped_log!(
                        H2FrameParser,
                        "_genericWrite flushed {} and buffered more {}",
                        written,
                        bytes.len()
                    );
                    return false;
                }
            }
            // all the buffer was written!
            self.write_buffer_offset.set(0);
            self.write_buffer.with_mut(|wb| wb.clear());
            {
                let result: i32 = socket.write_maybe_corked(bytes);
                let written: u32 = if result < 0 {
                    if Self::is_transport_fatal_write_result(result) {
                        self.note_transport_write_fatal();
                    }
                    0
                } else {
                    u32::try_from(result).expect("int cast")
                };
                if (written as usize) < bytes.len() {
                    let pending = &bytes[written as usize..];
                    // ops not all data was sent, lets buffer again
                    let _ = self.write_buffer.with_mut(|wb| wb.write(pending));
                    global.vm().deprecated_report_extra_memory(pending.len());

                    bun_output::scoped_log!(
                        H2FrameParser,
                        "_genericWrite buffered more {}",
                        pending.len()
                    );
                    return false;
                }
            }
            // lets keep size under control
            self.write_buffer.with_mut(|wb| {
                if wb.capacity() > MAX_BUFFER_SIZE as usize {
                    wb.shrink_to(MAX_BUFFER_SIZE as usize);
                }
            });
            return true;
        }
        let result: i32 = socket.write_maybe_corked(bytes);
        let written: u32 = if result < 0 {
            if Self::is_transport_fatal_write_result(result) {
                self.note_transport_write_fatal();
            }
            0
        } else {
            u32::try_from(result).expect("int cast")
        };
        if (written as usize) < bytes.len() {
            let pending = &bytes[written as usize..];
            // ops not all data was sent, lets buffer again
            let _ = self.write_buffer.with_mut(|wb| wb.write(pending));
            global.vm().deprecated_report_extra_memory(pending.len());
            return false;
        }
        true
    }

    /// be sure that we dont have any backpressure/data queued on writerBuffer before calling this
    fn flush_stream_queue(&self) -> usize {
        // A write callback that calls flush() would nest one level per queued stream. The loop below picks up its frames.
        if self.flushing_stream_queue.get() {
            return 0;
        }
        let _flushing = FlagGuard::set(&self.flushing_stream_queue);
        bun_output::scoped_log!(
            H2FrameParser,
            "flushStreamQueue {}",
            self.outbound_queue_size.get()
        );
        let mut written: usize = 0;
        let mut something_was_flushed = true;

        // try to send as much as we can until we reach backpressure or until we can't flush anymore
        while self.outbound_queue_size.get() > 0 && something_was_flushed {
            something_was_flushed = false;
            for stream in self.engine.streams.snapshot() {
                // The cork hides a refused write from flush_queue() until a write callback flushes it.
                if self.has_backpressure() {
                    return written;
                }
                match self.flush_queue(&stream, &mut written) {
                    FlushState::Flushed => something_was_flushed = true,
                    FlushState::NoAction => {}
                    FlushState::Backpressure => return written,
                }
            }
        }
        written
    }

    pub(crate) fn flush(&self) -> usize {
        bun_output::scoped_log!(H2FrameParser, "flush");
        // onWrite re-enters JS; a synchronous transport (duplexPair) can re-enter flush():
        // bail so in-flight bytes are not sent twice (through any arm — a connect callback
        // inside the dispatch may have attached a native socket).
        if self.js_socket_flushing.get() {
            return 0;
        }
        if !self.tx_tracker.get().at_boundary() {
            // Mid-frame or mid-header-block (see write_to_js_transport): flushing now would
            // put the cork or write_buffer inside that unit. It completes synchronously and
            // the cork's auto-flush is already registered.
            return 0;
        }
        // Keep `self` alive across the re-entrant JS calls below.
        let _keepalive = self.keepalive();

        let mut written = self.uncork();
        written += match self.native_socket.get() {
            BunSocket::TlsWriteonly(socket) | BunSocket::Tls(socket) => {
                self.generic_flush(socket.get())
            }
            BunSocket::TcpWriteonly(socket) | BunSocket::Tcp(socket) => {
                self.generic_flush(socket.get())
            }
            BunSocket::None => {
                // consider that backpressure is gone and flush data queue
                self.has_nonnative_backpressure.set(false);
                let offset = self.write_buffer_offset.get();
                let bytes_len = self.write_buffer.get().slice()[offset..].len();
                if bytes_len > 0 {
                    let global = self.global();
                    // A failed conversion means the VM is terminating (or OOM): report
                    // nothing flushed instead of calling JS with an empty value.
                    let Ok(output_value) = BinaryType::Buffer
                        .to_js(&self.write_buffer.get().slice()[offset..], &global)
                    else {
                        return 0;
                    };
                    self.js_socket_flushing.set(true);
                    let result = self.call_on_write(output_value);
                    self.js_socket_flushing.set(false);

                    // Same contract as _write: -1 dropped, 0 queued by the socket, else sent.
                    let code = if result.is_number() {
                        result.to_int32()
                    } else {
                        -1
                    };
                    if code == -1 {
                        // JS did not take the bytes (socket not ready). Keep them queued;
                        // clearing here loses the connection preface when peer frames arrive
                        // before the connect callback has run.
                        self.has_nonnative_backpressure.set(true);
                        return 0;
                    }

                    // Consume exactly what was handed to JS; re-entrant writes during dispatch
                    // sit after it and wait for the next flush. `>=` also covers the buffer
                    // being cleared (detach) mid-dispatch, where advancing would strand the offset.
                    if offset + bytes_len >= self.write_buffer.get().slice().len() {
                        self.write_buffer_offset.set(0);
                        self.write_buffer.with_mut(|wb| {
                            wb.clear();
                            if wb.capacity() > MAX_BUFFER_SIZE as usize {
                                wb.shrink_to(MAX_BUFFER_SIZE as usize);
                            }
                        });
                    } else {
                        self.write_buffer_offset.set(offset + bytes_len);
                    }

                    if code == 0 {
                        self.has_nonnative_backpressure.set(true);
                        return bytes_len;
                    }
                }

                return self.flush_stream_queue();
            }
        };
        // if no backpressure flush data queue
        if !self.has_backpressure() {
            written += self.flush_stream_queue();
        }
        written
    }

    pub(crate) fn _write(&self, bytes: &[u8]) -> bool {
        let _keepalive = self.keepalive();
        match self.native_socket.get() {
            BunSocket::TlsWriteonly(socket) | BunSocket::Tls(socket) => {
                self.generic_write(socket.get(), bytes)
            }
            BunSocket::TcpWriteonly(socket) | BunSocket::Tcp(socket) => {
                self.generic_write(socket.get(), bytes)
            }
            BunSocket::None => {
                let global = self.global();
                if self.has_nonnative_backpressure.get() {
                    // we should not invoke JS when we have backpressure is cheaper to keep it queued here
                    let _ = self.write_buffer.with_mut(|wb| wb.write(bytes));
                    global.vm().deprecated_report_extra_memory(bytes.len());
                    return false;
                }
                // fallback to onWrite non-native callback
                let code = match BinaryType::Buffer.to_js(bytes, &self.global()) {
                    Ok(output_value) => {
                        let result = self.call_on_write(output_value);
                        if result.is_number() {
                            result.to_int32()
                        } else {
                            -1
                        }
                    }
                    // VM terminating (or OOM): treat as dropped — the -1 arm queues the
                    // bytes and flags backpressure without entering JS.
                    Err(_) => -1,
                };
                let r = match code {
                    -1 => {
                        // dropped
                        let _ = self.write_buffer.with_mut(|wb| wb.write(bytes));
                        global.vm().deprecated_report_extra_memory(bytes.len());
                        self.has_nonnative_backpressure.set(true);
                        false
                    }
                    0 => {
                        // queued
                        self.has_nonnative_backpressure.set(true);
                        false
                    }
                    _ => {
                        // sended!
                        true
                    }
                };
                return r;
            }
        }
    }

    fn has_backpressure(&self) -> bool {
        self.write_buffer.get().len_u32() > 0 || self.has_nonnative_backpressure.get()
    }

    /// Checks this stream's queue only. Another stream's queue can wait on its own window forever.
    fn must_queue_data(&self, stream: &Stream) -> bool {
        self.has_backpressure() || !stream.queue.get().is_empty()
    }

    /// Whether a write to this session's transport synchronously runs user JS: a JS-backed
    /// socket's onWrite is the user's Duplex, and a socket upgraded from a JS Duplex
    /// (`tls.connect({ socket })`) writes its records through that Duplex.
    fn transport_write_runs_js(&self) -> bool {
        match self.native_socket.get() {
            BunSocket::None => true,
            BunSocket::Tls(s) | BunSocket::TlsWriteonly(s) => s.get().socket.get().write_runs_js(),
            BunSocket::Tcp(s) | BunSocket::TcpWriteonly(s) => s.get().socket.get().write_runs_js(),
        }
    }

    /// A payload borrowed from a JS ArrayBuffer has to be copied before a send whenever JS
    /// can run before the send has consumed it, because that JS can `transfer()` or
    /// `resize()` the buffer: under this session's own transport writes, or when taking the
    /// cork slot first flushes another such session's corked bytes through its transport.
    fn stable_payload<'a>(&self, bytes: &'a [u8]) -> Cow<'a, [u8]> {
        let foreign_cork_runs_js = || match Self::corked() {
            Some(other) if !std::ptr::eq(other, self.as_ctx_ptr()) => {
                CORK_OFFSET.with(|c| c.get()) > 0
                    // SAFETY: CORKED_H2 holds a ref()'d parser until that parser's uncork().
                    && unsafe { (*other).transport_write_runs_js() }
            }
            _ => false,
        };
        if !bytes.is_empty() && (self.transport_write_runs_js() || foreign_cork_runs_js()) {
            Cow::Owned(bytes.to_vec())
        } else {
            Cow::Borrowed(bytes)
        }
    }

    fn uncork(&self) -> usize {
        let Some(corked_ptr) = Self::corked() else {
            return 0;
        };
        if !std::ptr::eq(corked_ptr, self.as_ctx_ptr()) {
            // Another parser owns the cork slot; its own auto_flush /
            // on_native_writable will drain it. Draining it here writes to a
            // foreign fd from inside self's writable callback and tears down
            // the other parser's auto-flush registration. cork()'s
            // force-uncork already handles slot handover when a new owner
            // takes it.
            return 0;
        }
        self.unregister_auto_flush();
        bun_output::scoped_log!(H2FrameParser, "uncork {:p}", corked_ptr);
        // The slot's ref on `self`, released once the corked bytes are written.
        let _slot_ref = Self::set_corked(None);

        // _write can re-enter JS (JS-stream-backed sockets, h2-over-h2 tunnels),
        // so no thread-local borrow may be held across it: move the corked bytes
        // into a taken scratch Vec first.
        let mut data = BATCH_BUFFER.with_borrow_mut(core::mem::take);
        data.clear();
        self.drain_cork_into(&mut data);
        let n = data.len();
        if n != 0 {
            let _ = self._write(&data);
            data.clear();
        }
        BATCH_BUFFER.with_borrow_mut(|b| {
            if b.capacity() == 0 {
                *b = data;
            }
        });
        n
    }

    fn register_auto_flush(&self) {
        if self.auto_flusher.get().registered.get() {
            return;
        }
        self.ref_();
        // R-2: inlined so the path is `&self` + extra `self.ref_()` (matches
        // NodeHTTPResponse f1e506c8). `HasAutoFlusher` is now `&self` too.
        debug_assert!(!self.auto_flusher.get().registered.get());
        self.auto_flusher.get().registered.set(true);
        let ctx = NonNull::new(self.as_ctx_ptr().cast::<c_void>());
        let found_existing = self
            .global_this
            .bun_vm()
            .event_loop_mut()
            .deferred_tasks
            .post_task(ctx, on_auto_flush_trampoline);
        debug_assert!(!found_existing);
    }

    fn unregister_auto_flush(&self) {
        if !self.auto_flusher.get().registered.get() {
            return;
        }
        // A write that drains the buffer must not cancel the deferred tick a pending session
        // error is waiting on; on_auto_flush releases the registration once it has reported it.
        if self.pending_header_compression_error.get() {
            return;
        }
        debug_assert!(self.auto_flusher.get().registered.get());
        let ctx = NonNull::new(self.as_ctx_ptr().cast::<c_void>());
        let removed = self
            .global_this
            .bun_vm()
            .event_loop_mut()
            .deferred_tasks
            .unregister_task(ctx);
        debug_assert!(removed);
        self.auto_flusher.get().registered.set(false);
        self.deref();
    }

    /// A `write_maybe_corked` in `generic_write`/`generic_flush` returned a fatal
    /// errno (< -1: the kernel rejected the send - peer gone). No retry can succeed,
    /// and when the failure is only visible on the write side (a peer reset the read
    /// path has not observed yet - routine on Windows, where the RST completes the
    /// send first), nothing else ever closes the socket: the parser would re-buffer
    /// and wait forever for a drain (observed as the http2 flood tests hanging on the
    /// Windows CI agents). -1 (socket closed/shut down/not writable yet) is NOT
    /// latched: those are routine during setup and teardown and the close path that
    /// produced them owns the lifecycle. Latch the fatal and let the deferred tick
    /// close the transport - the failing write can be deep inside frame emission, so
    /// the close must not run under the caller's stack.
    /// Errno classification lives in `us_socket_write_check_error` (socket.c):
    /// would-block/transient errnos re-arm writable and are never reported
    /// here, known peer-gone errnos are reported immediately, and every other
    /// errno gets a bounded retry window through the same rearm machinery
    /// before it is reported (this is what keeps macOS's racy EPROTOTYPE from
    /// killing healthy sessions). So any `result < -1` that reaches this
    /// function is a send failure the socket layer has already decided cannot
    /// succeed - re-buffering it would wait forever for a writable event that
    /// the socket layer deliberately stopped polling for (observed as an h2
    /// session that never writes again and never errors). Windows fatal codes
    /// arrive as raw negated WSA values and mean the same thing.
    fn is_transport_fatal_write_result(result: i32) -> bool {
        result < -1
    }

    fn note_transport_write_fatal(&self) {
        if !self.transport_write_fatal.get() {
            self.transport_write_fatal.set(true);
            self.register_auto_flush();
        }
    }

    /// Runs from the deferred tick (never under a write): closes the native socket so the
    /// normal socket-close teardown runs (native callback detach, JS 'close', session
    /// destroy) - the same path a peer disconnect takes. Closes WITHOUT detaching: a
    /// close_and_detach here severed the JS wrapper before on_close could dispatch, so
    /// the session saw neither 'error' nor 'close' and callers waiting on the failure
    /// hung (grpc-js against a refused server). Not-yet-established sockets are left
    /// alone entirely - the connect-error path owns their failure delivery.
    fn close_transport_after_fatal_write(&self) {
        match self.native_socket.get() {
            BunSocket::Tls(socket) | BunSocket::TlsWriteonly(socket) => {
                Self::close_socket_for_dead_transport::<true>(socket.get());
            }
            BunSocket::Tcp(socket) | BunSocket::TcpWriteonly(socket) => {
                Self::close_socket_for_dead_transport::<false>(socket.get());
            }
            BunSocket::None => {}
        }
    }

    /// The kernel rejected a send of the session's socket, which closes once what the peer sent before has been read.
    pub(crate) fn has_rejected_send(&self) -> bool {
        if self.transport_write_fatal.get() {
            return true;
        }
        match self.native_socket.get() {
            // The TLS layer sends its records later than `write` returns.
            BunSocket::Tls(socket) | BunSocket::TlsWriteonly(socket) => {
                socket.get().socket.get().rejected_send_error() != 0
            }
            _ => false,
        }
    }

    fn close_socket_for_dead_transport<const SSL: bool>(socket: &crate::socket::NewSocket<SSL>) {
        let handler = socket.socket.get();
        if !handler.is_established() {
            return;
        }
        handler.close(bun_uws::CloseCode::Normal);
    }

    pub(crate) fn on_auto_flush(&self) -> bool {
        let _keepalive = self.keepalive();
        // Flushing can call JS (a JS transport's write, write callbacks, the socket's 'close').
        self.global_this.bun_vm().deferred_task_called_js.set(true);
        if self.transport_write_fatal.get() {
            // The close cancels open streams, so deliver the rest of this frame (its END_STREAM) first.
            if !self.deferred.get().is_empty() {
                return true;
            }
            // Returning `false` makes DeferredTaskQueue::run remove the entry, so only the registration's flag and ref are released here.
            self.auto_flusher.get().registered.set(false);
            self.deref();
            // An empty write buffer here means a later write in the same flush()
            // cycle already drained the bytes the failing send left behind (racy
            // one-off errnos, e.g. macOS EPROTOTYPE) - the transport recovered.
            if self.has_backpressure() {
                // `registered` is already clear, so the detach() this re-enters leaves run()'s map entry alone.
                self.close_transport_after_fatal_write();
            } else {
                self.transport_write_fatal.set(false);
            }
            return false;
        }
        if self.pending_header_compression_error.get() {
            // Keep the pending latch set across dispatch+flush: re-entrant detach() ->
            // uncork()/unregister_auto_flush() must early-return at the guard instead of
            // mutating the task map run() iterates (aliasing UB). Cleared once back here.
            self.dispatch_with_2_extra(
                js::on_error_get_cached,
                JSValue::js_number(ErrorCode::COMPRESSION_ERROR.0 as f64),
                JSValue::js_number(self.engine.last_stream_id.get() as f64),
                JSValue::UNDEFINED,
            );
            let _ = self.flush();
            self.pending_header_compression_error.set(false);
            // Terminal: release the registration's flag+ref so the retained
            // parser ref does not persist. Returning false lets run() drop the
            // map entry it owns.
            if self.auto_flusher.get().registered.get() {
                self.auto_flusher.get().registered.set(false);
                self.deref();
            }
            return false;
        }
        let _ = self.flush();
        // we will unregister ourselves when the buffer is empty
        true
    }

    /// Move the cork buffer's current contents to the front of `out` without flushing
    /// to the socket, so a multi-frame batch carries the already-corked bytes (e.g. the
    /// response HEADERS frame) in the same write.
    fn drain_cork_into(&self, out: &mut Vec<u8>) {
        // CORK_BUFFER is thread-local across every session: only drain bytes we corked.
        // send_data()'s multi-frame path reaches here without having called cork(), and
        // prepending another session's corked frames to this one's batch sends them to
        // the wrong peer. uncork() clears CORKED_H2 before calling this, so None passes.
        if let Some(corked) = Self::corked()
            && !std::ptr::eq(corked, self.as_ctx_ptr())
        {
            return;
        }
        let off = CORK_OFFSET.with(|c| c.get()) as usize;
        if off == 0 {
            return;
        }
        CORK_OFFSET.with(|c| c.set(0));
        CORK_BUFFER.with_borrow(|buf| out.extend_from_slice(&buf[0..off]));
    }

    /// Send the accumulated multi-frame batch in one socket write. No-op when empty.
    fn flush_batch_buffer(&self) {
        // Take the Vecs out of the thread-locals before writing: _write can re-enter JS
        // (JS-stream-backed sockets), and a re-entrant send_data must not hit a borrowed
        // RefCell. The re-entrant call sees an empty batch and flushes independently.
        let mut data = BATCH_BUFFER.with_borrow_mut(core::mem::take);
        let mut segments = BATCH_SEGMENTS.with_borrow_mut(core::mem::take);
        if !segments.is_empty() {
            self.flush_batch_vectored(&data, &segments);
        } else if !data.is_empty() {
            let _ = self._write(&data);
        }
        segments.clear();
        BATCH_SEGMENTS.with_borrow_mut(|sg| {
            if sg.capacity() == 0 {
                *sg = segments;
            }
        });
        data.clear();
        // Don't let one huge response pin its capacity forever.
        const BATCH_CAPACITY_CAP: usize = 1 << 20;
        if data.capacity() > BATCH_CAPACITY_CAP {
            data.shrink_to(BATCH_CAPACITY_CAP);
        }
        BATCH_BUFFER.with_borrow_mut(|b| {
            // Hand the (reused) allocation back unless a re-entrant call repopulated it.
            if b.capacity() == 0 {
                *b = data;
            }
        });
    }

    /// Vectored flush for plain-TCP batches: frame headers from the batch scratch and
    /// payload slices straight from the caller's buffer, one writev. A partial write
    /// copies the unwritten tail into write_buffer, which engages backpressure.
    fn flush_batch_vectored(&self, batch: &[u8], segments: &[BatchSegment]) {
        let mut total: usize = 0;
        let total_written = match self.native_socket.get() {
            BunSocket::Tcp(socket) | BunSocket::TcpWriteonly(socket) => BATCH_IOVECS
                .with_borrow_mut(|iov| {
                    iov.clear();
                    iov.reserve(segments.len());
                    for seg in segments {
                        let (ptr, len) = seg.raw_parts(batch);
                        if len == 0 {
                            continue;
                        }
                        total += len;
                        iov.push(bun_uws_sys::UsIoVec {
                            base: ptr.cast(),
                            len,
                        });
                    }
                    if total == 0 {
                        return 0usize;
                    }
                    let w = socket.get().write_vectored_raw(iov);
                    if w < 0 { 0 } else { w as usize }
                }),
            _ => {
                // Socket changed under us (detach mid-call): degrade to the copy path
                // to preserve order.
                let mut all: Vec<u8> = Vec::new();
                for seg in segments {
                    let (ptr, len) = seg.raw_parts(batch);
                    // SAFETY: Batch ranges were recorded inside `batch`, and Ext slices are
                    // valid for the send_data call duration, which is still running.
                    all.extend_from_slice(unsafe { core::slice::from_raw_parts(ptr, len) });
                }
                let _ = self._write(&all);
                return;
            }
        };
        if total_written < total {
            // Copy the unwritten tail in wire order; write_buffer drains on writable.
            let mut skip = total_written;
            let mut buffered: usize = 0;
            for seg in segments {
                let (ptr, len) = seg.raw_parts(batch);
                if skip >= len {
                    skip -= len;
                    continue;
                }
                // SAFETY: same as the copy path above; skip < len
                let rest = unsafe { core::slice::from_raw_parts(ptr.add(skip), len - skip) };
                skip = 0;
                let _ = self.write_buffer.with_mut(|wb| wb.write(rest));
                buffered += rest.len();
            }
            if buffered > 0 {
                self.global().vm().deprecated_report_extra_memory(buffered);
            }
        }
    }

    /// Flush the cork buffer's current contents without releasing cork state, so a
    /// fill-to-boundary write can keep accumulating the remainder. The corked bytes are
    /// moved out before _write — a socket that closes inside the write runs JS, and no
    /// thread-local borrow may be held across it.
    fn flush_cork_buffer(&self) -> bool {
        let mut data = BATCH_BUFFER.with_borrow_mut(core::mem::take);
        data.clear();
        self.drain_cork_into(&mut data);
        if data.is_empty() {
            BATCH_BUFFER.with_borrow_mut(|b| {
                if b.capacity() == 0 {
                    *b = data;
                }
            });
            return true;
        }
        let ok = self._write(&data);
        data.clear();
        BATCH_BUFFER.with_borrow_mut(|b| {
            if b.capacity() == 0 {
                *b = data;
            }
        });
        ok
    }

    pub(crate) fn write(&self, mut bytes: &[u8]) -> bool {
        bun_output::scoped_log!(H2FrameParser, "write {}", bytes.len());
        if !ENABLE_AUTO_CORK {
            return self._write(bytes);
        }
        self.cork();
        if self.transport_write_runs_js() {
            return self.write_to_js_transport(bytes);
        }
        let mut ok = true;
        loop {
            let off = CORK_OFFSET.with(|c| c.get()) as usize;
            let avail = H2_CORK_BUFFER_SIZE - off;
            if bytes.len() <= avail {
                // Fits: accumulate; the auto-flusher sends it at the end of the tick.
                CORK_OFFSET.with(|c| c.set((off + bytes.len()) as u16));
                CORK_BUFFER.with_borrow_mut(|buf| {
                    buf[off..off + bytes.len()].copy_from_slice(bytes);
                });
                return ok;
            }
            if off == 0 {
                // Nothing corked and the chunk is at least a full record on its own:
                // skip the copy and send it directly.
                return self._write(bytes) && ok;
            }
            // Fill the buffer to the record boundary and flush exactly one full
            // record (on TLS this is one SSL_write producing one max-size record —
            // flushing a partial buffer here would put a tiny record on the wire
            // for every DATA frame whose header was corked ahead of it).
            CORK_BUFFER.with_borrow_mut(|buf| {
                buf[off..H2_CORK_BUFFER_SIZE].copy_from_slice(&bytes[..avail]);
            });
            CORK_OFFSET.with(|c| c.set(H2_CORK_BUFFER_SIZE as u16));
            ok = self.flush_cork_buffer() && ok;
            // A close inside the flush's _write runs JS, which can re-cork a different parser;
            // re-assert ownership before touching the shared cork state again.
            self.cork();
            bytes = &bytes[avail..];
        }
    }

    /// `write()` when `transport_write_runs_js`, e.g. when the bytes reach the wire through the
    /// `onWrite` handler (`socket.write()` on a JS stream). That call runs the transport's
    /// `_write` synchronously, and user code there can serialize another frame (ping(),
    /// settings(), goaway(), request()) or flush before it returns. Bytes are therefore only
    /// handed over where another frame may legally follow: at a frame boundary outside a header
    /// block. A unit that overflows the cork is assembled in the (empty at this point) batch
    /// scratch and written whole once its last chunk arrives; the producers emit those chunks
    /// back to back, so no JS can run while the scratch holds a partial unit, and a frame
    /// serialized re-entrantly corks up behind the unit instead of landing inside it.
    fn write_to_js_transport(&self, bytes: &[u8]) -> bool {
        let mut tracker = self.tx_tracker.get();
        tracker.advance(bytes);
        self.tx_tracker.set(tracker);
        let at_boundary = tracker.at_boundary();
        // A non-empty batch scratch here is the partial unit from this write's earlier chunks
        // (send_data's multi-frame batching never re-enters write()).
        if BATCH_BUFFER.with_borrow(|batch| batch.is_empty()) {
            let off = CORK_OFFSET.with(|c| c.get()) as usize;
            if bytes.len() <= H2_CORK_BUFFER_SIZE - off {
                CORK_OFFSET.with(|c| c.set((off + bytes.len()) as u16));
                CORK_BUFFER.with_borrow_mut(|buf| {
                    buf[off..off + bytes.len()].copy_from_slice(bytes);
                });
                return true;
            }
            if off == 0 && at_boundary {
                // Nothing corked and the chunk is whole frames: send it directly.
                return self._write(bytes);
            }
        }
        BATCH_BUFFER.with_borrow_mut(|batch| {
            if batch.is_empty() {
                // The corked prefix precedes this unit on the wire.
                self.drain_cork_into(batch);
            }
            batch.extend_from_slice(bytes);
        });
        if !at_boundary {
            return true;
        }
        // The unit is complete: hand it over whole. Take the scratch out first, _write
        // re-enters JS and a nested send_data must find the batch empty.
        let mut data = BATCH_BUFFER.with_borrow_mut(core::mem::take);
        let ok = self._write(&data);
        data.clear();
        const BATCH_CAPACITY_CAP: usize = 1 << 20;
        if data.capacity() > BATCH_CAPACITY_CAP {
            data.shrink_to(BATCH_CAPACITY_CAP);
        }
        BATCH_BUFFER.with_borrow_mut(|b| {
            if b.capacity() == 0 {
                *b = data;
            }
        });
        ok
    }
}

/// Trait to abstract over TLSSocket / TCPSocket for `generic_flush`/`generic_write`.
pub(crate) trait NativeSocketWrite {
    fn write_maybe_corked(&mut self, buf: &[u8]) -> i32;
}
impl NativeSocketWrite for &TLSSocket {
    fn write_maybe_corked(&mut self, buf: &[u8]) -> i32 {
        // Forward to the inherent NewSocket<true>::write_maybe_corked (R-2: now
        // takes `&self`). UFCS to avoid resolving back to this trait impl.
        // No fatal latch: its close would drop what the peer sent before; the TLS layer closes after reading it.
        TLSSocket::write_maybe_corked(*self, buf).max(-1)
    }
}
impl NativeSocketWrite for &TCPSocket {
    fn write_maybe_corked(&mut self, buf: &[u8]) -> i32 {
        TCPSocket::write_maybe_corked(*self, buf)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// R-2: `HasAutoFlusher` (which requires `fn auto_flusher(&mut self)`) is no
// longer implemented here — the deferred-task registration is inlined in
// `register_auto_flush` / `unregister_auto_flush` so the whole path is `&self`.
// The `DeferredRepeatingTask` trampoline that the trait would have generated.
// Body discharges its own preconditions; a safe `extern "C" fn` coerces to the
// `DeferredRepeatingTask` pointer at `post_task` (matches NodeHTTPResponse.rs).
// ──────────────────────────────────────────────────────────────────────────
extern "C" fn on_auto_flush_trampoline(ctx: *mut c_void) -> bool {
    // SAFETY: `ctx` is the `*const H2FrameParser` registered by
    // `register_auto_flush`; `DeferredTaskQueue::run` feeds it back unchanged
    // on the JS thread. `on_auto_flush` takes `&self`.
    unsafe { (*(ctx.cast_const().cast::<H2FrameParser>())).on_auto_flush() }
}

// (`JsValueArrayPush` / `VmReportExtraMemory` shims removed —
// `bun_jsc::JSValue::push` and `bun_jsc::VM::deprecated_report_extra_memory`
// are inherent methods now.)

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — stream bookkeeping and engine Sink helpers
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    /// A frame callback's JS value that could not be built (allocation
    /// failure, a terminating VM): the frame is dropped and the engine stops
    /// dispatching this batch; the exception stays pending for `read()` /
    /// `on_native_read` (see `Sink::should_stop`).
    #[inline]
    fn or_stop<T>(&self, built: JsResult<T>) -> Option<T> {
        match built {
            Ok(v) => Some(v),
            Err(_) => {
                self.left_exception.set(true);
                None
            }
        }
    }

    /// Whether `dispatch*(event, ..)` reaches JS: the wrapper, its context and the handler exist.
    fn can_dispatch(&self, event: GetCached) -> bool {
        self.strong_this.get().try_get().is_some_and(|this_value| {
            js::context_get_cached(this_value).is_some() && event(this_value).is_some()
        })
    }

    /// https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L1665-L1689
    fn latin1_to_js(&self, payload: &[u8]) -> JsResult<JSValue> {
        let global = self.global();
        bun_core::String::clone_latin1(payload).into_js(&global)
    }

    /// Calls `streamStart` for a new table entry and keeps the JS stream it returns.
    fn announce_stream(&self, stream: &Stream) {
        let Some(this_value) = self.strong_this.get().try_get() else {
            return;
        };
        let Some(ctx_value) = js::context_get_cached(this_value) else {
            return;
        };
        let Some(callback) = js::on_stream_start_get_cached(this_value) else {
            return;
        };
        let global = self.global();
        if global.has_exception() {
            return;
        }
        // Called bare, without a scope of its own, so there's no checkpoint per stream. A throw is reported and yields no JS stream.
        let returned = match callback.call(
            &global,
            ctx_value,
            &[ctx_value, JSValue::js_number(stream.id as f64)],
        ) {
            Ok(v) => v,
            Err(err) => {
                crate::dispatch::fold(Err(err));
                JSValue::ZERO
            }
        };
        // Not if the callback closed the stream, which would pin the dead JS stream.
        if returned.is_object() && !stream.is_closed() {
            stream.set_context(returned, &global);
        }
    }
}

impl H2FrameParser {
    /// What a handler gets as the stream with this id.
    fn stream_context(&self, stream_id: u32) -> JSValue {
        self.engine
            .streams
            .get(stream_id)
            .map_or(JSValue::UNDEFINED, |stream| stream.context())
    }

    /// Empties the scratch of decoded fields. A large block doesn't keep its size for the life of the session.
    fn reset_header_scratch(&self) {
        self.hdr_block.with_mut(|block| {
            if block.capacity() > MAX_BUFFER_SIZE as usize {
                *block = Vec::new();
            }
            block.clear();
        });
        self.hdr_meta.with_mut(|meta| meta.clear());
    }

    /// Runs at the start of a read, before any frame of it is parsed.
    fn begin_batch(&self) {
        // Only a drained transport resets the count.
        if !self.has_unsent_output() {
            self.engine.note_outbound_drained();
        }
        self.engine.streams.begin_read();
    }

    /// Feeds inbound bytes to the engine and keeps what follows the last complete frame for the next read.
    fn receive(&self, bytes: &[u8]) {
        if self.draining.get() != Draining::No {
            return;
        }
        // A JS transport can push bytes back while receive() is on the stack. The running batch picks them up.
        if self.receiving.get() {
            self.inbound_tail.with_mut(|t| t.extend_from_slice(bytes));
            return;
        }
        // `inbound_tail` is either an incomplete frame or the bytes an outer batch parked before running callbacks.
        let mut owned: Vec<u8> = self.inbound_tail.take();
        let mut pos = self.inbound_tail_pos.replace(0).min(owned.len());
        // Parse the read in place when nothing is parked. It's only copied if a frame yields with bytes left behind it.
        let mut direct = owned.is_empty();
        if !direct {
            owned.extend_from_slice(bytes);
        }
        self.begin_batch();
        loop {
            let feed = {
                let input: &[u8] = if direct { &bytes[pos..] } else { &owned[pos..] };
                // The engine still calls some JS directly (streamStart, a JS transport's onWrite). Don't end it in a checkpoint.
                let vm = self.global_this.bun_vm();
                let _no_checkpoint = vm.enter_event_loop_scope_without_checkpoint();
                let _receiving = FlagGuard::set(&self.receiving);
                self.engine.receive(self, input)
            };
            pos += feed.consumed;
            // Bytes a JS transport pushed back during receive() follow the current input.
            let pushed = self.inbound_tail.take();
            if !pushed.is_empty() {
                if direct {
                    owned.extend_from_slice(&bytes[pos..]);
                    direct = false;
                    pos = 0;
                }
                owned.extend_from_slice(&pushed);
            }
            if feed.end == FeedEnd::Fatal {
                // GOAWAY is on the wire and on_error tears the session down, so the rest is never parsed.
                self.run_deferred();
                break;
            }
            if feed.end == FeedEnd::Drained && !pushed.is_empty() {
                // The pushed bytes may complete a frame.
                continue;
            }
            let stopped = self.left_exception.get() || self.draining.get() != Draining::No;
            if feed.end == FeedEnd::Drained || stopped {
                // The engine parsed every complete frame or has to stop. Keep the rest for the next read.
                self.inbound_tail.set(if direct {
                    bytes[pos..].to_vec()
                } else {
                    unparsed_rest(owned, pos)
                });
                self.run_deferred();
                break;
            }
            // Park the rest first. A callback that spins the event loop reads this socket again and continues from here.
            if direct {
                owned.extend_from_slice(&bytes[pos..]);
                direct = false;
                pos = 0;
            }
            self.inbound_tail.set(owned);
            self.inbound_tail_pos.set(pos);
            self.run_deferred();
            // Call receive() again even if nothing is left. Only a call that doesn't yield replenishes the windows.
            owned = self.inbound_tail.take();
            pos = self.inbound_tail_pos.replace(0).min(owned.len());
        }
        self.engine.streams.end_read();
        // Uncork: flush the engine's queued control/response frames to the socket.
        let _ = self.flush();
    }
}

impl Sink for H2FrameParser {
    /// Returns true if the last frame queued callbacks, left an exception for `read()` / `on_native_read`, or detached the parser.
    #[inline]
    fn should_stop(&self) -> bool {
        self.left_exception.get()
            || self.draining.get() != Draining::No
            || !self.deferred.get().is_empty()
    }

    fn write_frame(
        &self,
        frame_type: FrameType,
        frame_flags: u8,
        stream_id: u32,
        payload: &[&[u8]],
    ) -> bool {
        self.frames_sent.set(self.frames_sent.get() + 1);
        let length: usize = payload.iter().map(|part| part.len()).sum();
        let mut sent =
            self.write(&FrameHeader::new(frame_type, frame_flags, stream_id, length).to_bytes());
        for part in payload {
            if !part.is_empty() {
                sent = self.write(part);
            }
        }
        sent
    }

    fn on_error(&self, lib_error_code: i32, debug: &[u8]) {
        // The engine detected a connection error and already wrote the GOAWAY: surface it to JS
        // as the negative nghttp2-style library error code (the JS handler builds node's
        // NghttpError from it: code ERR_HTTP2_ERROR, message nghttp2_strerror), then the end
        // callback so the session tears itself down and closes the socket.
        let g = self.global();
        let Some(chunk) = self.or_stop(BinaryType::Buffer.to_js(debug, &g)) else {
            return;
        };
        if lib_error_code != 0 {
            self.dispatch_with_2_extra(
                js::on_error_get_cached,
                JSValue::js_number(lib_error_code as f64),
                JSValue::js_number(self.engine.last_stream_id.get() as f64),
                chunk,
            );
        }
        self.dispatch_with_extra(
            js::on_end_get_cached,
            JSValue::js_number(self.engine.last_stream_id.get() as f64),
            chunk,
        );
    }

    fn on_too_many_invalid_frames(&self) {
        // The peer exceeded maxSessionInvalidFrames: surface a session error. The JS error handler
        // recognizes the string code and destroys the session with ERR_HTTP2_TOO_MANY_INVALID_FRAMES.
        if !self.can_dispatch(js::on_error_get_cached) {
            return;
        }
        let global = self.global();
        let Some(code_js) = self
            .or_stop(bun_core::String::static_("ERR_HTTP2_TOO_MANY_INVALID_FRAMES").to_js(&global))
        else {
            return;
        };
        self.dispatch_with_2_extra(
            js::on_error_get_cached,
            code_js,
            JSValue::js_number(self.engine.last_stream_id.get() as f64),
            JSValue::UNDEFINED,
        );
    }

    fn on_local_settings(&self, settings: &Settings) {
        let g = self.global();
        let js = settings_to_js(settings, &g);
        // node exposes the custom settings this side submitted on localSettings.customSettings.
        if !self.custom_settings.get().is_empty() {
            let custom = JSValue::create_empty_object(&g, self.custom_settings.get().len());
            for (id, value) in self.custom_settings.get().iter() {
                // Left pending: the engine stops before the next frame
                // (`Sink::should_stop`) and `read()`/`on_native_read` return it.
                let put = custom.put_index(&g, u32::from(*id), JSValue::js_number(*value as f64));
                let Some(()) = self.or_stop(put) else {
                    return;
                };
            }
            js.put(&g, b"customSettings".as_slice(), custom);
        }
        self.dispatch(js::on_local_settings_get_cached, js);
    }

    fn on_remote_custom_setting(&self, id: u16, value: u32) {
        // Only ids the user listed in remoteCustomSettings are surfaced (node semantics).
        if !self.remote_custom_settings_filter.get().contains(&id) {
            return;
        }
        self.remote_custom_settings.with_mut(|v| {
            if let Some(entry) = v.iter_mut().find(|(eid, _)| *eid == id) {
                entry.1 = value;
            } else {
                v.push((id, value));
            }
        });
    }

    fn on_remote_settings(&self, settings: &Settings) {
        let g = self.global();
        let js = settings_to_js(settings, &g);
        // Custom setting ids the user asked to track (remoteCustomSettings) and that the peer has
        // sent are surfaced on remoteSettings.customSettings (node semantics).
        if !self.remote_custom_settings.get().is_empty() {
            let custom = JSValue::create_empty_object(&g, self.remote_custom_settings.get().len());
            for (id, value) in self.remote_custom_settings.get().iter() {
                // Left pending: the engine stops before the next frame
                // (`Sink::should_stop`) and `read()`/`on_native_read` return it.
                let put = custom.put_index(&g, u32::from(*id), JSValue::js_number(*value as f64));
                let Some(()) = self.or_stop(put) else {
                    return;
                };
            }
            js.put(&g, b"customSettings".as_slice(), custom);
        }
        self.dispatch(js::on_remote_settings_get_cached, js);
    }

    fn on_ping(&self, payload: &[u8], is_ack: bool) {
        if is_ack {
            // node (Http2Session::HandlePingFrame): a PING ACK with no outstanding ping is
            // unsolicited and treated as a connection error (NGHTTP2_ERR_PROTO -> NghttpError
            // "Protocol error"); the JS error handler destroys the session.
            if self.out_standing_pings.get() == 0 {
                let g = self.global();
                let Some(chunk) =
                    self.or_stop(BinaryType::Buffer.to_js(b"unsolicited PING ACK", &g))
                else {
                    return;
                };
                self.dispatch_with_2_extra(
                    js::on_error_get_cached,
                    JSValue::js_number(lib_error::PROTO as f64),
                    JSValue::js_number(self.engine.last_stream_id.get() as f64),
                    chunk,
                );
                return;
            }
            self.out_standing_pings
                .set(self.out_standing_pings.get().saturating_sub(1));
        }
        let g = self.global();
        let Some(buffer) = self.or_stop(BinaryType::Buffer.to_js(payload, &g)) else {
            return;
        };
        self.dispatch_with_extra(js::on_ping_get_cached, buffer, JSValue::from(is_ack));
    }

    fn on_go_away(&self, code: u32, last: u32, debug: &[u8]) {
        let g = self.global();
        let Some(chunk) = self.or_stop(BinaryType::Buffer.to_js(debug, &g)) else {
            return;
        };
        self.dispatch_with_2_extra(
            js::on_go_away_get_cached,
            JSValue::js_number(code as f64),
            JSValue::js_number(last as f64),
            chunk,
        );
    }

    fn on_send_window_increased(&self) {
        let _ = self.flush();
    }

    fn on_altsvc(&self, stream_id: u32, origin: &[u8], value: &[u8]) {
        if !self.can_dispatch(js::on_alt_svc_get_cached) {
            return;
        }
        let Some(origin_js) = self.or_stop(self.latin1_to_js(origin)) else {
            return;
        };
        let Some(value_js) = self.or_stop(self.latin1_to_js(value)) else {
            return;
        };
        self.dispatch_with_2_extra(
            js::on_alt_svc_get_cached,
            origin_js,
            value_js,
            JSValue::js_number(stream_id as f64),
        );
    }

    fn buffered_output(&self) -> usize {
        self.write_buffer.get().len_u32() as usize + self.queued_data_size.get() as usize
    }

    fn on_push_promise(&self, _parent_id: u32, promised_id: u32) {
        // The promised request headers follow via on_header/on_headers_complete for promised_id;
        // remember it so that completion dispatches onStreamPush instead of onStreamHeaders.
        self.pending_push.set(promised_id);
    }

    fn on_origin(&self, payload: &[u8]) {
        // One origin is passed as a string, several as an array.
        if !self.can_dispatch(js::on_origin_get_cached) {
            return;
        }
        let g = self.global();
        let mut origin_value = JSValue::UNDEFINED;
        let mut count: u32 = 0;
        let mut rest = payload;
        while rest.len() >= 2 {
            let len = u16::from_be_bytes([rest[0], rest[1]]) as usize;
            if 2 + len > rest.len() {
                break;
            }
            let origin = &rest[2..2 + len];
            let Some(origin_js) = self.or_stop(self.latin1_to_js(origin)) else {
                return;
            };
            if count == 0 {
                origin_value = origin_js;
                origin_value.ensure_still_alive();
            } else if count == 1 {
                let Some(array) = self.or_stop(JSValue::create_empty_array(&g, 0)) else {
                    return;
                };
                array.ensure_still_alive();
                let Some(()) = self.or_stop(
                    array
                        .push(&g, origin_value)
                        .and_then(|()| array.push(&g, origin_js)),
                ) else {
                    return;
                };
                origin_value = array;
            } else {
                let Some(()) = self.or_stop(origin_value.push(&g, origin_js)) else {
                    return;
                };
            }
            count += 1;
            rest = &rest[2 + len..];
        }
        if count == 0 {
            return;
        }
        self.dispatch(js::on_origin_get_cached, origin_value);
    }

    fn on_stream_open(&self, stream: &Stream) {
        self.announce_stream(stream);
    }

    fn on_headers_refused(&self) {
        self.reset_header_scratch();
        // The next HEADERS must not be taken for this block's PUSH_PROMISE.
        self.pending_push.set(0);
    }

    fn on_header(&self, _stream_id: u32, name: &[u8], value: &[u8], never_index: bool) {
        // Accumulate raw bytes; the whole block is materialized into JS values in one
        // native call at on_headers_complete (see H2HeadersMaterializer.cpp).
        self.hdr_block.with_mut(|b| {
            b.extend_from_slice(name);
            b.extend_from_slice(value);
        });
        self.hdr_meta.with_mut(|m| {
            let mut packed_name_len = name.len() as u32;
            if never_index {
                packed_name_len |= 0x8000_0000;
            }
            m.push(packed_name_len);
            m.push(value.len() as u32);
        });
    }

    fn on_headers_complete(&self, stream_id: u32, flags: u8) {
        // Materialize the accumulated block in a single native pass: the raw array, the
        // node-shaped headers object, and the sensitive list (a zero-field block yields an
        // empty array + object, matching the legacy decoder's upfront array).
        let g = self.global();
        let tuple = self.hdr_block.with_mut(|block| {
            self.hdr_meta.with_mut(|meta| {
                let field_count = meta.len() / 2;
                // `call_zero_is_throw` performs the exception-presence check the JSC
                // validator requires at this FFI boundary (zero return == throw).
                // SAFETY: block/meta are live Vec borrows for the call duration; the
                // returned tuple is rooted by the conservative stack scan until
                // dispatched below.
                bun_jsc::call_zero_is_throw(&g, || unsafe {
                    Bun__h2__materializeHeaders(&g, block.as_ptr(), meta.as_ptr(), field_count)
                })
            })
        });
        self.reset_header_scratch();
        let Some(tuple) = self.or_stop(tuple) else {
            return;
        };
        if self.pending_push.get() == stream_id && stream_id != 0 {
            // A PUSH_PROMISE header block: surface the promised request to JS as a pushed stream.
            self.pending_push.set(0);
            self.dispatch_with_2_extra(
                js::on_stream_push_get_cached,
                JSValue::js_number(stream_id as f64),
                tuple,
                JSValue::js_number(flags as f64),
            );
        } else {
            self.dispatch_event(
                js::on_stream_headers_get_cached,
                Target::Stream(stream_id),
                &[tuple, JSValue::js_number(flags as f64)],
            );
        }
    }

    fn on_data(&self, stream_id: u32, data: &[u8]) {
        let g = self.global();
        let Some(chunk) = self.or_stop(BinaryType::Buffer.to_js(data, &g)) else {
            return;
        };
        self.dispatch_event(
            js::on_stream_data_get_cached,
            Target::Stream(stream_id),
            &[chunk],
        );
    }

    fn on_stream_end(&self, stream: &Rc<Stream>) {
        if self.receiving.get() {
            self.deferred
                .with_mut(|q| q.push_back(Deferred::StreamEnd(Rc::clone(stream))));
            return;
        }
        self.stream_end_now(stream);
    }

    fn on_stream_rejected(&self) {
        self.rejected_streams.set(self.rejected_streams.get() + 1);
        if self.max_rejected_streams.get() <= self.rejected_streams.get() {
            self.send_go_away(
                ErrorCode::ENHANCE_YOUR_CALM,
                b"ENHANCE_YOUR_CALM",
                self.engine.last_stream_id.get(),
                true,
            );
        }
    }

    fn on_stream_reset(&self, stream: &Rc<Stream>, code: u32) {
        if self.receiving.get() {
            let stream = Rc::clone(stream);
            self.deferred
                .with_mut(|q| q.push_back(Deferred::StreamReset { stream, code }));
            return;
        }
        self.stream_reset_now(stream, code);
    }
}

impl H2FrameParser {
    fn stream_end_now(&self, stream: &Stream) {
        // JS reset the stream in a callback of the frame that ended it.
        if stream.is_closed() {
            return;
        }
        let _ = self
            .engine
            .streams
            .apply(stream, StreamEvent::RecvEndStream);
        let state = stream.state();
        self.dispatch_with_extra(
            js::on_stream_end_get_cached,
            stream.context(),
            JSValue::js_number(state as u8 as f64),
        );
        if state == State::Closed {
            stream.close_delivered.set(true);
            self.drop_queued_data(stream);
        }
    }

    fn stream_reset_now(&self, stream: &Stream, code: u32) {
        if code == ErrorCode::CANCEL.0 {
            // Like node, a peer's CANCEL is 'aborted' and a close with rstCode 8, not an 'error'.
            self.dispatch_with_extra(
                js::on_aborted_get_cached,
                stream.context(),
                JSValue::UNDEFINED,
            );
        } else {
            self.dispatch_with_extra(
                js::on_stream_error_get_cached,
                stream.context(),
                JSValue::js_number(code as f64),
            );
        }
        stream.close_delivered.set(true);
        self.drop_queued_data(stream);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — JS host fns (part 1)
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    /// Reads the settings of a `settings()` call or of the session's options. JS has validated them (`validateSettings`).
    fn load_settings_from_js_value(
        &self,
        global_object: &JSGlobalObject,
        options: JSValue,
    ) -> JsResult<()> {
        let mut local_settings = self.engine.local_settings.get();
        // Like node's updateSettingsBuffer, a SETTINGS frame only has the entries of this call. `local_settings` accumulates.
        let mut explicit_settings: u8 = 0;

        macro_rules! number_setting {
            ($key:literal, $field:ident, $bit:expr) => {{
                if let Some(v) = options.get(global_object, $key)?
                    && v.is_number()
                {
                    local_settings.$field = v.as_number() as u32;
                    explicit_settings |= $bit;
                }
            }};
        }
        macro_rules! bool_setting {
            ($key:literal, $field:ident, $bit:expr) => {{
                if let Some(v) = options.get(global_object, $key)?
                    && v.is_boolean()
                {
                    local_settings.$field = v.as_boolean();
                    explicit_settings |= $bit;
                }
            }};
        }
        number_setting!(
            "headerTableSize",
            header_table_size,
            SETTING_BIT_HEADER_TABLE_SIZE
        );
        bool_setting!("enablePush", enable_push, SETTING_BIT_ENABLE_PUSH);
        number_setting!(
            "initialWindowSize",
            initial_window_size,
            SETTING_BIT_INITIAL_WINDOW_SIZE
        );
        number_setting!("maxFrameSize", max_frame_size, SETTING_BIT_MAX_FRAME_SIZE);
        number_setting!(
            "maxConcurrentStreams",
            max_concurrent_streams,
            SETTING_BIT_MAX_CONCURRENT_STREAMS
        );
        number_setting!(
            "maxHeaderListSize",
            max_header_list_size,
            SETTING_BIT_MAX_HEADER_LIST_SIZE
        );
        number_setting!(
            "maxHeaderSize",
            max_header_list_size,
            SETTING_BIT_MAX_HEADER_LIST_SIZE
        );
        bool_setting!(
            "enableConnectProtocol",
            enable_connect_protocol,
            SETTING_BIT_ENABLE_CONNECT_PROTOCOL
        );

        // Staged, so that a getter that throws below leaves nothing half installed.
        let mut staged_custom: Vec<(u16, u32)> = Vec::new();
        if let Some(custom_settings) = options.get(global_object, "customSettings")?
            && let Some(custom_settings) = custom_settings.get_object()
        {
            let iter = bun_jsc::JSPropertyIterator::init(
                global_object,
                custom_settings,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                    ..Default::default()
                },
            )?;
            while let Some((id, value)) = iter.next()? {
                if let Ok(id) = bun_core::parse_int::<u16>(id.to_utf8().slice(), 10)
                    && value.is_number()
                {
                    staged_custom.push((id, value.as_number() as u32));
                }
            }
        }

        // remoteCustomSettings (session option, not a SETTINGS parameter): non-standard setting
        // ids whose received values should be exposed on remoteSettings.customSettings. Staged
        // before any state is committed so a throwing getter / iterator (Proxy/getter on the
        // user array) does not leave the four cells above already installed.
        let mut staged_remote_filter: Vec<u16> = Vec::new();
        if let Some(remote_custom) = options.get(global_object, "remoteCustomSettings")? {
            if remote_custom.is_array() {
                let mut value_iter = remote_custom.array_iterator(global_object)?;
                while let Some(item) = value_iter.next()? {
                    if !item.is_number() {
                        continue;
                    }
                    let id = item.as_number();
                    if !(0.0..=65535.0).contains(&id) {
                        continue;
                    }
                    let id = id as u16;
                    if !staged_remote_filter.contains(&id)
                        && staged_remote_filter.len() < MAX_CUSTOM_SETTINGS
                    {
                        staged_remote_filter.push(id);
                    }
                }
            }
        }

        self.engine.local_settings.set(local_settings);
        self.explicit_settings.set(explicit_settings);
        self.custom_settings.with_mut(|cs| {
            for &(id, value) in &staged_custom {
                if let Some(entry) = cs.iter_mut().find(|(eid, _)| *eid == id) {
                    entry.1 = value;
                } else if cs.len() < MAX_CUSTOM_SETTINGS {
                    cs.push((id, value));
                }
            }
        });
        self.wire_custom_settings.with_mut(|cs| *cs = staged_custom);
        self.remote_custom_settings_filter.with_mut(|f| {
            for id in staged_remote_filter {
                if !f.contains(&id) && f.len() < MAX_CUSTOM_SETTINGS {
                    f.push(id);
                }
            }
        });
        Ok(())
    }

    pub(crate) fn settings(&self, cx: &mut JsScope<'_>, settings: JsLocal<'_>) -> JsResult<()> {
        self.load_settings_from_js_value(cx.global(), settings.to_js())?;
        self.set_settings(self.engine.local_settings.get());
        Ok(())
    }

    pub(crate) fn set_local_window_size(&self, _: &mut JsScope<'_>, window_size_value: u32) {
        self.window_size.set(window_size_value as u64);
        // Only the connection window moves. Stream windows follow SETTINGS_INITIAL_WINDOW_SIZE.
        let advertised = self.engine.recv_window.get().size();
        if i64::from(window_size_value) > advertised {
            let increment = (i64::from(window_size_value) - advertised) as u32;
            update(&self.engine.recv_window, |w| w.grow(i64::from(increment)));
            // Write last. A JS transport can answer with DATA from inside self write.
            self.engine.send_window_update(self, 0, increment);
        }
    }

    pub(crate) fn get_frame_counters(&self, cx: &mut JsScope<'_>) -> JSValue {
        let global_object = cx.global();
        let result = JSValue::create_empty_object(global_object, 2);
        result.put(
            global_object,
            b"framesReceived",
            JSValue::js_number(self.engine.frames_received.get() as f64),
        );
        result.put(
            global_object,
            b"framesSent",
            JSValue::js_number(self.frames_sent.get() as f64),
        );
        result
    }

    pub(crate) fn get_current_state(&self, cx: &mut JsScope<'_>) -> JSValue {
        let global_object = cx.global();
        let result = JSValue::create_empty_object(global_object, 9);
        result.put(
            global_object,
            b"effectiveLocalWindowSize",
            JSValue::js_number(self.window_size.get() as f64),
        );
        result.put(
            global_object,
            b"effectiveRecvDataLength",
            JSValue::js_number(self.window_size.get() as f64),
        );
        result.put(
            global_object,
            b"nextStreamID",
            JSValue::js_number(self.get_next_stream_id() as f64),
        );
        result.put(
            global_object,
            b"lastProcStreamID",
            JSValue::js_number(self.engine.last_stream_id.get() as f64),
        );

        let settings = self.engine.remote_settings.get();
        let remote_iws = settings.initial_window_size;
        let local_hts = self.engine.local_settings.get().header_table_size;
        result.put(
            global_object,
            b"remoteWindowSize",
            JSValue::js_number(remote_iws as f64),
        );
        result.put(
            global_object,
            b"localWindowSize",
            JSValue::js_number(self.engine.recv_window.get().size() as f64),
        );
        result.put(
            global_object,
            b"deflateDynamicTableSize",
            JSValue::js_number(local_hts as f64),
        );
        result.put(
            global_object,
            b"inflateDynamicTableSize",
            JSValue::js_number(local_hts as f64),
        );
        result.put(
            global_object,
            b"outboundQueueSize",
            JSValue::js_number(self.outbound_queue_size.get() as f64),
        );
        result
    }

    pub(crate) fn goaway<'a>(
        &self,
        cx: &mut JsScope<'a>,
        code: u32,
        last_stream_id: i32,
        opaque_data: JsBytes<'a>,
    ) {
        // Copied, because a write to a JS transport runs JavaScript, which can detach the buffer.
        let opaque_data = opaque_data.get(&cx.heap).to_vec();
        // As in node, 0 or less keeps the last processed id: Last-Stream-ID=0 tells the peer to retry every stream.
        let last_stream_id = u32::try_from(last_stream_id)
            .ok()
            .filter(|id| *id > 0)
            .unwrap_or_else(|| self.engine.last_peer_id.get());
        self.send_go_away(ErrorCode(code), &opaque_data, last_stream_id, false);
    }

    /// Like node's Http2Session::AddPing, returns false once maxOutstandingPings are unanswered.
    pub(crate) fn ping<'a>(&self, cx: &mut JsScope<'a>, payload: JsBytes<'a>) -> bool {
        if self.out_standing_pings.get() >= self.max_outstanding_pings.get() {
            return false;
        }
        let payload = payload.get(&cx.heap).to_vec();
        self.send_ping(&payload);
        true
    }

    pub(crate) fn origin(&self, cx: &mut JsScope<'_>, origin: JsLocal<'_>) -> JsResult<()> {
        let global_object = cx.global();
        let origin = origin.to_js();
        // https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L486-L489
        let mut payload = Vec::new();
        let mut push = |item: JSValue| -> JsResult<()> {
            let view = item.to_js_string_view(global_object)?;
            let bytes = header_value_bytes(&view);
            if payload.len() + 2 + bytes.len() > 16384 {
                let exception = global_object.to_type_error(
                    bun_jsc::ErrorCode::HTTP2_ORIGIN_LENGTH,
                    format_args!("HTTP/2 ORIGIN frames are limited to 16382 bytes"),
                );
                return Err(global_object.throw_value(exception));
            }
            payload.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
            payload.extend_from_slice(&bytes);
            Ok(())
        };
        if origin.is_array() {
            let mut origins = origin.array_iterator(global_object)?;
            while let Some(item) = origins.next()? {
                push(item)?;
            }
        } else if origin.is_string() {
            push(origin)?;
        }
        self.write_frame(FrameType::Origin, 0, 0, &[&payload]);
        Ok(())
    }

    pub(crate) fn altsvc(
        &self,
        cx: &mut JsScope<'_>,
        origin: JsLocal<'_>,
        value: JsLocal<'_>,
        stream_id: u32,
    ) -> JsResult<()> {
        let global_object = cx.global();
        let origin_view = origin.to_js().to_js_string_view(global_object)?;
        let value_view = value.to_js().to_js_string_view(global_object)?;
        // https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L3233-L3239
        let origin = header_value_bytes(&origin_view);
        let value = header_value_bytes(&value_view);
        if origin.len() + value.len() > MAX_ALTSVC_LENGTH {
            let exception = global_object.to_type_error(
                bun_jsc::ErrorCode::HTTP2_ALTSVC_LENGTH,
                format_args!("HTTP/2 ALTSVC frames are limited to {MAX_ALTSVC_LENGTH} bytes"),
            );
            return Err(global_object.throw_value(exception));
        }
        if stream_id > 0 {
            // dont error but dont send frame to invalid stream id
            if self.engine.streams.get(stream_id).is_none() {
                return Ok(());
            }
        }
        self.send_alt_svc(stream_id, &origin, &value);
        Ok(())
    }

    pub(crate) fn get_stream_state(&self, cx: &mut JsScope<'_>, stream_id: u32) -> JSValue {
        let global_object = cx.global();
        // A closed stream keeps its entry until its `Http2Stream` is destroyed.
        let Some(stream) = self.engine.streams.get(stream_id) else {
            return JSValue::UNDEFINED;
        };
        let stream_state = stream.state();
        // A reserved stream only has the half that carries the pushed response.
        let local_close = matches!(
            stream_state,
            State::HalfClosedLocal | State::ReservedRemote | State::Closed
        );
        let remote_close = matches!(
            stream_state,
            State::HalfClosedRemote | State::ReservedLocal | State::Closed
        );
        let state = JSValue::create_empty_object(global_object, 6);

        state.put(
            global_object,
            b"localWindowSize",
            JSValue::js_number(stream.recv_window.get().size() as f64),
        );
        state.put(
            global_object,
            b"state",
            JSValue::js_number(stream_state as u8 as f64),
        );
        state.put(
            global_object,
            b"localClose",
            JSValue::js_number(f64::from(u8::from(local_close))),
        );
        state.put(
            global_object,
            b"remoteClose",
            JSValue::js_number(f64::from(u8::from(remote_close))),
        );
        // TODO: sumDependencyWeight
        state.put(
            global_object,
            b"sumDependencyWeight",
            JSValue::js_number(0.0),
        );
        // NGHTTP2_DEFAULT_WEIGHT. Like node, no stream ever gets another weight.
        state.put(global_object, b"weight", JSValue::js_number(16.0));

        state
    }

    /// An id without an entry is closed already, so there's nothing to reset (RFC 9113 §5.1).
    pub(crate) fn rst_stream(&self, _: &mut JsScope<'_>, stream_id: u32, code: u32) {
        if let Some(stream) = self.engine.streams.get(stream_id) {
            self.reset_stream(&stream, ErrorCode(code), true);
        }
    }

    /// JS destroyed the `Http2Stream`. Returns true if the stream is closed, so there's nothing left to reset.
    pub(crate) fn release_stream(&self, stream_id: u32) -> bool {
        self.engine
            .streams
            .get(stream_id)
            .is_none_or(|stream| self.engine.streams.release(&stream))
    }

    pub(crate) fn is_stream_closed(&self, stream_id: u32) -> bool {
        self.engine
            .streams
            .get(stream_id)
            .is_none_or(|stream| stream.is_closed())
    }

    pub(crate) fn has_open_streams(&self) -> bool {
        self.engine.streams.open_local() + self.engine.streams.open_peer() > 0
    }

    pub(crate) fn buffer_size(&self) -> f64 {
        self.buffered_output() as f64
    }

    /// DATA bytes the send windows allow right now, capped at one frame.
    fn sendable_data_size(&self, stream: &Stream) -> usize {
        MAX_PAYLOAD_SIZE_WITHOUT_FRAME
            .min(self.engine.send_window.get().available())
            .min(stream.send_window.get().available())
    }

    /// Returns `(settled_state, callback_deferred)`: the state the close tail settled on (5 =
    /// HALF_CLOSED_LOCAL, 7 = CLOSED, 0 = none) and whether `callback` was left to the caller.
    fn send_data(
        &self,
        stream: &Stream,
        payload: &[u8],
        callback: JSValue,
        options: SendDataOptions,
    ) -> (u8, bool) {
        let SendDataOptions {
            close,
            suppress_half_closed_local_dispatch,
            defer_write_callback,
        } = options;
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_DATA {} sendData({}, {}, {})",
            if self.engine.is_server.get() {
                "server"
            } else {
                "client"
            },
            stream.id,
            payload.len(),
            close
        );

        let stream_id = stream.id;
        let mut enqueued = false;
        let _keepalive = self.keepalive();

        let can_close = close && !stream.wait_for_trailers.get();
        if payload.is_empty() {
            if self.must_queue_data(stream) {
                enqueued = true;
                self.queue_frame(stream, b"", callback, close);
            } else if can_close {
                // Peers count an empty DATA frame without END_STREAM as a flood, so never send one.
                self.write_frame(FrameType::Data, flags::END_STREAM, stream_id, &[]);
            }
        } else {
            let mut offset: usize = 0;

            while offset < payload.len() {
                // max frame size will always be at least 16384 (but we need to respect the flow control)
                let mut max_size = self.sendable_data_size(stream);
                if max_size == 0 {
                    // A synchronous JS transport handles the peer's answer inside this write.
                    self.flush_batch_buffer();
                    if !stream.state().can_send() {
                        self.dispatch_write_callback(callback);
                        return (0, false);
                    }
                    max_size = self.sendable_data_size(stream);
                }
                let mut is_flow_control_limited = false;
                if max_size == 0 {
                    is_flow_control_limited = true;
                    // this will be handled later if cannot send the entire payload in one frame
                    max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME;
                }
                let size = (payload.len() - offset).min(max_size);

                let slice = &payload[offset..size + offset];
                offset += size;
                let end_stream = offset >= payload.len() && can_close;

                if self.must_queue_data(stream) || is_flow_control_limited {
                    // Preserve wire order: anything already batched goes out before the
                    // queued remainder is flushed later by the drain path.
                    self.flush_batch_buffer();
                    enqueued = true;
                    // write the full frame in memory and queue the frame
                    // the callback will only be called after the last frame is sended
                    self.queue_frame(
                        stream,
                        slice,
                        if offset >= payload.len() {
                            callback
                        } else {
                            JSValue::UNDEFINED
                        },
                        offset >= payload.len() && close,
                    );
                } else {
                    let padding = stream.padding_for(size, max_size - 1);
                    let payload_size = size
                        + if padding != 0 {
                            padding as usize + 1
                        } else {
                            0
                        };
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "padding: {} size: {} max_size: {} payload_size: {}",
                        padding,
                        size,
                        max_size,
                        payload_size
                    );
                    self.consume_send_windows(stream, payload_size);
                    let mut flags: u8 = if end_stream { flags::END_STREAM } else { 0 };
                    if padding != 0 {
                        flags |= flags::PADDED;
                    }
                    if payload.len() <= MAX_PAYLOAD_SIZE_WITHOUT_FRAME {
                        // Single-frame payload: the cork coalesces it with neighbors.
                        if padding != 0 {
                            let zeros = &[0u8; 255][..padding as usize];
                            self.write_frame(
                                FrameType::Data,
                                flags,
                                stream_id,
                                &[&[padding], slice, zeros],
                            );
                        } else {
                            self.write_frame(FrameType::Data, flags, stream_id, &[slice]);
                        }
                    } else {
                        // Multi-frame payload: accumulate header + slice in the batch so
                        // the whole write reaches the socket in one syscall (and, on TLS,
                        // far fewer SSL_writes) instead of one flush per frame. Plain TCP
                        // records payload slices by reference and flushes with writev —
                        // TLS cannot vectorize (SSL_write must consume the bytes to seal
                        // records), so it keeps the contiguous copy.
                        let vectorize = matches!(
                            self.native_socket.get(),
                            BunSocket::Tcp(_) | BunSocket::TcpWriteonly(_)
                        ) && !self.has_backpressure();
                        BATCH_BUFFER.with_borrow_mut(|batch| {
                            if batch.is_empty() {
                                batch.reserve(if vectorize {
                                    1024
                                } else {
                                    payload.len()
                                        + (payload.len() / MAX_PAYLOAD_SIZE_WITHOUT_FRAME + 2)
                                            * FRAME_HEADER_SIZE
                                });
                                self.drain_cork_into(batch);
                                if vectorize && !batch.is_empty() {
                                    BATCH_SEGMENTS.with_borrow_mut(|segs| {
                                        segs.push(BatchSegment::Batch {
                                            off: 0,
                                            len: batch.len() as u32,
                                        })
                                    });
                                }
                            }
                            let header_off = batch.len();
                            self.frames_sent.set(self.frames_sent.get() + 1);
                            batch.extend_from_slice(
                                &FrameHeader::new(FrameType::Data, flags, stream_id, payload_size)
                                    .to_bytes(),
                            );
                            if padding != 0 {
                                batch.push(padding);
                                batch.extend_from_slice(slice);
                                batch.resize(batch.len() + payload_size - slice.len() - 1, 0);
                                if vectorize {
                                    BATCH_SEGMENTS.with_borrow_mut(|segs| {
                                        segs.push(BatchSegment::Batch {
                                            off: header_off as u32,
                                            len: (batch.len() - header_off) as u32,
                                        })
                                    });
                                }
                            } else if vectorize {
                                BATCH_SEGMENTS.with_borrow_mut(|segs| {
                                    segs.push(BatchSegment::Batch {
                                        off: header_off as u32,
                                        len: (batch.len() - header_off) as u32,
                                    });
                                    segs.push(BatchSegment::Ext {
                                        ptr: slice.as_ptr(),
                                        len: slice.len() as u32,
                                    });
                                });
                            } else {
                                batch.extend_from_slice(slice);
                            }
                        });
                    }
                }
            }
            self.flush_batch_buffer();
        }

        let mut settled_state: u8 = 0;
        let mut callback_deferred = false;
        if !enqueued {
            if defer_write_callback && callback.is_callable() {
                callback_deferred = true;
            } else {
                self.dispatch_write_callback(callback);
            }
            if close {
                if stream.wait_for_trailers.get() {
                    self.dispatch(js::on_want_trailers_get_cached, stream.context());
                } else {
                    settled_state =
                        self.sent_end_stream(stream, suppress_half_closed_local_dispatch) as u8;
                }
            }
        }
        (settled_state, callback_deferred)
    }

    pub(crate) fn no_trailers(&self, _: &mut JsScope<'_>, stream_id: u32) {
        // JS learns about a native reset on the next tick and can still end the stream until then.
        if let Some(stream) = self.open_stream(stream_id) {
            self.send_no_trailers(&stream);
        }
    }

    fn open_stream(&self, stream_id: u32) -> Option<Rc<Stream>> {
        self.engine
            .streams
            .get(stream_id)
            .filter(|stream| !stream.is_closed())
    }

    fn send_no_trailers(&self, stream: &Stream) {
        stream.wait_for_trailers.set(false);
        let _ = self.send_data(
            stream,
            b"",
            JSValue::UNDEFINED,
            SendDataOptions {
                close: true,
                suppress_half_closed_local_dispatch: false,
                defer_write_callback: false,
            },
        );
    }

    /// setStreamReading(streamId, reading): the JS readable for the stream paused (false) or
    /// resumed (true). While paused the engine stops replenishing the stream's receive window;
    /// on resume the deferred replenishment is sent immediately so a peer stalled on a zero
    /// window is released without waiting for further inbound traffic.
    pub(crate) fn set_stream_reading(&self, _: &mut JsScope<'_>, stream_id: u32, reading: bool) {
        let Some(stream) = self.engine.streams.get(stream_id) else {
            // The stream already finished (or never reached the wire); nothing to backpressure.
            return;
        };
        stream.reading_paused.set(!reading);
        if reading {
            // A batch replenishes at its end. Per frame it would hide a peer that overruns the window.
            if self.engine.streams.is_reading() {
                self.engine.queue_replenish(&stream);
            } else {
                self.engine.replenish_stream(self, &stream);
            }
            let _ = self.flush();
        }
    }

    /// Writes `block` as one HEADERS or PUSH_PROMISE frame plus the CONTINUATION frames it needs (RFC 9113 §4.3). `prefix` is a PUSH_PROMISE's promised stream id.
    fn write_header_block(
        &self,
        frame_type: FrameType,
        frame_flags: u8,
        stream_id: u32,
        prefix: &[u8],
        block: &[u8],
    ) {
        let max_frame_size = self.engine.remote_settings.get().max_frame_size as usize;
        let (first, mut rest) = block.split_at(block.len().min(max_frame_size - prefix.len()));
        let end_headers = |rest: &[u8]| {
            if rest.is_empty() {
                flags::END_HEADERS
            } else {
                0
            }
        };
        self.write_frame(
            frame_type,
            frame_flags | end_headers(rest),
            stream_id,
            &[prefix, first],
        );
        while !rest.is_empty() {
            let (fragment, after) = rest.split_at(rest.len().min(max_frame_size));
            rest = after;
            self.write_frame(
                FrameType::Continuation,
                end_headers(rest),
                stream_id,
                &[fragment],
            );
        }
    }

    /// Throws what `request()` or `pushPromise()` would throw for the names of `headers`, without running a value's toString().
    pub(crate) fn validate_request(
        &self,
        cx: &mut JsScope<'_>,
        headers: JsLocal<'_>,
    ) -> JsResult<()> {
        collect_fields(
            cx.global(),
            headers.to_js(),
            JSValue::UNDEFINED,
            BlockRole::Request,
            self.strict_single_value_fields.get(),
            None,
        )
    }

    pub(crate) fn send_trailers(
        &self,
        cx: &mut JsScope<'_>,
        stream_id: u32,
        headers: JsLocal<'_>,
        sensitive_headers: JsLocal<'_>,
    ) -> JsResult<()> {
        let global_object = cx.global();
        let headers = headers.to_js();
        let sensitive_headers = sensitive_headers.to_js();
        let Some(stream) = self.open_stream(stream_id) else {
            return Ok(());
        };

        let mut scratch = HeaderScratch::take(global_object);
        collect_fields(
            global_object,
            headers,
            sensitive_headers,
            BlockRole::Trailers,
            self.strict_single_value_fields.get(),
            Some(&mut scratch.block),
        )?;

        // node submits an empty END_STREAM DATA frame when the trailers have no fields.
        if scratch.block.is_empty() {
            self.send_no_trailers(&stream);
            return Ok(());
        }

        let encoded = if self.is_over_send_limit(&scratch.block) {
            Err(crate::Error::UnableToEncode)
        } else {
            self.encode_header_list(&mut scratch)
        };
        match encoded {
            Ok(()) => {}
            Err(crate::Error::Alloc(bun_alloc::AllocError)) => {
                return Err(global_object.throw(format_args!("Failed to allocate header buffer")));
            }
            Err(_) => {
                // node: 'frameError' + ERR_HTTP2_STREAM_ERROR (test-http2-exceeds-server-trailer-size.js).
                self.dispatch_with_2_extra(
                    js::on_frame_error_get_cached,
                    stream.context(),
                    JSValue::js_number(FrameType::Headers as u8 as f64),
                    JSValue::js_number(ErrorCode::FRAME_SIZE_ERROR.0 as f64),
                );
                self.reset_stream(&stream, ErrorCode::FRAME_SIZE_ERROR, true);
                return Ok(());
            }
        }
        self.write_header_block(
            FrameType::Headers,
            flags::END_STREAM,
            stream.id,
            b"",
            &scratch.encoded,
        );
        self.sent_end_stream(&stream, false);
        Ok(())
    }

    pub(crate) fn write_stream(
        &self,
        cx: &mut JsScope<'_>,
        stream_id: u32,
        data: JsLocal<'_>,
        encoding: JsLocal<'_>,
        close: bool,
        callback: JsLocal<'_>,
        defer_write_callback: bool,
    ) -> JsResult<JSValue> {
        let global_object = cx.global();
        let data = data.to_js();
        let encoding = encoding.to_js();
        let callback = callback.to_js();

        let Some(stream) = self
            .engine
            .streams
            .get(stream_id)
            .filter(|stream| stream.state().can_send())
        else {
            self.dispatch_write_callback(callback);
            return Ok(JSValue::FALSE);
        };

        let encoding: Encoding = 'brk: {
            if encoding.is_undefined() {
                break 'brk Encoding::Utf8;
            }
            if !encoding.is_string() {
                return Err(global_object.throw_invalid_argument_type_value(
                    b"write",
                    b"encoding",
                    encoding,
                ));
            }
            match Encoding::from_js(encoding, global_object)? {
                Some(e) => break 'brk e,
                None => {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"write",
                        b"encoding",
                        encoding,
                    ));
                }
            }
        };

        let buffer = match StringOrBuffer::from_js_with_encoding(global_object, data, encoding)? {
            Some(b) => b,
            None => {
                return Err(global_object.throw_invalid_argument_type_value(
                    b"write",
                    b"Buffer or String",
                    data,
                ));
            }
        };

        let payload = self.stable_payload(buffer.slice());
        let (settled_state, callback_deferred) = self.send_data(
            &stream,
            &payload,
            callback,
            SendDataOptions {
                close,
                suppress_half_closed_local_dispatch: true,
                defer_write_callback,
            },
        );

        // 5 = HALF_CLOSED_LOCAL: the JS caller runs markWritableDone itself instead of
        // the engine re-entering the VM with an onStreamEnd(5) dispatch.
        // WRITE_FLUSHED_WITHOUT_CALLBACK: the data was handed to the socket synchronously and
        // the write callback was not (and will not be) invoked by the engine; the JS caller
        // completes the Writable callback asynchronously.
        let mut result = settled_state as u32;
        if callback_deferred {
            result |= WRITE_FLUSHED_WITHOUT_CALLBACK;
        }
        Ok(JSValue::js_number(result as f64))
    }

    /// `set_next_stream_id` can park `last_stream_id` anywhere in the u32 range, so the step
    /// saturates; callers that open the stream reject anything above `MAX_STREAM_ID`.
    fn get_next_stream_id(&self) -> u32 {
        let stream_id = self.engine.last_stream_id.get();
        if self.engine.is_server.get() {
            if stream_id.is_multiple_of(2) {
                stream_id.saturating_add(2)
            } else {
                stream_id.saturating_add(1)
            }
        } else if stream_id.is_multiple_of(2) {
            stream_id.saturating_add(1)
        } else {
            stream_id.saturating_add(2)
        }
    }

    pub(crate) fn set_next_stream_id(&self, _: &mut JsScope<'_>, next_stream_id: u32) {
        // Store the id `get_next_stream_id` steps from. 0, and 1 on a client, have no predecessor, so the subtraction saturates.
        let last_stream_id = if self.engine.is_server.get() {
            if next_stream_id.is_multiple_of(2) {
                next_stream_id.saturating_sub(2)
            } else {
                next_stream_id.saturating_sub(1)
            }
        } else if next_stream_id.is_multiple_of(2) {
            next_stream_id.saturating_sub(1)
        } else {
            next_stream_id.saturating_sub(2)
        };
        self.engine.last_stream_id.set(last_stream_id);
    }

    pub(crate) fn get_next_stream(&self, _: &mut JsScope<'_>) -> i32 {
        let id = self.get_next_stream_id();
        if id > MAX_STREAM_ID {
            return -1;
        }
        // RFC 9113 §5.1.2. Like node, a server's pushes aren't held to the client's limit.
        if !self.engine.is_server.get()
            && self.engine.streams.open_local()
                >= self.engine.remote_settings.get().max_concurrent_streams
        {
            return 0;
        }
        self.engine.last_stream_id.set(id);
        let stream = self.engine.insert_stream(id, State::Idle);
        self.announce_stream(&stream);
        id as i32
    }

    /// Server-side: send a PUSH_PROMISE frame on `parentId` announcing `promisedId` + the promised
    /// request headers (RFC 9113 §6.6 / §8.4). The promised (even) stream is allocated by the JS
    /// layer via getNextStream; the server then responds on it with the normal request() path.
    pub(crate) fn push_promise(
        &self,
        cx: &mut JsScope<'_>,
        parent_id: u32,
        promised_id: u32,
        headers: JsLocal<'_>,
        sensitive_headers: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global_object = cx.global();
        let headers = headers.to_js();
        let sensitive_headers = sensitive_headers.to_js();
        let mut scratch = HeaderScratch::take(global_object);
        collect_fields(
            global_object,
            headers,
            sensitive_headers,
            BlockRole::Request,
            self.strict_single_value_fields.get(),
            Some(&mut scratch.block),
        )?;

        match self.encode_header_list(&mut scratch) {
            Ok(()) => {}
            Err(crate::Error::Alloc(bun_alloc::AllocError)) => {
                return Err(global_object.throw(format_args!("Failed to allocate header buffer")));
            }
            Err(_) => {
                // node never surfaces self through the pushStream callback.
                self.schedule_header_compression_session_error();
                return Ok(JSValue::js_number(-1.0));
            }
        }
        if let Some(promised) = self.engine.streams.get(promised_id) {
            let _ = self
                .engine
                .streams
                .apply(&promised, StreamEvent::SendPushPromise);
        }
        self.write_header_block(
            FrameType::PushPromise,
            0,
            parent_id,
            &(promised_id & MAX_STREAM_ID).to_be_bytes(),
            &scratch.encoded,
        );

        let _ = self.flush();
        Ok(JSValue::js_number(promised_id as f64))
    }

    pub(crate) fn get_stream_context(&self, _: &mut JsScope<'_>, stream_id: u32) -> JSValue {
        self.engine
            .streams
            .get(stream_id)
            .and_then(|stream| stream.js_context.get().get())
            .unwrap_or(JSValue::UNDEFINED)
    }

    /// `undefined` closes a pushed stream whose PUSH_PROMISE never left. It was never on the wire, so no reset is sent.
    pub(crate) fn set_stream_context(
        &self,
        cx: &mut JsScope<'_>,
        stream_id: u32,
        context: JsLocal<'_>,
    ) {
        let Some(stream) = self.engine.streams.get(stream_id) else {
            return;
        };
        let context = context.to_js();
        if context.is_object() {
            stream.set_context(context, cx.global());
        } else {
            self.engine.streams.release(&stream);
            self.engine.streams.close(&stream);
        }
    }

    /// Calls `callback(stream, isClosed)` for the closed streams, or for those whose close JS hasn't handled yet. One in its close handler is both.
    pub(crate) fn for_each_stream(
        &self,
        cx: &mut JsScope<'_>,
        callback: JsLocal<'_, Callable>,
        closed: bool,
    ) {
        let global_object = cx.global();
        let callback = callback.to_js();
        for stream in self.engine.streams.snapshot() {
            let wanted = if closed {
                stream.is_closed()
            } else {
                !stream.close_delivered.get()
            };
            if !wanted {
                continue;
            }
            let Some(value) = stream.js_context.get().get() else {
                continue;
            };
            self.handlers.vm.event_loop_mut().run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global_object,
                JSValue::UNDEFINED,
                &[value, JSValue::from(stream.is_closed())],
            );
        }
    }

    pub(crate) fn emit_error_to_all_streams(&self, _: &mut JsScope<'_>, code: u32) {
        for stream in self.engine.streams.snapshot() {
            self.reset_stream(&stream, ErrorCode(code), false);
        }
    }

    pub(crate) fn flush_from_js(&self, _: &mut JsScope<'_>) -> usize {
        self.flush()
    }

    pub(crate) fn request(
        &self,
        cx: &mut JsScope<'_>,
        stream_id: u32,
        context: JsLocal<'_>,
        headers: JsLocal<'_>,
        sensitive_headers: JsLocal<'_>,
        options: JsLocal<'_>,
        informational: bool,
    ) -> JsResult<()> {
        let global_object = cx.global();
        bun_output::scoped_log!(H2FrameParser, "request");

        let context = context.to_js();
        let headers = headers.to_js();
        let sensitive_headers = sensitive_headers.to_js();
        let options = options.to_js();
        // The stream can have closed without JS having run its handler for that yet.
        let Some(stream) = self.open_stream(stream_id) else {
            return Ok(());
        };
        let mut scratch = HeaderScratch::take(global_object);
        let mut wait_for_trailers: bool = false;
        let mut end_stream: bool = false;
        let prepared = (|| -> JsResult<()> {
            collect_fields(
                global_object,
                headers,
                sensitive_headers,
                if self.engine.is_server.get() {
                    BlockRole::Response
                } else {
                    BlockRole::Request
                },
                self.strict_single_value_fields.get(),
                Some(&mut scratch.block),
            )?;
            if !options.is_object() {
                return Ok(());
            }
            if let Some(padding_js) = options.get(global_object, "paddingStrategy")? {
                if padding_js.is_number() {
                    stream.padding_strategy.set(match padding_js.to_u32() {
                        1 => PaddingStrategy::Aligned,
                        2 => PaddingStrategy::Max,
                        _ => PaddingStrategy::None,
                    });
                }
            }
            if let Some(trailers_js) = options.get(global_object, "waitForTrailers")? {
                if trailers_js.is_boolean() {
                    wait_for_trailers = trailers_js.as_boolean();
                }
            }
            if let Some(end_stream_js) = options.get(global_object, "endStream")? {
                if !end_stream_js.is_boolean() {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"options.endStream",
                        b"boolean",
                        end_stream_js,
                    ));
                }
                end_stream = end_stream_js.as_boolean();
            }
            Ok(())
        })();
        if let Err(err) = prepared {
            // The id is used up, but the peer never heard of the stream.
            if stream.state() == State::Idle {
                self.engine.streams.close(&stream);
            }
            return Err(err);
        }
        stream.request_method.set(
            scratch
                .block
                .get(b":method")
                .map(RequestMethod::from_method),
        );
        if context.is_object() {
            stream.set_context(context, global_object);
        }
        let mut flags: u8 = if end_stream { flags::END_STREAM } else { 0 };

        // A server only gets here for a stream that's already open.
        if !self.engine.is_server.get() && self.engine.is_over_memory_limit(self) {
            self.rejected_streams.set(self.rejected_streams.get() + 1);
            self.reset_stream(&stream, ErrorCode::ENHANCE_YOUR_CALM, false);
            if self.rejected_streams.get() >= self.max_rejected_streams.get() {
                let global = self.global();
                let chunk = BinaryType::Buffer.to_js(b"ENHANCE_YOUR_CALM", &global)?;
                self.dispatch_with_2_extra(
                    js::on_error_get_cached,
                    JSValue::js_number(ErrorCode::ENHANCE_YOUR_CALM.0 as f64),
                    JSValue::js_number(self.engine.last_stream_id.get() as f64),
                    chunk,
                );
            }
            return Ok(());
        }
        if self.is_over_send_limit(&scratch.block) {
            self.dispatch_with_2_extra(
                js::on_frame_error_get_cached,
                stream.context(),
                JSValue::js_number(FrameType::Headers as u8 as f64),
                JSValue::js_number(ErrorCode::FRAME_SIZE_ERROR.0 as f64),
            );
            if !self.engine.is_server.get() {
                // The peer never saw this request, so it gets no RST_STREAM.
                self.reset_stream(&stream, ErrorCode::REFUSED_STREAM, false);
            } else if !informational {
                self.reset_stream(&stream, ErrorCode::FRAME_SIZE_ERROR, true);
            }
            return Ok(());
        }

        // The encode updates the HPACK table, so nothing may return or throw until the block is written.
        if let Err(err) = self.encode_header_list(&mut scratch) {
            if matches!(err, crate::Error::Alloc(_)) {
                return Err(global_object.throw(format_args!("Failed to allocate header buffer")));
            }
            self.schedule_header_compression_session_error();
            return Ok(());
        }
        let max_frame_size = self.engine.remote_settings.get().max_frame_size as usize;
        let encoded_size = scratch.encoded.len();
        // CONTINUATION frames can't be padded, so only a block that fits one frame is. One byte is the Pad Length field.
        let padding: u8 = if encoded_size >= max_frame_size {
            0
        } else {
            stream.padding_for(encoded_size, max_frame_size - 1)
        };
        if padding != 0 {
            flags |= flags::PADDED;
            // Doesn't allocate, because encode_header_list reserved the room.
            scratch.encoded.insert(0, padding);
            scratch
                .encoded
                .resize(1 + encoded_size + padding as usize, 0);
        }
        // Before the write: a synchronous JS transport handles the peer's answer inside it.
        let _ = self.engine.streams.apply(&stream, StreamEvent::SendHeaders);
        self.write_header_block(FrameType::Headers, flags, stream_id, b"", &scratch.encoded);
        if end_stream {
            self.sent_end_stream(&stream, false);
        } else {
            stream.wait_for_trailers.set(wait_for_trailers);
        }
        Ok(())
    }

    /// What a JS transport read. `on_native_read` is the same for a native socket.
    pub(crate) fn read<'a>(&self, cx: &mut JsScope<'a>, data: JsBytes<'a>) -> JsResult<()> {
        // A handler can detach or transfer the buffer between two frames, so a copy is parsed.
        let copied = data.get(&cx.heap).to_vec();
        self.receive(&copied);
        if self.left_exception.replace(false) {
            return Err(bun_jsc::JsError::Thrown);
        }
        Ok(())
    }

    pub(crate) fn on_native_read(&self, data: &[u8]) -> JsResult<()> {
        bun_output::scoped_log!(H2FrameParser, "onNativeRead");
        let _keepalive = self.keepalive();
        // Engine-driven inbound: all reads flow through the rewritten connection engine.
        self.receive(data);
        // What a frame callback left pending stopped the engine (`should_stop`);
        // it belongs to the socket dispatch that delivered these bytes.
        if self.left_exception.replace(false) {
            return Err(bun_jsc::JsError::Thrown);
        }
        Ok(())
    }

    pub(crate) fn on_native_writable(&self) {
        // flush() re-enters JS (write callbacks, onStreamEnd, onWantTrailers);
        // that JS can destroy the session and drop the socket's ref, so the
        // keepalive must span the whole loop, not just each flush() call.
        let _keepalive = self.keepalive();
        // flush() ends in flush_stream_queue() → write() → cork(), leaving the
        // newly-serialized frames in CORK_BUFFER (not on the wire). Returning
        // here would let loop.c see last_write_failed==0 and disarm WRITABLE,
        // stranding those bytes until an auto_flush task that may not be
        // re-registered. Loop flush() until either we hit real socket
        // backpressure (last_write_failed is then set) or no progress is made.
        loop {
            let wrote = self.flush();
            if self.has_backpressure() || wrote == 0 {
                break;
            }
        }
        if self.draining.get() != Draining::No {
            self.finish_draining();
        }
    }

    /// Releases the socket once it has taken the output a draining parser kept.
    #[cold]
    fn finish_draining(&self) {
        if self.has_unsent_output() && self.socket_takes_output() {
            return;
        }
        if self.draining.replace(Draining::No) == Draining::OutputThenFin {
            match self.native_socket.get() {
                BunSocket::Tcp(socket) => socket.get().socket.get().shutdown(),
                BunSocket::Tls(socket) => socket.get().socket.get().shutdown(),
                BunSocket::TcpWriteonly(_) | BunSocket::TlsWriteonly(_) | BunSocket::None => {}
            }
        }
        self.write_buffer.with_mut(|wb| wb.clear_and_free());
        self.write_buffer_offset.set(0);
        self.detach_native_socket();
    }

    fn has_unsent_output(&self) -> bool {
        !self.write_buffer.get().slice()[self.write_buffer_offset.get()..].is_empty()
    }

    /// Returns true if a later writable event reaches this parser without running JS and the write side is still open.
    fn socket_takes_output(&self) -> bool {
        !self.transport_write_runs_js()
            && match self.native_socket.get() {
                BunSocket::Tcp(socket) => socket.get().write_side_open(),
                BunSocket::Tls(socket) => socket.get().write_side_open(),
                BunSocket::TcpWriteonly(_) | BunSocket::TlsWriteonly(_) | BunSocket::None => false,
            }
    }

    fn owes_output(&self) -> bool {
        self.has_unsent_output() && !self.transport_write_fatal.get() && self.socket_takes_output()
    }

    /// Returns true if a draining parser holds back the socket's FIN. `finish_draining` sends it after the output.
    pub(crate) fn defer_shutdown(&self) -> bool {
        if self.draining.get() == Draining::No || !self.owes_output() {
            return false;
        }
        self.draining.set(Draining::OutputThenFin);
        true
    }

    pub(crate) fn on_native_close(&self) {
        bun_output::scoped_log!(H2FrameParser, "onNativeClose");
        // detach_native_socket can drop the socket's last ref (Writeonly deref),
        // so match on_native_read/on_native_writable and hold our own +1.
        let _keepalive = self.keepalive();
        self.native_socket.note_socket_closed();
        self.detach_native_socket();
        // Free the kept output now instead of when the wrapper is collected.
        if self.draining.replace(Draining::No) != Draining::No {
            self.write_buffer.with_mut(|wb| wb.clear_and_free());
            self.write_buffer_offset.set(0);
        }
    }

    pub(crate) fn set_native_socket(&self, _: &mut JsScope<'_>, socket: JsLocal<'_>) {
        let socket = socket.to_js();
        self.detach_native_socket();
        if let Some(socket) = TLSSocket::from_js(socket) {
            bun_output::scoped_log!(H2FrameParser, "TLSSocket attached");
            self.native_socket.attach::<true>(socket, self.ref_guard());
            // if we started with non native and go to native we now control the backpressure internally
            self.has_nonnative_backpressure.set(false);
            let _ = self.flush();
        } else if let Some(socket) = TCPSocket::from_js(socket) {
            bun_output::scoped_log!(H2FrameParser, "TCPSocket attached");
            self.native_socket.attach::<false>(socket, self.ref_guard());
            // if we started with non native and go to native we now control the backpressure internally
            self.has_nonnative_backpressure.set(false);
            let _ = self.flush();
        }
    }

    pub(crate) fn detach_native_socket(&self) {
        self.native_socket.detach();
    }

    /// Saturating read of a numeric session limit into its u32 field.
    fn session_option_u32(value: JSValue) -> u32 {
        u32::try_from(value.to_uint64_no_truncate()).unwrap_or(u32::MAX)
    }

    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        options: &H2FrameParserOptions<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global_object = cx.global();

        let init = H2FrameParser {
            abort_handle: bun_jsc::AbortHandle::for_owner::<H2FrameParser>(),
            ref_count: bun_ptr::RefCount::init(),
            native_keepalives: Cell::new(0),
            handlers: Handlers::new(global_object),
            global_this: GlobalRef::from(global_object),
            strong_this: JsCell::new(JsRef::empty()),
            native_socket: NativeSocket::default(),
            explicit_settings: Cell::new(0),
            custom_settings: JsCell::new(Vec::new()),
            wire_custom_settings: JsCell::new(Vec::new()),
            remote_custom_settings_filter: JsCell::new(Vec::new()),
            remote_custom_settings: JsCell::new(Vec::new()),
            window_size: Cell::new(u64::from(DEFAULT_WINDOW_SIZE)),
            max_rejected_streams: Cell::new(100),
            rejected_streams: Cell::new(0),
            queued_data_size: Cell::new(0),
            max_outstanding_pings: Cell::new(10),
            out_standing_pings: Cell::new(0),
            max_send_header_block_length: Cell::new(NGHTTP2_MAX_HEADERSLEN),
            strict_single_value_fields: Cell::new(true),
            left_exception: Cell::new(false),
            write_buffer: JsCell::new(Vec::<u8>::default()),
            write_buffer_offset: Cell::new(0),
            flushing_stream_queue: Cell::new(false),
            outbound_queue_size: Cell::new(0),
            has_nonnative_backpressure: Cell::new(false),
            js_socket_flushing: Cell::new(false),
            transport_write_fatal: Cell::new(false),
            draining: Cell::new(Draining::No),
            pending_header_compression_error: Cell::new(false),
            tx_tracker: Cell::new(TxFrameTracker::default()),
            auto_flusher: JsCell::new(AutoFlusher::default()),
            engine: Connection::default(),
            frames_sent: Cell::new(0),
            inbound_tail: JsCell::new(Vec::new()),
            inbound_tail_pos: Cell::new(0),
            receiving: Cell::new(false),
            deferred: JsCell::new(VecDeque::new()),
            pending_push: Cell::new(0),
            hdr_block: JsCell::new(Vec::new()),
            hdr_meta: JsCell::new(Vec::new()),
        };
        let this: *mut H2FrameParser = if ENABLE_ALLOCATOR_POOL {
            POOL.with_borrow_mut(|pool| {
                let pool = pool.get_or_insert_with(|| {
                    // SAFETY: `new_boxed` returns a `Box::leak`ed, fully
                    // initialized allocation; `from_raw` reclaims that exact
                    // pointer back into an owning `Box`. `ManuallyDrop<T>` is
                    // `repr(transparent)` over `T`, so the pointer cast is a
                    // layout no-op.
                    unsafe {
                        Box::from_raw(
                            H2FrameParserHiveAllocator::new_boxed()
                                .as_ptr()
                                .cast::<ManuallyDrop<H2FrameParserHiveAllocator>>(),
                        )
                    }
                });
                pool.get_init(init).as_ptr()
            })
        } else {
            bun_core::heap::into_raw(Box::new(init))
        };
        // SAFETY: `this` was just allocated above; the wrapper adopts its one ref.
        let this_value = structure.create(&cx.heap, unsafe { RefPtr::from_raw(this) });
        let js_value = this_value.to_js();
        let global_object = cx.global();
        // SAFETY: `this_value` holds a ref.
        let this_ref = unsafe { &*this };
        // Detaches the socket attached below when a later `?` throws.
        let guard = scopeguard::guard(this_ref, |this: &Self| this.detach(false));
        Handlers::install(global_object, &options.handlers, js_value);

        let socket_js = options.native.to_js();
        if let Some(socket) = TLSSocket::from_js(socket_js) {
            bun_output::scoped_log!(H2FrameParser, "TLSSocket attached");
            this_ref
                .native_socket
                .attach::<true>(socket, this_ref.ref_guard());
            let _ = this_ref.flush();
        } else if let Some(socket) = TCPSocket::from_js(socket_js) {
            bun_output::scoped_log!(H2FrameParser, "TCPSocket attached");
            this_ref
                .native_socket
                .attach::<false>(socket, this_ref.ref_guard());
            let _ = this_ref.flush();
        }
        let settings_js = options.settings.to_js();
        if !settings_js.is_empty_or_undefined_or_null() {
            bun_output::scoped_log!(H2FrameParser, "settings received in the constructor");
            this_ref.load_settings_from_js_value(global_object, settings_js)?;
            // These settings go out with the preface, so they bind the peer at once. Those of a later settings() do once the peer ACKs them.
            this_ref
                .engine
                .enforced_max_header_list_size
                .set(this_ref.engine.local_settings.get().max_header_list_size);

            if let Some(max_pings) = settings_js.get(global_object, "maxOutstandingPings")? {
                if max_pings.is_number() {
                    this_ref
                        .max_outstanding_pings
                        .set(max_pings.to_uint64_no_truncate());
                }
            }
            if let Some(max_memory) = settings_js.get(global_object, "maxSessionMemory")? {
                if max_memory.is_number() {
                    let megabytes = Self::session_option_u32(max_memory).max(1) as usize;
                    this_ref
                        .engine
                        .max_session_memory
                        .set(megabytes.saturating_mul(1024 * 1024));
                }
            }
            if let Some(max_header_list_pairs) =
                settings_js.get(global_object, "maxHeaderListPairs")?
            {
                if max_header_list_pairs.is_number() {
                    this_ref
                        .engine
                        .max_header_list_pairs
                        .set(Self::session_option_u32(max_header_list_pairs).max(4));
                }
            }
            if let Some(max_settings) = settings_js.get(global_object, "maxSettings")? {
                if max_settings.is_number() {
                    this_ref
                        .engine
                        .max_settings
                        .set(Self::session_option_u32(max_settings).max(1));
                }
            }
            if let Some(max_rejected_streams) =
                settings_js.get(global_object, "maxSessionRejectedStreams")?
            {
                if max_rejected_streams.is_number() {
                    this_ref
                        .max_rejected_streams
                        .set(Self::session_option_u32(max_rejected_streams));
                }
            }
            if let Some(max_session_invalid_frames) =
                settings_js.get(global_object, "maxSessionInvalidFrames")?
            {
                if max_session_invalid_frames.is_number() {
                    this_ref
                        .engine
                        .max_invalid_frames
                        .set(Self::session_option_u32(max_session_invalid_frames));
                }
            }
            if let Some(strict) =
                settings_js.get(global_object, "strictFieldWhitespaceValidation")?
            {
                if strict.is_boolean() {
                    this_ref
                        .engine
                        .strict_field_whitespace
                        .set(strict.as_boolean());
                }
            }
            // node: MathMax(1, x) per key (util.js), applied when both are given (node_http2.cc).
            if let Some(reset_burst) = settings_js.get(global_object, "streamResetBurst")?
                && let Some(reset_rate) = settings_js.get(global_object, "streamResetRate")?
                && reset_burst.is_number()
                && reset_rate.is_number()
            {
                this_ref.engine.set_stream_reset_limit(
                    reset_burst.to_u32().max(1),
                    reset_rate.to_u32().max(1),
                );
            }
            if let Some(max_send_header_block_length) =
                settings_js.get(global_object, "maxSendHeaderBlockLength")?
            {
                if max_send_header_block_length.is_number() {
                    this_ref
                        .max_send_header_block_length
                        .set(max_send_header_block_length.to_int32() as u32);
                }
            }
            if let Some(strict_single_value) =
                settings_js.get(global_object, "strictSingleValueFields")?
            {
                if strict_single_value.is_boolean() {
                    this_ref
                        .strict_single_value_fields
                        .set(strict_single_value.to_boolean());
                }
            }
            if let Some(padding_strategy) = settings_js.get(global_object, "paddingStrategy")? {
                if padding_strategy.is_number() {
                    this_ref
                        .engine
                        .padding_strategy
                        .set(match padding_strategy.to_u32() {
                            1 => PaddingStrategy::Aligned,
                            2 => PaddingStrategy::Max,
                            _ => PaddingStrategy::None,
                        });
                }
            }
        }
        let is_server = options.session_type == 0;
        this_ref.engine.is_server.set(is_server);
        js::context_set_cached(js_value, global_object, options.context.to_js());

        this_ref
            .strong_this
            .with_mut(|s| s.set_strong(js_value, global_object));
        let vm = global_object.bun_vm();
        if let Some(context) = vm.as_graph_context(vm.context_of_caller()) {
            // SAFETY: `this` is heap-pinned (pool slot or Box); it leaves its context in
            // `release_from_js` or when it drops.
            unsafe { bun_jsc::AbortHandle::arm_owner(this, context) };
        }

        if is_server {
            this_ref.set_settings(this_ref.engine.local_settings.get());
        } else {
            // consider that we need to queue until the first flush
            this_ref.has_nonnative_backpressure.set(true);
            this_ref.send_preface_and_settings();
        }
        scopeguard::ScopeGuard::into_inner(guard);
        Ok(this_value)
    }

    /// `detach(keepOutput)`
    pub(crate) fn detach_from_js(&self, _: &mut JsScope<'_>, keep_output: bool) {
        self.release_from_js(keep_output);
    }

    /// The session is over: free its streams, let go of the socket, and stop keeping the wrapper
    /// (and through it the handlers and their context object) alive.
    fn release_from_js(&self, keep_output: bool) {
        let this = self;
        this.abort_handle.leave();
        for stream in this.engine.streams.snapshot() {
            this.drop_queued_data(&stream);
        }
        this.engine.streams.clear();
        this.detach(keep_output);
        if let Some(this_value) = this.strong_this.get().try_get() {
            // `global_this` is `GlobalRef` (JSC_BORROW) — Deref gives `&JSGlobalObject`.
            js::context_set_cached(this_value, &this.global_this, JSValue::ZERO);
            this.strong_this.with_mut(|s| s.set_weak(this_value));
        }
    }

    /// be careful when calling detach be sure that the socket is closed and the parser not accesible anymore
    /// this function can be called multiple times, it will erase stream info
    pub(crate) fn detach(&self, keep_output: bool) {
        self.uncork();
        self.unregister_auto_flush();
        let draining = keep_output && self.owes_output();
        if !draining {
            self.draining.set(Draining::No);
            self.detach_native_socket();
            // JS can call detach() without a following drop, so free the capacity here too.
            self.write_buffer.with_mut(|wb| wb.clear_and_free());
            self.write_buffer_offset.set(0);
        } else if self.draining.get() == Draining::No {
            self.draining.set(Draining::Output);
        }
        self.tx_tracker.set(TxFrameTracker::default());
    }

    /// `process.exit()` never unwinds: the VM is destructed from inside the `exit()` call, so
    /// every `+1` taken by a frame that was still on the stack when JS called it — an inbound
    /// dispatch (`on_native_read`), a write that re-entered JS (`_write`, `send_data`) — is never
    /// released, and neither is the cork slot's ref nor the queued auto-flush task's. `Drop`
    /// therefore never runs and the parser leaks everything it owns (LeakSanitizer sees the
    /// refcount's own debug map, the HPACK handle, the read/write buffers).
    ///
    /// Called from `finalize` only while the VM is shutting down: the event loop is dead, no JS
    /// (and no stranded frame) can run again, so releasing those refs cannot make anything
    /// observe a freed parser. The socket's `+1` (`attach_native_callback`) is deliberately left
    /// alone — it has a live owner that releases it in `NewSocket::finalize`.
    fn release_refs_stranded_by_exit(&self) {
        // `uncork()` would `_write()` the corked bytes, which re-enters JS on a non-native
        // socket; the process is exiting, so drop them and just release the slot's ref.
        if Self::corked() == Some(self.as_ctx_ptr()) {
            CORK_OFFSET.with(|c| c.set(0));
            Self::set_corked(None);
        }
        // Removes the deferred task (its ctx is `self`) and releases the ref it holds.
        self.unregister_auto_flush();
        let stranded = self.native_keepalives.replace(0);
        for _ in 0..stranded {
            self.deref();
        }
    }
}

bun_jsc::impl_abort_handle_owner!(H2FrameParser, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ not dropped). The wrapper this makes
    // collectible is not finalized under this call.
    unsafe { (*this).release_from_js(false) }
});

impl Drop for H2FrameParser {
    fn drop(&mut self) {
        bun_output::scoped_log!(H2FrameParser, "deinit");

        self.detach(false);
    }
}

impl H2FrameParser {
    /// What the session's own buffers hold, used or not.
    pub(crate) fn memory_cost(&self) -> usize {
        self.write_buffer.get().capacity()
            + self.inbound_tail.get().capacity()
            + self.hdr_block.get().capacity()
            + self.hdr_meta.get().capacity() * core::mem::size_of::<u32>()
            + self.engine.header_block_capacity()
    }

    pub(crate) fn finalize(&self) {
        bun_output::scoped_log!(H2FrameParser, "finalize");
        self.strong_this.set(JsRef::empty());
        if VirtualMachine::get().is_shutting_down() {
            // Release the refs of frames/tasks that will never run again, so the
            // wrapper's deref can actually reach zero and run `Drop`.
            self.release_refs_stranded_by_exit();
        }
    }
}
