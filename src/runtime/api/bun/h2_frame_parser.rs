//! HTTP/2 frame parser.
#![allow(
    non_camel_case_types,
    non_upper_case_globals,
    clippy::too_many_arguments
)]

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use std::borrow::Cow;

use crate::api::socket::{TCPSocket, TLSSocket};
use crate::node::{Encoding, StringOrBuffer};
use crate::socket::NativeCallbacks;
use crate::webcore::AutoFlusher;
use bstr::BStr;
use bun_collections::{ByteVecExt, HashMap as BunHashMap, HiveArrayFallback, VecExt};
use bun_core::strings;
use bun_http::lshpack;
use bun_jsc::AbortSignal;
use bun_jsc::ErrorCode as JscErrorCode;
use bun_jsc::abort_signal::AbortListener;
use bun_jsc::array_buffer::BinaryType;
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsClass, JsRef, JsResult, StrongOptional,
};
use bun_ptr::RefPtr;

bun_output::declare_scope!(H2FrameParser, visible);

// ──────────────────────────────────────────────────────────────────────────
// Codegen modules — `jsc.Codegen.JSH2FrameParser` / `JSTCPSocket` / `JSTLSSocket`.
// Hand-rolled extern bindings to the C++ shims emitted by generate-classes.ts
// (see `${TypeName}__fromJS` etc. in build/*/codegen/ZigGeneratedClasses.cpp);
// replace with the macro-derived modules once the .rs codegen backend lands.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_snake_case, non_camel_case_types)]
pub mod JSH2FrameParser {
    use super::{JSGlobalObject, JSValue};

    // Per-slot `${snake}_get_cached` / `${snake}_set_cached` wrappers around the
    // `H2FrameParserPrototype__${prop}{Get,Set}CachedValue` C++ shims (emitted by
    // generate-classes.ts for every entry in h2.classes.ts `values: [...]`).
    bun_jsc::codegen_cached_accessors!(
        "H2FrameParser";
        context,
        onError,
        onWrite,
        onStreamStart,
        onStreamHeaders,
        onStreamEnd,
        onStreamData,
        onStreamError,
        onRemoteSettings,
        onLocalSettings,
        onWantTrailers,
        onPing,
        onEnd,
        onGoAway,
        onAborted,
        onAltSvc,
        onOrigin,
        onFrameError,
        onStreamPush
    );

    // `Gc` enum + `get`/`set`/`clear` impl — emitted by
    // `bun_jsc::codegen_cached_accessors!` above.

    // `H2FrameParser__getConstructor` — emitted by generate-classes.ts
    // (`symbolName(typeName, "getConstructor")`). `*mut JSGlobalObject` to
    // match `generated_classes.rs` (avoids `clashing_extern_declarations`).
    bun_jsc::jsc_abi_extern! {
        #[link_name = "H2FrameParser__getConstructor"]
        safe fn __get_constructor(global: *mut JSGlobalObject) -> JSValue;
    }

    /// Lazily fetch the JS constructor from `globalObject`.
    #[inline]
    pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
        __get_constructor(global.as_mut_ptr())
    }
}
// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const MAX_PAYLOAD_SIZE_WITHOUT_FRAME: usize = 16384 - FrameHeader::BYTE_SIZE - 1;

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
struct NativeSocket(Cell<BunSocket>);

impl NativeSocket {
    #[inline]
    fn get(&self) -> BunSocket {
        self.0.get()
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
        debug_assert!(matches!(self.0.get(), BunSocket::None));
        // BACKREF: `socket` is the live `m_ctx` borrowed from the JS wrapper
        // rooted by the caller's `socket_js`.
        let socket_nn = NonNull::new(socket).expect("NewSocket m_ctx");
        let socket = bun_ptr::BackRef::from(socket_nn);
        self.0
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
        match self.0.replace(BunSocket::None) {
            BunSocket::Tcp(socket) => socket.detach_native_callback(),
            BunSocket::Tls(socket) => socket.detach_native_callback(),
            // The ref `attach` took.
            BunSocket::TcpWriteonly(socket) => TCPSocket::deref(socket.get()),
            BunSocket::TlsWriteonly(socket) => TLSSocket::deref(socket.get()),
            BunSocket::None => {}
        }
    }
}

impl Drop for NativeSocket {
    fn drop(&mut self) {
        self.detach();
    }
}

unsafe extern "C" {
    safe fn Bun__wrapAbortError(global_object: &JSGlobalObject, cause: JSValue) -> JSValue;
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

// ──────────────────────────────────────────────────────────────────────────
// Local builder for throwing `HTTP2_INVALID_SETTING_VALUE*` errors; the
// ErrorCode table exposes them via `JscErrorCode::*`.
// ──────────────────────────────────────────────────────────────────────────
pub(crate) struct H2ErrBuilder<'a> {
    global: &'a JSGlobalObject,
    code: JscErrorCode,
    msg: &'static str,
}
impl<'a> H2ErrBuilder<'a> {
    #[inline]
    pub(crate) fn throw<T>(self) -> JsResult<T> {
        Err(self.code.throw(self.global, format_args!("{}", self.msg)))
    }
}
pub(crate) trait H2GlobalErrExt {
    fn err_http2_invalid_setting_value_range_error(&self, msg: &'static str) -> H2ErrBuilder<'_>;
    fn err_http2_invalid_setting_value(&self, msg: &'static str) -> H2ErrBuilder<'_>;
    fn err_http2_too_many_custom_settings(&self, msg: &'static str) -> H2ErrBuilder<'_>;
}
impl H2GlobalErrExt for JSGlobalObject {
    #[inline]
    fn err_http2_invalid_setting_value_range_error(&self, msg: &'static str) -> H2ErrBuilder<'_> {
        H2ErrBuilder {
            global: self,
            code: JscErrorCode::HTTP2_INVALID_SETTING_VALUE_RangeError,
            msg,
        }
    }
    #[inline]
    fn err_http2_invalid_setting_value(&self, msg: &'static str) -> H2ErrBuilder<'_> {
        H2ErrBuilder {
            global: self,
            code: JscErrorCode::HTTP2_INVALID_SETTING_VALUE,
            msg,
        }
    }
    #[inline]
    fn err_http2_too_many_custom_settings(&self, msg: &'static str) -> H2ErrBuilder<'_> {
        H2ErrBuilder {
            global: self,
            code: JscErrorCode::HTTP2_TOO_MANY_CUSTOM_SETTINGS,
            msg,
        }
    }
}

const MAX_WINDOW_SIZE: u32 = i32::MAX as u32;
const MAX_HEADER_TABLE_SIZE: u32 = u32::MAX;
const MAX_STREAM_ID: u32 = i32::MAX as u32;
const MAX_FRAME_SIZE: u32 = 0xFF_FFFF; // u24::MAX
const DEFAULT_WINDOW_SIZE: u64 = u16::MAX as u64;
// Float versions for range validation before integer conversion
const MAX_WINDOW_SIZE_F64: f64 = MAX_WINDOW_SIZE as f64;
const MAX_HEADER_TABLE_SIZE_F64: f64 = MAX_HEADER_TABLE_SIZE as f64;
const MAX_FRAME_SIZE_F64: f64 = MAX_FRAME_SIZE as f64;
// writeStream() return-value flag (bitwise-OR'd with the settled stream state, which is < 8):
// the data was flushed without queueing and the engine did not invoke the write callback —
// the JS caller (Http2Stream._write/_writev) completes it asynchronously. Mirrored in
// src/js/node/http2.ts (kWriteFlushedWithoutCallback).
const WRITE_FLUSHED_WITHOUT_CALLBACK: u32 = 0x10;
// RFC 7541 Section 4.1: Each header entry has 32 bytes of overhead
// for the HPACK dynamic table entry structure
const HPACK_ENTRY_OVERHEAD: usize = 32;
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

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum PaddingStrategy {
    #[default]
    None,
    Aligned,
    Max,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum FrameType {
    HTTP_FRAME_DATA = 0x00,
    HTTP_FRAME_HEADERS = 0x01,
    HTTP_FRAME_PRIORITY = 0x02,
    HTTP_FRAME_RST_STREAM = 0x03,
    HTTP_FRAME_SETTINGS = 0x04,
    HTTP_FRAME_PING = 0x06,
    HTTP_FRAME_GOAWAY = 0x07,
    HTTP_FRAME_WINDOW_UPDATE = 0x08,
    HTTP_FRAME_CONTINUATION = 0x09, // RFC 7540 Section 6.10: Continues header block fragments
    HTTP_FRAME_ALTSVC = 0x0A,       // https://datatracker.ietf.org/doc/html/rfc7838#section-7.2
    HTTP_FRAME_ORIGIN = 0x0C,       // https://datatracker.ietf.org/doc/html/rfc8336#section-2
}

#[repr(u8)]
enum PingFrameFlags {
    ACK = 0x1,
}

#[repr(u8)]
enum DataFrameFlags {
    END_STREAM = 0x1,
    PADDED = 0x8,
}

#[repr(u8)]
enum HeadersFrameFlags {
    END_STREAM = 0x1,
    END_HEADERS = 0x4,
    PADDED = 0x8,
    PRIORITY = 0x20,
}

// Open set of wire values → newtype over u32
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ErrorCode(u32);
impl ErrorCode {
    const NO_ERROR: Self = Self(0x0);
    const PROTOCOL_ERROR: Self = Self(0x1);
    const INTERNAL_ERROR: Self = Self(0x2);
    const FRAME_SIZE_ERROR: Self = Self(0x6);
    const REFUSED_STREAM: Self = Self(0x7);
    const CANCEL: Self = Self(0x8);
    const COMPRESSION_ERROR: Self = Self(0x9);
    const ENHANCE_YOUR_CALM: Self = Self(0xb);
    const MAX_PENDING_SETTINGS_ACK: Self = Self(0xe);
}

// ──────────────────────────────────────────────────────────────────────────
// Packed wire structs
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct UInt31WithReserved(u32);

impl UInt31WithReserved {
    #[inline]
    fn reserved(self) -> bool {
        self.0 & 0x8000_0000 != 0
    }
    #[inline]
    fn uint31(self) -> u32 {
        self.0 & 0x7fff_ffff
    }
    #[inline]
    fn init(value: u32, reserved: bool) -> Self {
        Self((value & 0x7fff_ffff) | if reserved { 0x8000_0000 } else { 0 })
    }
    /// Note: the wire format (RFC 7540 §6.3) wants the reserved/E bit at bit
    /// 31, so the layout is `(reserved << 31) | uint31`, which matches
    /// `write` and the on-wire `StreamPriority.stream_identifier`.
    #[inline]
    fn to_uint32(self) -> u32 {
        self.0
    }
    #[inline]
    fn write(self, writer: &mut impl WireWriter) -> bool {
        let mut value: u32 = self.uint31();
        if self.reserved() {
            value |= 0x8000_0000;
        }
        value = value.swap_bytes();
        writer.write_all(&value.to_ne_bytes()).is_ok()
    }
}

// packed struct(u40): streamIdentifier: u32, weight: u8
#[repr(C, packed)]
#[derive(Clone, Copy, Default)]
struct StreamPriority {
    stream_identifier: u32,
    weight: u8,
}
// SAFETY: `#[repr(C, packed)]` with `u32 + u8` fields — no padding, no niches,
// every 5-byte pattern is a valid value.
unsafe impl bytemuck::Zeroable for StreamPriority {}
// SAFETY: see `Zeroable` impl above; additionally `Copy + 'static`.
unsafe impl bytemuck::Pod for StreamPriority {}
const _: () = assert!(core::mem::size_of::<StreamPriority>() == StreamPriority::BYTE_SIZE);
impl StreamPriority {
    pub(crate) const BYTE_SIZE: usize = 5;
    #[inline]
    fn write(self, writer: &mut impl WireWriter) -> bool {
        let mut swap = self;
        swap.stream_identifier = swap.stream_identifier.swap_bytes();
        writer.write_all(bytemuck::bytes_of(&swap)).is_ok()
    }
}

// packed struct(u72): length: u24, type: u8, flags: u8, streamIdentifier: u32
// `length` is u24 on the wire; widened to u32 here (Rust has no u24). The 3-byte
// big-endian encoding is handled explicitly in write()/decode().
#[derive(Clone, Copy)]
pub struct FrameHeader {
    length: u32, // u24 on the wire
    type_: u8,
    flags: u8,
    stream_identifier: u32,
}
impl FrameHeader {
    pub const BYTE_SIZE: usize = 9;
    #[inline]
    fn write(&self, writer: &mut impl WireWriter, frames_sent: &Cell<u64>) -> bool {
        frames_sent.set(frames_sent.get() + 1);
        let mut buf = [0u8; Self::BYTE_SIZE];
        buf[0] = ((self.length >> 16) & 0xFF) as u8;
        buf[1] = ((self.length >> 8) & 0xFF) as u8;
        buf[2] = (self.length & 0xFF) as u8;
        buf[3] = self.type_;
        buf[4] = self.flags;
        buf[5..9].copy_from_slice(&self.stream_identifier.to_be_bytes());
        writer.write_all(&buf).is_ok()
    }
    /// Decode a complete 9-byte big-endian frame header.
    ///
    /// `FrameHeader` is not `#[repr(packed)]` (its `length` is a widened
    /// `u32`), so the caller assembles the 9 raw bytes on the stack and hands
    /// us the finished buffer — no per-instance or thread-local scratch needed.
    #[inline]
    fn decode(raw: &[u8; Self::BYTE_SIZE]) -> Self {
        Self {
            length: ((raw[0] as u32) << 16) | ((raw[1] as u32) << 8) | (raw[2] as u32),
            type_: raw[3],
            flags: raw[4],
            stream_identifier: u32::from_be_bytes([raw[5], raw[6], raw[7], raw[8]]),
        }
    }
}

/// The seven standard SETTINGS parameters (RFC 9113 §6.5.2). The wire form is produced by
/// `write_settings_payload`, which only emits the entries JS set explicitly.
#[derive(Clone, Copy)]
pub(crate) struct FullSettingsPayload {
    header_table_size: u32,
    enable_push: u32,
    max_concurrent_streams: u32,
    initial_window_size: u32,
    max_frame_size: u32,
    max_header_list_size: u32,
    enable_connect_protocol: u32,
}
impl Default for FullSettingsPayload {
    fn default() -> Self {
        Self {
            header_table_size: 4096,
            enable_push: 1,
            max_concurrent_streams: 4294967295,
            initial_window_size: 65535,
            max_frame_size: 16384,
            max_header_list_size: 65535,
            enable_connect_protocol: 0,
        }
    }
}
impl FullSettingsPayload {
    pub(crate) fn to_engine_settings(&self) -> crate::api::h2::settings::Settings {
        crate::api::h2::settings::Settings {
            header_table_size: self.header_table_size,
            enable_push: self.enable_push,
            max_concurrent_streams: self.max_concurrent_streams,
            initial_window_size: self.initial_window_size,
            max_frame_size: self.max_frame_size,
            max_header_list_size: self.max_header_list_size,
            enable_connect_protocol: self.enable_connect_protocol,
        }
    }

    pub(crate) fn to_js(&self, global_object: &JSGlobalObject) -> JSValue {
        let result = JSValue::create_empty_object(global_object, 8);
        let header_table_size = self.header_table_size;
        let enable_push = self.enable_push;
        let max_concurrent_streams = self.max_concurrent_streams;
        let initial_window_size = self.initial_window_size;
        let max_frame_size = self.max_frame_size;
        let max_header_list_size = self.max_header_list_size;
        let enable_connect_protocol = self.enable_connect_protocol;
        result.put(
            global_object,
            b"headerTableSize",
            JSValue::js_number(header_table_size as f64),
        );
        result.put(global_object, b"enablePush", JSValue::from(enable_push > 0));
        result.put(
            global_object,
            b"maxConcurrentStreams",
            JSValue::js_number(max_concurrent_streams as f64),
        );
        result.put(
            global_object,
            b"initialWindowSize",
            JSValue::js_number(initial_window_size as f64),
        );
        result.put(
            global_object,
            b"maxFrameSize",
            JSValue::js_number(max_frame_size as f64),
        );
        result.put(
            global_object,
            b"maxHeaderListSize",
            JSValue::js_number(max_header_list_size as f64),
        );
        result.put(
            global_object,
            b"maxHeaderSize",
            JSValue::js_number(max_header_list_size as f64),
        );
        result.put(
            global_object,
            b"enableConnectProtocol",
            JSValue::from(enable_connect_protocol > 0),
        );
        result
    }
}

/// Writer trait used for generic wire-serialization writer params.
/// All call sites use either a `FixedBufferStream` cursor or `DirectWriterStruct`.
use bun_io::Write as WireWriter;

// ──────────────────────────────────────────────────────────────────────────
// Static header maps
// ──────────────────────────────────────────────────────────────────────────

// A 1-entry set: a single slice compare; a lookup table buys nothing.
#[inline]
fn is_valid_response_pseudo_header(name: &[u8]) -> bool {
    name == b":status"
}

bun_core::comptime_string_set! {
    static REQUEST_PSEUDO_HEADERS = {
        b":path",
        b":method",
        b":scheme",
        b":protocol",
        b":authority",
    };
}

#[inline]
fn is_valid_request_pseudo_header(name: &[u8]) -> bool {
    REQUEST_PSEUDO_HEADERS.contains(name)
}

#[inline]
fn is_valid_header_value(value: &[u8]) -> bool {
    !strings::contains_any(value, b"\0\n\r")
}

/// The wire bytes of an outbound header value. A value whose code units all fit
/// in one byte is written one byte per code unit. Node does the same
/// (`StringBytes::Write(..., LATIN1)` in `NgHeaders`), and the inbound side
/// reads the bytes back as latin-1. A value with a wider code unit is written as
/// UTF-8. Bun has no single rule above 0xFF: Node truncates such a code unit to
/// its low byte, and object-form `respond()` drops the value in JS
/// (`headerValueIsUnsendable`).
fn header_value_bytes<'a>(value: &'a bun_jsc::JSStringView<'_>) -> Cow<'a, [u8]> {
    if !value.is_utf16() {
        return Cow::Borrowed(value.latin1());
    }
    let units = value.utf16();
    if units.iter().any(|&unit| unit > 0xFF) {
        return Cow::Owned(value.to_owned_slice());
    }
    let mut bytes = vec![0u8; units.len()];
    strings::copy_u16_into_u8(&mut bytes, units);
    Cow::Owned(bytes)
}

#[inline]
pub(crate) fn is_malformed_field_name(name: &[u8]) -> bool {
    let rest = match name.split_first() {
        None => return true,
        Some((b':', rest)) => rest,
        Some(_) => name,
    };
    rest.is_empty()
        || !rest.iter().all(|&c| {
            matches!(
                c,
                b'a'..=b'z'
                    | b'0'..=b'9'
                    | b'!'
                    | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~'
            )
        })
}

#[inline]
pub(crate) fn is_malformed_field_value(value: &[u8]) -> bool {
    strings::contains_any(value, b"\0\r\n")
}

const SINGLE_VALUE_HEADERS_LEN: usize = 40;

bun_core::comptime_string_map! {
    /// Maps headers that must carry only a single value to a stable index in
    /// `0..SINGLE_VALUE_HEADERS_LEN`. The index is used solely to address a
    /// per-request `[bool; SINGLE_VALUE_HEADERS_LEN]` bitset for duplicate
    /// detection — the concrete numeric value has no other meaning.
    static SINGLE_VALUE_HEADERS: usize = {
        b"tk" => 36,
        b"age" => 9,
        b"dnt" => 19,
        b"date" => 18,
        b"etag" => 20,
        b"from" => 22,
        b"host" => 23,
        b":path" => 4,
        b"range" => 33,
        b":status" => 0,
        b":method" => 1,
        b":scheme" => 3,
        b"expires" => 21,
        b"referer" => 34,
        b"if-match" => 24,
        b"if-range" => 27,
        b"location" => 30,
        b":protocol" => 5,
        b":authority" => 2,
        b"user-agent" => 38,
        b"content-md5" => 15,
        b"retry-after" => 35,
        b"content-type" => 17,
        b"max-forwards" => 31,
        b"authorization" => 10,
        b"content-range" => 16,
        b"if-none-match" => 26,
        b"last-modified" => 29,
        b"content-length" => 13,
        b"content-encoding" => 11,
        b"content-language" => 12,
        b"content-location" => 14,
        b"if-modified-since" => 25,
        b"if-unmodified-since" => 28,
        b"proxy-authorization" => 32,
        b"access-control-max-age" => 7,
        b"x-content-type-options" => 39,
        b"upgrade-insecure-requests" => 37,
        b"access-control-request-method" => 8,
        b"access-control-allow-credentials" => 6,
    };
}

#[inline]
fn single_value_headers_index_of(name: &[u8]) -> Option<usize> {
    SINGLE_VALUE_HEADERS.get(name).copied()
}

// ──────────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────────

struct Handlers {
    binary_type: BinaryType,
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
        event: JSH2FrameParser::Gc,
        this_value: JSValue,
        context: JSValue,
        data: &[JSValue],
    ) -> bool {
        let Some(callback) = event.get(this_value) else {
            return false;
        };
        // A zero/empty arg means a value failed to materialize (e.g. the VM is
        // terminating); skip the callback rather than passing it to JS, which
        // asserts/crashes in Bun__JSValue__call.
        if self.should_skip_dispatch(data) {
            return false;
        }
        self.vm
            .event_loop_ref()
            .run_callback(callback, &self.global(), context, data);
        true
    }

    pub(crate) fn call_write_callback(&self, callback: JSValue, data: &[JSValue]) -> bool {
        if !callback.is_callable() {
            return false;
        }
        if self.should_skip_dispatch(data) {
            return false;
        }
        self.vm
            .event_loop_ref()
            .run_callback(callback, &self.global(), JSValue::UNDEFINED, data);
        true
    }

    pub(crate) fn call_event_handler_with_result(
        &self,
        event: JSH2FrameParser::Gc,
        this_value: JSValue,
        data: &[JSValue],
    ) -> JSValue {
        let Some(callback) = event.get(this_value) else {
            return JSValue::ZERO;
        };
        if self.should_skip_dispatch(data) {
            return JSValue::ZERO;
        }
        self.vm.event_loop_ref().run_callback_with_result(
            callback,
            &self.global(),
            this_value,
            data,
        )
    }

    pub(crate) fn from_js(
        global_object: &JSGlobalObject,
        opts: JSValue,
        this_value: JSValue,
    ) -> JsResult<Handlers> {
        let mut handlers = Handlers {
            binary_type: BinaryType::Buffer,
            // SAFETY: bun_vm() never returns null; VM outlives every JS object (effectively 'static).
            vm: global_object.bun_vm(),
            global_object: GlobalRef::from(global_object),
        };

        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return Err(global_object
                .throw_invalid_arguments(format_args!("Expected \"handlers\" to be an object")));
        }

        macro_rules! handler_pair {
            ($field:ident, $key:literal) => {{
                if let Some(callback_value) = opts.get_truthy(global_object, $key)? {
                    if !callback_value.is_cell() || !callback_value.is_callable() {
                        return Err(global_object.throw_invalid_arguments(format_args!(
                            "Expected \"{}\" callback to be a function",
                            $key
                        )));
                    }
                    JSH2FrameParser::Gc::$field.set(
                        this_value,
                        global_object,
                        callback_value.with_async_context_if_needed(global_object),
                    );
                }
            }};
        }
        handler_pair!(onStreamStart, "streamStart");
        handler_pair!(onStreamHeaders, "streamHeaders");
        handler_pair!(onStreamEnd, "streamEnd");
        handler_pair!(onStreamData, "streamData");
        handler_pair!(onStreamError, "streamError");
        handler_pair!(onRemoteSettings, "remoteSettings");
        handler_pair!(onLocalSettings, "localSettings");
        handler_pair!(onWantTrailers, "wantTrailers");
        handler_pair!(onPing, "ping");
        handler_pair!(onEnd, "end");
        // .{ "onError", "error" } using fastGet(.error) now
        handler_pair!(onGoAway, "goaway");
        handler_pair!(onAborted, "aborted");
        handler_pair!(onWrite, "write");
        handler_pair!(onAltSvc, "altsvc");
        handler_pair!(onOrigin, "origin");
        handler_pair!(onFrameError, "frameError");
        handler_pair!(onStreamPush, "streamPush");

        if let Some(callback_value) = opts.fast_get(global_object, bun_jsc::BuiltinName::Error)? {
            if !callback_value.is_cell() || !callback_value.is_callable() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "Expected \"error\" callback to be a function"
                )));
            }
            JSH2FrameParser::Gc::onError.set(
                this_value,
                global_object,
                callback_value.with_async_context_if_needed(global_object),
            );
        }

        // onWrite is required for duplex support or if more than 1 parser is attached to the same socket (unliked)
        if JSH2FrameParser::Gc::onWrite.get(this_value) == Some(JSValue::ZERO)
            || JSH2FrameParser::Gc::onWrite.get(this_value).is_none()
        {
            return Err(global_object
                .throw_invalid_arguments(format_args!("Expected at least \"write\" callback")));
        }

        if let Some(binary_type_value) = opts.get_truthy(global_object, "binaryType")? {
            if !binary_type_value.is_string() {
                return Err(global_object.throw_invalid_arguments(format_args!(
                    "Expected \"binaryType\" to be a string"
                )));
            }
            handlers.binary_type =
                match BinaryType::from_js_value(global_object, binary_type_value)? {
                    Some(bt) => bt,
                    None => {
                        return Err(global_object.throw_invalid_arguments(format_args!(
                            "Expected 'binaryType' to be 'ArrayBuffer', 'Uint8Array', or 'Buffer'",
                        )));
                    }
                };
        }

        Ok(handlers)
    }
}

/// snake_case alias for the codegen'd `$rust(h2_frame_parser.rs, H2FrameParserConstructor)`
/// thunk in `generated_js2native.rs` (the generator snake-cases the export name).
pub use JSH2FrameParser::get_constructor as h2_frame_parser_constructor;

use bun_io::FixedBufferStream;

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

struct DispatchGuard<'a>(&'a Cell<u32>);

impl Drop for DispatchGuard<'_> {
    fn drop(&mut self) {
        self.0.set(self.0.get() - 1);
    }
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
    header: [u8; FrameHeader::BYTE_SIZE],
    header_len: u8,
    /// A HEADERS/PUSH_PROMISE/CONTINUATION without END_HEADERS went out; the block is open.
    header_block_open: bool,
}

impl TxFrameTracker {
    fn at_boundary(&self) -> bool {
        self.remaining == 0 && self.header_len == 0 && !self.header_block_open
    }

    fn advance(&mut self, mut chunk: &[u8]) {
        const CONNECTION_PREFACE: &[u8] = crate::api::h2::wire::CONNECTION_PREFACE;
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
            let take = (FrameHeader::BYTE_SIZE - have).min(chunk.len());
            self.header[have..have + take].copy_from_slice(&chunk[..take]);
            self.header_len += take as u8;
            chunk = &chunk[take..];
            if self.header_len as usize == FrameHeader::BYTE_SIZE {
                let header = FrameHeader::decode(&self.header);
                self.header_len = 0;
                self.remaining = header.length;
                // PUSH_PROMISE is not a FrameType variant (the inbound path matches it raw too).
                const PUSH_PROMISE: u8 = 0x05;
                if header.type_ == FrameType::HTTP_FRAME_HEADERS as u8
                    || header.type_ == PUSH_PROMISE
                    || header.type_ == FrameType::HTTP_FRAME_CONTINUATION as u8
                {
                    self.header_block_open =
                        header.flags & HeadersFrameFlags::END_HEADERS as u8 == 0;
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

/// A `&mut Stream` that only exists inside an armed dispatch scope (`enter_stream_dispatch`):
/// while it is live, rewrite_read defers stream frees, so user JS that re-enters `read()`
/// (option getters, header-value `toString`) cannot free the stream out from under the borrow.
struct GuardedStream<'a> {
    stream: &'a mut Stream,
    _dispatch: DispatchGuard<'a>,
}

impl core::ops::Deref for GuardedStream<'_> {
    type Target = Stream;
    fn deref(&self) -> &Stream {
        self.stream
    }
}

impl core::ops::DerefMut for GuardedStream<'_> {
    fn deref_mut(&mut self) -> &mut Stream {
        self.stream
    }
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut H2FrameParser` until Phase 1 lands —
// `&mut T` auto-derefs to `&T` so the impls below compile against either.
#[bun_jsc::JsClass]
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::release)]
pub struct H2FrameParser {
    strong_this: JsCell<JsRef>,
    global_this: GlobalRef, // JSC_BORROW — read-only after construction
    // allocator field dropped — global mimalloc
    handlers: JsCell<Handlers>,
    native_socket: NativeSocket,
    local_settings: Cell<FullSettingsPayload>,
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
    /// Constructor-time SETTINGS_MAX_HEADER_LIST_SIZE, used to seed the engine's enforcement
    /// limit when it is created lazily (nghttp2 only applies submitted local settings on ACK, so
    /// a header block already in flight when the limit is lowered must not be rejected; the
    /// engine raises/lowers its own limit as ACKs arrive).
    enforced_max_header_list_size: Cell<u32>,
    // only available after receiving settings or ACK
    remote_settings: Cell<Option<FullSettingsPayload>>,

    // local Window limits the download of data
    // current window size for the connection
    window_size: Cell<u64>,
    // used window size for the connection
    used_window_size: Cell<u64>,

    // remote Window limits the upload of data
    // remote window size for the connection
    remote_window_size: Cell<u64>,
    // remote used window size for the connection
    remote_used_window_size: Cell<u64>,

    max_header_list_pairs: Cell<u32>,
    /// node maxSettings session option: maximum entries accepted in a single SETTINGS frame.
    max_settings: Cell<u32>,
    /// Receive-window growth requested by setLocalWindowSize() while a dispatch held the engine
    /// borrow; applied by rewrite_read() on its next pass.
    pending_recv_window_growth: Cell<i64>,
    /// Bridge: outbound DATA bytes the legacy encoder wrote since the engine last ran, applied to
    /// the engine's connection-level send window in rewrite_read (the engine cell may be borrowed
    /// when the DATA goes out). Without this the engine's window only ever grows and a compliant
    /// peer's cumulative WINDOW_UPDATEs would eventually trip the §6.9.1 overflow error.
    pending_send_window_consumed: Cell<u64>,
    /// Same bridge per stream: (stream id, bytes) pairs drained into the engine's per-stream send
    /// windows in rewrite_read.
    pending_stream_send_consumed: JsCell<Vec<(u32, u64)>>,
    /// Local-settings snapshot of each SETTINGS frame the legacy encoder sent, in send order,
    /// drained into the engine's per-SETTINGS ack queue in rewrite_read (§6.5.3: ACKs apply in
    /// order).
    pending_settings_window_submissions:
        JsCell<Vec<crate::api::h2::connection::PendingLocalSettings>>,
    /// Stream ids whose legacy-side lifecycle finished while a dispatch held the engine
    /// borrow (the normal request path: receive() -> JS handler -> respond -> END_STREAM).
    /// Drained into Connection::close_stream on the next rewrite_read batch.
    pending_engine_stream_closes: JsCell<Vec<u32>>,
    dispatch_depth: Cell<u32>,
    max_rejected_streams: Cell<u32>,
    max_session_invalid_frames: Cell<u32>,
    max_outstanding_settings: Cell<u32>,
    outstanding_settings: Cell<u32>,
    rejected_streams: Cell<u32>,
    max_session_memory: Cell<u32>, // this limit is in MB
    queued_data_size: Cell<u64>,   // this is in bytes
    max_outstanding_pings: Cell<u64>,
    out_standing_pings: Cell<u64>,
    max_send_header_block_length: Cell<u32>,
    /// node strictSingleValueFields session option (default true): when false, duplicate
    /// single-value headers and array values for them are encoded as-is instead of rejected.
    strict_single_value_fields: Cell<bool>,
    last_stream_id: Cell<u32>,
    /// Highest PEER-initiated stream id processed (odd ids for a server, even for a
    /// client). This — not `last_stream_id` — is what an auto-filled GOAWAY must carry:
    /// RFC 9113 §6.8 last_stream_id refers to streams the RECEIVER initiated, and
    /// nghttp2 servers reject a GOAWAY naming a client-initiated id with a connection
    /// PROTOCOL_ERROR (node's last_proc_stream_id semantics).
    last_peer_stream_id: Cell<u32>,
    is_server: Cell<bool>,
    /// A frame callback left an exception pending in this batch (`Sink::should_stop`).
    left_exception: Cell<bool>,
    // we buffer requests until we get the first settings ACK
    write_buffer: JsCell<Vec<u8>>,
    write_buffer_offset: Cell<usize>,
    // TODO: this will be removed when I re-add header and data priorization
    outbound_queue_size: Cell<usize>,

    streams: JsCell<BunHashMap<u32, *mut Stream>>,

    hpack: JsCell<Option<lshpack::HpackHandle>>,

    has_nonnative_backpressure: Cell<bool>,
    /// True while flush() has bytes out in an onWrite dispatch to a JS-backed socket.
    js_socket_flushing: Cell<bool>,
    /// A native write returned a terminal result (socket closed, shut down, or the kernel
    /// rejected the send). Latched once; the deferred tick closes the transport.
    transport_write_fatal: Cell<bool>,
    /// An outbound header block the HPACK encoder could not emit. Latched once; the deferred
    /// tick reports it, because it is detected inside a user submit call.
    pending_header_compression_error: Cell<bool>,
    /// Frames written by the legacy outbound encoder (perf_hooks http2 session stats).
    frames_sent_legacy: Cell<u64>,
    /// Engine counters mirrored at the end of each rewrite_read batch, so reading them
    /// never contends with the engine borrow.
    engine_frames_received: Cell<u64>,
    engine_frames_sent: Cell<u64>,
    /// Where the bytes emitted through `write()` over a JS-backed transport stand relative to
    /// frame and header-block boundaries.
    tx_tracker: Cell<TxFrameTracker>,
    ref_count: bun_ptr::RefCount<Self>, // intrusive — bun.ptr.RefCount(@This(), "ref_count", deinit, .{})
    /// Number of live `Keepalive` guards: the `+1`s held by native frames currently on the stack.
    /// Read only by `release_refs_stranded_by_exit()`.
    native_keepalives: Cell<u32>,

    auto_flusher: JsCell<AutoFlusher>,
    padding_strategy: Cell<PaddingStrategy>,

    // ---- from-scratch rewrite engine (src/runtime/api/bun/h2) ----
    // The fields above are the legacy frame state being retired; read()/host functions will route
    // through `engine` instead. `None` until configured with is_server + settings.
    engine: core::cell::RefCell<Option<crate::api::h2::connection::Connection>>,
    /// Unconsumed inbound tail (the engine holds no reassembly buffer — design B): bytes after the
    /// last complete frame are kept here and prepended to the next read().
    rewrite_tail: JsCell<Vec<u8>>,
    /// Promised stream id whose PUSH_PROMISE header block is being delivered by the engine (its
    /// on_headers_complete dispatches onStreamPush instead of onStreamHeaders).
    rewrite_pending_push: Cell<u32>,
    /// stream id -> JS stream context object, for the rewrite engine's Sink callbacks.
    sctx: JsCell<BunHashMap<u32, StrongOptional>>,
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

/// The streams hashmap may mutate when growing we use this when we need to make sure its safe to iterate over it
///
/// `bun_collections::HashMap` is backed by `std::collections::HashMap`, which
/// exposes no bucket index and randomises iteration order on every mutation,
/// so iterating while mutating is not possible directly. Instead we snapshot
/// the stream IDs at `init` and re-look-up
/// each one on demand: streams removed mid-loop are skipped, streams added
/// mid-loop are not visited, and nothing is yielded twice. That's the
/// guarantee the call sites actually rely on (flush / emit-to-all / detach).
pub(crate) struct StreamResumableIterator {
    // Note: `streams`
    // is `JsCell`-backed, so a shared backref suffices and the in-loop
    // body can keep its own `&H2FrameParser` without provenance gymnastics.
    // `ParentRef` encapsulates the back-pointer invariant (parser outlives the
    // iterator — every call site constructs the iterator from a live `&Self`
    // and drains it in the same scope) so `next()` derefs through safe `Deref`.
    parser: bun_ptr::ParentRef<H2FrameParser>,
    ids: Vec<u32>,
    index: usize,
}
impl StreamResumableIterator {
    pub(crate) fn init(parser: &H2FrameParser) -> Self {
        let ids = parser.streams.get().keys().copied().collect();
        Self {
            parser: bun_ptr::ParentRef::new(parser),
            ids,
            index: 0,
        }
    }
    pub(crate) fn next(&mut self) -> Option<*mut Stream> {
        // R-2: `streams` is `JsCell`-backed (UnsafeCell), so the shared backref
        // read here coexists soundly with the loop body's own `&self` accesses.
        let streams = self.parser.streams.get();
        while let Some(&id) = self.ids.get(self.index) {
            self.index += 1;
            if let Some(&stream) = streams.get(&id) {
                return Some(stream);
            }
        }
        None
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FlushState {
    NoAction,
    Flushed,
    Backpressure,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum StreamState {
    IDLE = 1,
    OPEN = 2,
    HALF_CLOSED_LOCAL = 5,
    HALF_CLOSED_REMOTE = 6,
    CLOSED = 7,
}

pub struct Stream {
    id: u32,
    state: StreamState,
    js_context: StrongOptional, // jsc.Strong.Optional
    wait_for_trailers: bool,
    end_after_headers: bool,
    padding_strategy: PaddingStrategy,
    rst_code: u32,
    stream_dependency: u32,
    exclusive: bool,
    weight: u16,
    // current window size for the stream
    window_size: u64,
    // used window size for the stream
    used_window_size: u64,
    // remote window size for the stream
    remote_window_size: u64,
    // remote used window size for the stream
    remote_used_window_size: u64,
    signal: Option<Box<SignalRef>>,
    // The JS readable for this stream is paused (setStreamReading(id, false)): the engine defers
    // replenishing the stream's receive window until reading resumes, backpressuring the peer.
    reading_paused: bool,

    // when we have backpressure we queue the data e round robin the Streams
    data_frame_queue: PendingQueue,
}

pub(crate) struct SignalRef {
    signal: bun_jsc::AbortSignalRef,
    // TODO: We should not need this ref counting here, since Parser owns Stream
    parser: RefPtr<H2FrameParser>,
    stream_id: u32,
}

impl SignalRef {
    pub(crate) fn is_aborted(&self) -> bool {
        self.signal.aborted()
    }

    pub(crate) fn abort_listener(this: &mut SignalRef, reason: JSValue) {
        bun_output::scoped_log!(H2FrameParser, "abortListener");
        reason.ensure_still_alive();
        let parser = &*this.parser;
        let Some(stream) = parser.streams.get().get(&this.stream_id).copied() else {
            return;
        };
        // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
        let stream = unsafe { &mut *stream };
        if stream.state != StreamState::CLOSED {
            let wrapped = Bun__wrapAbortError(&parser.global_this, reason);
            parser.abort_stream(stream, wrapped);
        }
    }
}

impl Drop for SignalRef {
    fn drop(&mut self) {
        // Release our listener; dropping `signal` then unrefs it.
        let this = std::ptr::from_mut(self).cast::<c_void>();
        self.signal.clean_native_bindings(this);
    }
}

#[derive(Default)]
struct PendingQueue {
    data: Vec<PendingFrame>,
    front: usize,
    len: usize,
}

impl PendingQueue {
    pub(crate) fn enqueue(&mut self, value: PendingFrame) {
        self.data.push(value);
        self.len += 1;
        bun_output::scoped_log!(H2FrameParser, "PendingQueue.enqueue {}", self.len);
    }

    pub(crate) fn peek_last(&mut self) -> Option<&mut PendingFrame> {
        if self.len == 0 {
            return None;
        }
        let last = self.data.len() - 1;
        Some(&mut self.data[last])
    }

    pub(crate) fn peek_front(&mut self) -> Option<&mut PendingFrame> {
        if self.len == 0 {
            return None;
        }
        Some(&mut self.data[self.front])
    }

    pub(crate) fn dequeue(&mut self) -> Option<PendingFrame> {
        if self.len == 0 {
            bun_output::scoped_log!(H2FrameParser, "PendingQueue.dequeue null");
            return None;
        }
        let value = core::mem::take(&mut self.data[self.front]);
        self.len -= 1;
        if self.len == 0 {
            self.front = 0;
            self.data.clear();
        } else {
            self.front += 1;
        }
        bun_output::scoped_log!(H2FrameParser, "PendingQueue.dequeue {}", self.len);
        Some(value)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.len == 0
    }
}

// PendingQueue::deinit handled by Drop on Vec<PendingFrame>

#[derive(Default)]
struct PendingFrame {
    end_stream: bool,         // end_stream flag
    len: u32,                 // actually payload size
    offset: u32,              // offset into the buffer (if partial flush due to flow control)
    buffer: Vec<u8>,          // allocated buffer if len > 0
    callback: StrongOptional, // JSCallback for done
}

impl PendingFrame {
    pub(crate) fn slice(&self) -> &[u8] {
        &self.buffer[self.offset as usize..self.len as usize]
    }
}

// PendingFrame::deinit handled by Drop (Vec frees, Strong deinits)

impl Stream {
    pub fn get_padding(&self, frame_len: usize, max_len: usize) -> u8 {
        match self.padding_strategy {
            PaddingStrategy::None => 0,
            PaddingStrategy::Aligned => {
                let diff = (frame_len + 9) % 8;
                // already multiple of 8
                if diff == 0 {
                    return 0;
                }
                let mut padded_len = frame_len + (8 - diff);
                // limit to maxLen
                padded_len = padded_len.min(max_len);
                padded_len.saturating_sub(frame_len).min(255) as u8
            }
            PaddingStrategy::Max => max_len.saturating_sub(frame_len).min(255) as u8,
        }
    }

    pub fn flush_queue(&mut self, client: &H2FrameParser, written: &mut usize) -> FlushState {
        if !self.can_send_data() {
            // empty or cannot send data
            return FlushState::NoAction;
        }
        // try to flush one frame
        let Some(front) = self.data_frame_queue.peek_front() else {
            return FlushState::NoAction;
        };
        let frame_len = front.len;
        let frame_remaining = front.slice().len();

        let mut owned_frame: Option<PendingFrame> = None;
        let no_backpressure: bool = 'brk: {
            let mut writer = client.to_writer();

            if frame_len == 0 {
                // flush a zero payload frame
                let Some(frame) = self.data_frame_queue.dequeue() else {
                    return FlushState::NoAction;
                };
                let data_header = FrameHeader {
                    type_: FrameType::HTTP_FRAME_DATA as u8,
                    flags: if frame.end_stream && !self.wait_for_trailers {
                        DataFrameFlags::END_STREAM as u8
                    } else {
                        0
                    },
                    stream_identifier: self.id,
                    length: 0,
                };
                owned_frame = Some(frame);
                break 'brk data_header.write(&mut writer, &client.frames_sent_legacy);
            } else {
                let max_size = frame_remaining
                    .min(
                        (self
                            .remote_window_size
                            .saturating_sub(self.remote_used_window_size))
                            as usize,
                    )
                    .min(
                        (client
                            .remote_window_size
                            .get()
                            .saturating_sub(client.remote_used_window_size.get()))
                            as usize,
                    )
                    .min(MAX_PAYLOAD_SIZE_WITHOUT_FRAME);
                if max_size == 0 {
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "dataFrame flow control limited {} {} {} {} {} {}",
                        frame_remaining,
                        self.remote_window_size,
                        self.remote_used_window_size,
                        client.remote_window_size.get(),
                        client.remote_used_window_size.get(),
                        max_size
                    );
                    // we are flow control limited lets return backpressure if is limited in the connection so we short circuit the flush
                    return if client.remote_window_size.get()
                        == client.remote_used_window_size.get()
                    {
                        FlushState::Backpressure
                    } else {
                        FlushState::NoAction
                    };
                }
                if max_size < frame_remaining {
                    // we need to break the frame into smaller chunks
                    let Some(frame) = self.data_frame_queue.peek_front() else {
                        return FlushState::NoAction;
                    };
                    let able_to_send = frame.slice()[0..max_size].to_vec();
                    frame.offset += u32::try_from(max_size).expect("int cast");
                    client
                        .queued_data_size
                        .set(client.queued_data_size.get() - able_to_send.len() as u64);
                    *written += able_to_send.len();

                    let padding = self.get_padding(able_to_send.len(), max_size - 1);
                    let payload_size = able_to_send.len()
                        + if padding != 0 {
                            padding as usize + 1
                        } else {
                            0
                        };
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "padding: {} size: {} max_size: {} payload_size: {}",
                        padding,
                        able_to_send.len(),
                        max_size,
                        payload_size
                    );
                    self.remote_used_window_size += payload_size as u64;
                    client
                        .remote_used_window_size
                        .set(client.remote_used_window_size.get() + payload_size as u64);
                    client.note_engine_send_consumed(self.id, payload_size as u64);

                    let mut flags: u8 = 0; // we ignore end_stream for now because we know we have more data to send
                    if padding != 0 {
                        flags |= DataFrameFlags::PADDED as u8;
                    }
                    let data_header = FrameHeader {
                        type_: FrameType::HTTP_FRAME_DATA as u8,
                        flags,
                        stream_identifier: self.id,
                        length: u32::try_from(payload_size).expect("int cast"),
                    };
                    let _ = data_header.write(&mut writer, &client.frames_sent_legacy);
                    if padding != 0 {
                        break 'brk writer.write_padded(&able_to_send, padding).is_ok();
                    } else {
                        break 'brk writer.write_all(&able_to_send).is_ok();
                    }
                } else {
                    // flush with some payload
                    owned_frame = self.data_frame_queue.dequeue();
                    let Some(frame) = owned_frame.as_ref() else {
                        return FlushState::NoAction;
                    };
                    let frame_slice: &[u8] = frame.slice();
                    client
                        .queued_data_size
                        .set(client.queued_data_size.get() - frame_slice.len() as u64);
                    *written += frame_slice.len();

                    let padding = self.get_padding(frame_slice.len(), max_size - 1);
                    let payload_size = frame_slice.len()
                        + if padding != 0 {
                            padding as usize + 1
                        } else {
                            0
                        };
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "padding: {} size: {} max_size: {} payload_size: {}",
                        padding,
                        frame_slice.len(),
                        max_size,
                        payload_size
                    );
                    self.remote_used_window_size += payload_size as u64;
                    client
                        .remote_used_window_size
                        .set(client.remote_used_window_size.get() + payload_size as u64);
                    client.note_engine_send_consumed(self.id, payload_size as u64);
                    let mut flags: u8 = if frame.end_stream && !self.wait_for_trailers {
                        DataFrameFlags::END_STREAM as u8
                    } else {
                        0
                    };
                    if padding != 0 {
                        flags |= DataFrameFlags::PADDED as u8;
                    }
                    let data_header = FrameHeader {
                        type_: FrameType::HTTP_FRAME_DATA as u8,
                        flags,
                        stream_identifier: self.id,
                        length: u32::try_from(payload_size).expect("int cast"),
                    };
                    let _ = data_header.write(&mut writer, &client.frames_sent_legacy);
                    if padding != 0 {
                        break 'brk writer.write_padded(frame_slice, padding).is_ok();
                    } else {
                        break 'brk writer.write_all(frame_slice).is_ok();
                    }
                }
            }
        };

        if let Some(_frame) = owned_frame {
            // only call the callback + free the frame if we write to the socket the full frame
            client
                .outbound_queue_size
                .set(client.outbound_queue_size.get() - 1);

            if let Some(callback_value) = _frame.callback.get() {
                client.dispatch_write_callback(callback_value);
            }
            if self.data_frame_queue.is_empty() {
                if _frame.end_stream {
                    if self.wait_for_trailers {
                        client.dispatch(JSH2FrameParser::Gc::onWantTrailers, self.get_identifier());
                    } else {
                        let identifier = self.get_identifier();
                        identifier.ensure_still_alive();
                        if self.state == StreamState::HALF_CLOSED_REMOTE {
                            self.state = StreamState::CLOSED;
                            self.free_resources::<false>(client);
                        } else {
                            self.state = StreamState::HALF_CLOSED_LOCAL;
                        }
                        client.dispatch_with_extra(
                            JSH2FrameParser::Gc::onStreamEnd,
                            identifier,
                            JSValue::js_number(self.state as u8 as f64),
                        );
                    }
                }
            }
            drop(_frame);
        }

        if no_backpressure {
            FlushState::Flushed
        } else {
            FlushState::Backpressure
        }
    }

    pub fn queue_frame(
        &mut self,
        client: &H2FrameParser,
        bytes: &[u8],
        callback: JSValue,
        end_stream: bool,
    ) {
        let global_this = client.global_this;

        // Note: `dispatch_write_callback()` below re-enters JS, which can
        // call back into `H2FrameParser` host-fns (e.g. `writeStream`) that
        // look this `Stream` up by id from `client.streams` and reach
        // `queue_frame()` again with a fresh `&mut Stream` aliasing this one.
        // R-2: `client` is now `&H2FrameParser` (UnsafeCell-backed fields), so
        // the parser-side noalias miscompile is structurally impossible. The
        // `Stream`-side `&mut self` alias across re-entry remains; keep the
        // `black_box` launder on `self`/`last_frame` as defense-in-depth until
        // `Stream` itself is celled.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` is the live `&mut self` payload; no other `&` to
        // `*this` exists between here and the dispatch call.
        if let Some(last_frame_ref) = unsafe { (*this).data_frame_queue.peek_last() } {
            // Raw, opaque-provenance pointer for post-dispatch accesses.
            let last_frame: *mut PendingFrame =
                core::hint::black_box(core::ptr::from_mut(last_frame_ref));
            // SAFETY: helper for the pre-dispatch accesses below; `last_frame`
            // is the unique tail slot in `self.data_frame_queue.data`, valid
            // until the dispatch call (after which we re-`black_box` before
            // every access — see note above).
            macro_rules! lf {
                () => {
                    // SAFETY: `last_frame` points at the live tail slot of
                    // `self.data_frame_queue`; provenance is re-laundered via
                    // `black_box` before each post-dispatch expansion so no
                    // other `&mut` to the slot is live here (see note).
                    unsafe { &mut *last_frame }
                };
            }
            if bytes.is_empty() {
                // just merge the end_stream
                lf!().end_stream = end_stream;
                // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                // this is fine is like a per-stream CORKING in a frame level
                let old_callback = core::mem::replace(
                    &mut lf!().callback,
                    StrongOptional::create(callback, &global_this),
                );
                if let Some(old_callback_value) = old_callback.get() {
                    // Escape `this` so a self-derived address is observable
                    // across the opaque JS call (belt-and-suspenders; either
                    // launder alone defeats the caching).
                    core::hint::black_box(this);
                    client.dispatch_write_callback(old_callback_value);
                }
                drop(old_callback);
                return;
            }
            if lf!().len == 0 {
                // we have an empty frame with means we can just use this frame with a new buffer
                lf!().buffer = Vec::with_capacity(MAX_PAYLOAD_SIZE_WITHOUT_FRAME);
            }
            let max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME as u32;
            let remaining = max_size - lf!().len;
            if remaining > 0 {
                // ok we can cork frames
                let consumed_len = (remaining as usize).min(bytes.len());
                let merge = &bytes[0..consumed_len];
                lf!().buffer.extend_from_slice(merge);
                lf!().len += u32::try_from(consumed_len).expect("int cast");
                bun_output::scoped_log!(H2FrameParser, "dataFrame merged {}", consumed_len);

                client
                    .queued_data_size
                    .set(client.queued_data_size.get() + consumed_len as u64);
                // lets fallthrough if we still have some data
                let more_data = &bytes[consumed_len..];
                if more_data.is_empty() {
                    lf!().end_stream = end_stream;
                    // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                    // this is fine is like a per-stream CORKING in a frame level
                    let old_callback = core::mem::replace(
                        &mut lf!().callback,
                        StrongOptional::create(callback, &global_this),
                    );
                    if let Some(old_callback_value) = old_callback.get() {
                        core::hint::black_box(this);
                        client.dispatch_write_callback(old_callback_value);
                    }
                    drop(old_callback);
                    return;
                }
                // we keep the old callback because the new will be part of another frame
                // SAFETY: `this` is the live `&mut self`; no borrow of `*this`
                // is held here (the `last_frame` raw pointer is unused past
                // this point).
                return unsafe { (*this).queue_frame(client, more_data, callback, end_stream) };
            }
        }
        bun_output::scoped_log!(
            H2FrameParser,
            "{} queued {} {}",
            if client.is_server.get() {
                "server"
            } else {
                "client"
            },
            bytes.len(),
            end_stream
        );

        let frame = PendingFrame {
            end_stream,
            len: u32::try_from(bytes.len()).expect("int cast"),
            offset: 0,
            // we need to clone this data to send it later
            buffer: if bytes.is_empty() {
                Vec::new()
            } else {
                // Full-frame capacity so later writes cork into this frame without reallocating.
                let mut buffer = Vec::with_capacity(MAX_PAYLOAD_SIZE_WITHOUT_FRAME);
                buffer.extend_from_slice(bytes);
                buffer
            },
            callback: if callback.is_callable() {
                StrongOptional::create(callback, &global_this)
            } else {
                StrongOptional::empty()
            },
        };
        if !bytes.is_empty() {
            global_this.vm().deprecated_report_extra_memory(bytes.len());
        }
        bun_output::scoped_log!(H2FrameParser, "dataFrame enqueued {}", frame.len);
        self.data_frame_queue.enqueue(frame);
        client
            .outbound_queue_size
            .set(client.outbound_queue_size.get() + 1);
        client
            .queued_data_size
            .set(client.queued_data_size.get() + bytes.len() as u64);
    }

    pub fn init(
        stream_identifier: u32,
        initial_window_size: u32,
        remote_window_size: u32,
        padding_strategy: PaddingStrategy,
    ) -> Stream {
        Stream {
            id: stream_identifier,
            state: StreamState::OPEN,
            js_context: StrongOptional::empty(),
            wait_for_trailers: false,
            end_after_headers: false,
            padding_strategy,
            rst_code: 0,
            stream_dependency: 0,
            exclusive: false,
            // RFC 7540 §5.3.5 / nghttp2 NGHTTP2_DEFAULT_WEIGHT: streams default to weight 16,
            // which is what stream.state.weight reports when no priority was signaled.
            weight: 16,
            window_size: initial_window_size as u64,
            used_window_size: 0,
            remote_window_size: remote_window_size as u64,
            remote_used_window_size: 0,
            signal: None,
            reading_paused: false,
            data_frame_queue: PendingQueue::default(),
        }
    }

    /// Returns true if the stream can still receive data from the remote peer.
    /// Per RFC 7540 Section 5.1:
    /// - OPEN: both endpoints can send and receive
    /// - HALF_CLOSED_LOCAL: local sent END_STREAM, but can still receive from remote
    /// - HALF_CLOSED_REMOTE: remote sent END_STREAM, no more data to receive
    /// - CLOSED: stream is finished
    pub fn can_receive_data(&self) -> bool {
        matches!(
            self.state,
            StreamState::IDLE | StreamState::OPEN | StreamState::HALF_CLOSED_LOCAL
        )
    }

    pub fn can_send_data(&self) -> bool {
        matches!(
            self.state,
            StreamState::IDLE | StreamState::OPEN | StreamState::HALF_CLOSED_REMOTE
        )
    }

    pub fn set_context(&mut self, value: JSValue, global_object: &JSGlobalObject) {
        let old = core::mem::replace(
            &mut self.js_context,
            StrongOptional::create(value, global_object),
        );
        drop(old);
    }

    pub fn get_identifier(&self) -> JSValue {
        self.js_context
            .get()
            .unwrap_or_else(|| JSValue::js_number(self.id as f64))
    }

    pub fn attach_signal(&mut self, parser: &H2FrameParser, signal: &mut AbortSignal) {
        // we need a stable pointer to know what signal points to what stream_id + parser
        let mut signal_ref = Box::new(SignalRef {
            signal: signal.ref_(),
            parser: parser.ref_guard(),
            stream_id: self.id,
        });
        // `signal_ref` is heap-allocated and outlives the listener registration
        // (cleared via `detach` in `Drop for SignalRef`).
        signal.listen(&raw mut *signal_ref);
        self.signal = Some(signal_ref);
    }

    pub fn detach_context(&mut self) {
        self.js_context.deinit();
    }

    fn clean_queue<const FINALIZING: bool>(&mut self, client: &H2FrameParser) {
        bun_output::scoped_log!(
            H2FrameParser,
            "cleanQueue len: {} front: {} outboundQueueSize: {}",
            self.data_frame_queue.len,
            self.data_frame_queue.front,
            client.outbound_queue_size.get()
        );

        // dispatch_write_callback re-enters JS; a destroy there can drop the
        // socket's ref and free `client` between iterations. Not during
        // finalize: refcount is already 0 and a ref/deref would re-destroy.
        let _keepalive = (!FINALIZING).then(|| client.keepalive());
        let mut queue = core::mem::take(&mut self.data_frame_queue);
        while let Some(item) = queue.dequeue() {
            let frame = item;
            let len = frame.slice().len();
            bun_output::scoped_log!(H2FrameParser, "dataFrame dropped {}", len);
            client
                .queued_data_size
                .set(client.queued_data_size.get() - len as u64);
            if !FINALIZING {
                if let Some(callback_value) = frame.callback.get() {
                    client.dispatch_write_callback(callback_value);
                }
            }
            drop(frame);
            client
                .outbound_queue_size
                .set(client.outbound_queue_size.get() - 1);
        }
        // queue dropped here
    }

    /// this can be called multiple times
    pub fn free_resources<const FINALIZING: bool>(&mut self, client: &H2FrameParser) {
        // The rewrite engine only sees inbound traffic, so a completed request would leave
        // its engine entry as HalfClosedRemote and its legacy slot + Box behind forever —
        // one entry per request. Queue the id; the next rewrite_read batch evicts the engine
        // entry and frees the legacy slot. Always deferred: every caller still holds
        // `&mut Stream` into the map entry, and the engine cell may be mutably borrowed
        // (stream completing synchronously inside receive()).
        if !FINALIZING {
            client
                .pending_engine_stream_closes
                .with_mut(|v| v.push(self.id));
            // Release the engine-dispatch context root too; without this the Strong JS
            // stream object lives until the session dies.
            client.sctx.with_mut(|m| {
                m.remove(&self.id);
            });
        }
        self.detach_context();
        self.clean_queue::<FINALIZING>(client);
        if let Some(signal) = self.signal.take() {
            drop(signal);
        }
    }
}

// Route AbortSignal callbacks through the trait —
// `bun_jsc::abort_signal::listen` expects `*mut C: AbortListener`.
impl AbortListener for SignalRef {
    fn on_abort(&mut self, reason: JSValue) {
        SignalRef::abort_listener(self, reason);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — core methods
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    /// Encodes a single header into the ArrayList, growing if needed.
    /// Returns the number of bytes written, or error on failure.
    ///
    /// Capacity estimation: name.len + value.len + HPACK_ENTRY_OVERHEAD
    fn encode_header_into_list(
        &self,
        encoded_headers: &mut Vec<u8>,
        name: &[u8],
        value: &[u8],
        never_index: bool,
    ) -> crate::Result<usize> {
        let old_len = encoded_headers.len();
        let required = old_len + name.len() + value.len() + HPACK_ENTRY_OVERHEAD;
        // Note: materializing `&mut [u8]` over uninitialized capacity is UB and
        // hpack.encode() needs `&mut [u8]` (not `&mut [MaybeUninit<u8>]`), so zero-extend to
        // `required` first. On both Ok and Err we truncate so `len` never exposes scratch
        // bytes.
        encoded_headers.resize(required, 0);
        match self.encode(
            encoded_headers.as_mut_slice(),
            old_len,
            name,
            value,
            never_index,
        ) {
            Ok(bytes_written) => {
                encoded_headers.truncate(old_len + bytes_written);
                Ok(bytes_written)
            }
            Err(e) => {
                encoded_headers.truncate(old_len);
                Err(e)
            }
        }
    }

    pub(crate) fn encode(
        &self,
        dst_buffer: &mut [u8],
        dst_offset: usize,
        name: &[u8],
        value: &[u8],
        never_index: bool,
    ) -> crate::Result<usize> {
        self.hpack.with_mut(|hpack| {
            if let Some(hpack) = hpack.as_mut() {
                // lets make sure the name is lowercase
                return hpack
                    .encode(name, value, never_index, dst_buffer, dst_offset)
                    .map_err(crate::Error::from);
            }
            Err(crate::Error::UnableToEncode)
        })
    }

    /// Serialize the SETTINGS entries that go on the wire: only the standard parameters JS set
    /// explicitly plus any custom settings (node never serializes defaults — a session created
    /// with default options sends an empty SETTINGS frame). Returns the payload length.
    fn write_settings_payload(&self, out: &mut [u8; MAX_SETTINGS_PAYLOAD_SIZE]) -> usize {
        let s = self.local_settings.get();
        let mask = self.explicit_settings.get();
        let mut off = 0usize;
        let mut put = |out: &mut [u8; MAX_SETTINGS_PAYLOAD_SIZE], id: u16, value: u32| {
            out[off..off + 2].copy_from_slice(&id.to_be_bytes());
            out[off + 2..off + 6].copy_from_slice(&value.to_be_bytes());
            off += 6;
        };
        if mask & SETTING_BIT_HEADER_TABLE_SIZE != 0 {
            put(out, 0x1, s.header_table_size);
        }
        if mask & SETTING_BIT_ENABLE_PUSH != 0 {
            put(out, 0x2, s.enable_push);
        }
        if mask & SETTING_BIT_MAX_CONCURRENT_STREAMS != 0 {
            put(out, 0x3, s.max_concurrent_streams);
        }
        if mask & SETTING_BIT_INITIAL_WINDOW_SIZE != 0 {
            put(out, 0x4, s.initial_window_size);
        }
        if mask & SETTING_BIT_MAX_FRAME_SIZE != 0 {
            put(out, 0x5, s.max_frame_size);
        }
        if mask & SETTING_BIT_MAX_HEADER_LIST_SIZE != 0 {
            put(out, 0x6, s.max_header_list_size);
        }
        if mask & SETTING_BIT_ENABLE_CONNECT_PROTOCOL != 0 {
            put(out, 0x8, s.enable_connect_protocol);
        }
        for (id, value) in self.wire_custom_settings.get().iter() {
            put(out, *id, *value);
        }
        off
    }

    pub(crate) fn set_settings(&self, settings: FullSettingsPayload) -> bool {
        bun_output::scoped_log!(H2FrameParser, "HTTP_FRAME_SETTINGS ack false");

        if self.outstanding_settings.get() >= self.max_outstanding_settings.get() {
            self.send_go_away(
                0,
                ErrorCode::MAX_PENDING_SETTINGS_ACK,
                b"Maximum number of pending settings acknowledgements",
                self.last_stream_id.get(),
                true,
            );
            return false;
        }

        self.local_settings.set(settings);
        let mut payload = [0u8; MAX_SETTINGS_PAYLOAD_SIZE];
        let payload_len = self.write_settings_payload(&mut payload);

        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + MAX_SETTINGS_PAYLOAD_SIZE];
        let mut stream = FixedBufferStream::new(&mut buffer);
        let settings_header = FrameHeader {
            type_: FrameType::HTTP_FRAME_SETTINGS as u8,
            flags: 0,
            stream_identifier: 0,
            length: payload_len as u32,
        };
        let _ = settings_header.write(&mut stream, &self.frames_sent_legacy);
        let _ = stream.write_all(&payload[..payload_len]);

        self.outstanding_settings
            .set(self.outstanding_settings.get() + 1);

        // Remember which values this submission carries so the engine can attribute the peer's
        // ACK to it (§6.5.3 - ACKs apply to outstanding SETTINGS in order).
        self.pending_settings_window_submissions.with_mut(|v| {
            v.push(crate::api::h2::connection::PendingLocalSettings {
                settings: settings.to_engine_settings(),
            })
        });
        let _ = self.write(&buffer[..FrameHeader::BYTE_SIZE + payload_len]);
        true
    }

    pub(crate) fn abort_stream(&self, stream: &mut Stream, abort_reason: JSValue) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_RST_STREAM id: {} code: CANCEL",
            stream.id
        );

        abort_reason.ensure_still_alive();
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 4];
        let mut writer_stream = FixedBufferStream::new(&mut buffer);

        let frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_RST_STREAM as u8,
            flags: 0,
            stream_identifier: stream.id,
            length: 4,
        };
        let _ = frame.write(&mut writer_stream, &self.frames_sent_legacy);
        let mut value: u32 = ErrorCode::CANCEL.0;
        stream.rst_code = value;
        value = value.swap_bytes();
        let _ = writer_stream.write_all(&value.to_ne_bytes());
        let old_state = stream.state;
        stream.state = StreamState::CLOSED;
        let identifier = stream.get_identifier();
        identifier.ensure_still_alive();
        stream.free_resources::<false>(self);
        self.dispatch_with_2_extra(
            JSH2FrameParser::Gc::onAborted,
            identifier,
            abort_reason,
            JSValue::js_number(old_state as u8 as f64),
        );
        let _ = self.write(&buffer);
    }

    pub(crate) fn end_stream(&self, stream: &mut Stream, rst_code: ErrorCode) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_RST_STREAM id: {} code: {}",
            stream.id,
            rst_code.0
        );
        if stream.state == StreamState::CLOSED {
            return;
        }
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 4];
        let mut writer_stream = FixedBufferStream::new(&mut buffer);

        let frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_RST_STREAM as u8,
            flags: 0,
            stream_identifier: stream.id,
            length: 4,
        };
        let _ = frame.write(&mut writer_stream, &self.frames_sent_legacy);
        let mut value: u32 = rst_code.0;
        stream.rst_code = value;
        value = value.swap_bytes();
        let _ = writer_stream.write_all(&value.to_ne_bytes());

        stream.state = StreamState::CLOSED;
        let identifier = stream.get_identifier();
        identifier.ensure_still_alive();
        stream.free_resources::<false>(self);
        if rst_code == ErrorCode::NO_ERROR {
            self.dispatch_with_extra(
                JSH2FrameParser::Gc::onStreamEnd,
                identifier,
                JSValue::js_number(stream.state as u8 as f64),
            );
        } else {
            self.dispatch_with_extra(
                JSH2FrameParser::Gc::onStreamError,
                identifier,
                JSValue::js_number(rst_code.0 as f64),
            );
        }

        let _ = self.write(&buffer);
    }

    pub(crate) fn send_go_away(
        &self,
        triggering_stream_id: u32,
        rst_code: ErrorCode,
        debug_data: &[u8],
        last_stream_id: u32,
        emit_error: bool,
    ) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_GOAWAY {} code {} debug_data {} emitError {}",
            triggering_stream_id,
            rst_code.0,
            BStr::new(debug_data),
            emit_error
        );
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 8];
        let mut stream = FixedBufferStream::new(&mut buffer);

        // RFC 9113 section 6.8: GOAWAY frames are always sent on stream 0. A
        // GOAWAY with a non-zero stream identifier is itself a connection
        // error of type PROTOCOL_ERROR. The stream that triggered the GOAWAY
        // is only used for logging above; the last processed stream id goes in
        // the payload below.
        let frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_GOAWAY as u8,
            flags: 0,
            stream_identifier: 0,
            length: u32::try_from(8 + debug_data.len()).expect("int cast"),
        };
        let _ = frame.write(&mut stream, &self.frames_sent_legacy);
        let last_id = UInt31WithReserved::init(last_stream_id, false);
        let _ = last_id.write(&mut stream);
        let mut value: u32 = rst_code.0;
        value = value.swap_bytes();
        let _ = stream.write_all(&value.to_ne_bytes());

        let _ = self.write(&buffer);
        if !debug_data.is_empty() {
            let _ = self.write(debug_data);
        }
        let global = self.handlers.get().global();
        let chunk = match self.handlers.get().binary_type.to_js(debug_data, &global) {
            Ok(v) => v,
            Err(err) => {
                self.dispatch(
                    JSH2FrameParser::Gc::onError,
                    self.global().take_exception(err),
                );
                return;
            }
        };

        if emit_error {
            if rst_code != ErrorCode::NO_ERROR {
                self.dispatch_with_2_extra(
                    JSH2FrameParser::Gc::onError,
                    JSValue::js_number(rst_code.0 as f64),
                    JSValue::js_number(self.last_stream_id.get() as f64),
                    chunk,
                );
            }
            self.dispatch_with_extra(
                JSH2FrameParser::Gc::onEnd,
                JSValue::js_number(self.last_stream_id.get() as f64),
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

        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 2];
        let mut stream = FixedBufferStream::new(&mut buffer);

        let frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_ALTSVC as u8,
            flags: 0,
            stream_identifier,
            length: u32::try_from(origin_str.len() + alt.len() + 2).expect("int cast"),
        };
        let _ = frame.write(&mut stream, &self.frames_sent_legacy);
        let _ = stream.write_all(
            &u16::try_from(origin_str.len())
                .expect("int cast")
                .to_be_bytes(),
        );
        let _ = self.write(&buffer);
        if !origin_str.is_empty() {
            let _ = self.write(origin_str);
        }
        if !alt.is_empty() {
            let _ = self.write(alt);
        }
    }

    pub(crate) fn send_ping(&self, ack: bool, payload: &[u8]) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_PING ack {} payload {}",
            ack,
            BStr::new(payload)
        );

        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 8];
        let mut stream = FixedBufferStream::new(&mut buffer);
        if !ack {
            self.out_standing_pings
                .set(self.out_standing_pings.get() + 1);
        }
        let frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_PING as u8,
            flags: if ack { PingFrameFlags::ACK as u8 } else { 0 },
            stream_identifier: 0,
            length: 8,
        };
        let _ = frame.write(&mut stream, &self.frames_sent_legacy);
        let _ = stream.write_all(payload);
        let _ = self.write(&buffer);
    }

    pub(crate) fn send_preface_and_settings(&self) {
        bun_output::scoped_log!(H2FrameParser, "sendPrefaceAndSettings");
        // PREFACE + Settings Frame
        let mut payload = [0u8; MAX_SETTINGS_PAYLOAD_SIZE];
        let payload_len = self.write_settings_payload(&mut payload);
        let mut preface_buffer = [0u8; 24 + FrameHeader::BYTE_SIZE + MAX_SETTINGS_PAYLOAD_SIZE];
        let mut preface_stream = FixedBufferStream::new(&mut preface_buffer);
        let _ = preface_stream.write_all(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
        let settings_header = FrameHeader {
            type_: FrameType::HTTP_FRAME_SETTINGS as u8,
            flags: 0,
            stream_identifier: 0,
            length: payload_len as u32,
        };
        self.outstanding_settings
            .set(self.outstanding_settings.get() + 1);
        self.pending_settings_window_submissions.with_mut(|v| {
            v.push(crate::api::h2::connection::PendingLocalSettings {
                settings: self.local_settings.get().to_engine_settings(),
            })
        });
        let _ = settings_header.write(&mut preface_stream, &self.frames_sent_legacy);
        let _ = preface_stream.write_all(&payload[..payload_len]);
        let _ = self.write(&preface_buffer[..24 + FrameHeader::BYTE_SIZE + payload_len]);
    }

    pub(crate) fn send_window_update(
        &self,
        stream_identifier: u32,
        window_size: UInt31WithReserved,
    ) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_WINDOW_UPDATE stream {} size {}",
            stream_identifier,
            window_size.uint31()
        );
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 4];
        let mut stream = FixedBufferStream::new(&mut buffer);
        let settings_header = FrameHeader {
            type_: FrameType::HTTP_FRAME_WINDOW_UPDATE as u8,
            flags: 0,
            stream_identifier,
            length: 4,
        };
        let _ = settings_header.write(&mut stream, &self.frames_sent_legacy);
        let _ = window_size.write(&mut stream);
        let _ = self.write(&buffer);
    }

    /// Armed across every JS dispatch wrapper AND every section that holds a `&mut Stream`
    /// while user JS can run (property getters, iteration, string coercion), so
    /// rewrite_read's deferred stream free (pending_engine_stream_closes) only runs at depth 0.
    fn enter_dispatch(&self) -> DispatchGuard<'_> {
        self.dispatch_depth.set(self.dispatch_depth.get() + 1);
        DispatchGuard(&self.dispatch_depth)
    }

    /// Reborrows a host fn's `*mut Stream` with the dispatch guard armed for the borrow's whole
    /// lifetime: user JS the caller runs while holding it (option getters, `toString`) can
    /// re-enter `read()` without freeing the stream. Use this instead of a raw `&mut *ptr`.
    fn enter_stream_dispatch(&self, stream_ptr: *mut Stream) -> GuardedStream<'_> {
        let _dispatch = self.enter_dispatch();
        GuardedStream {
            // SAFETY: stream_ptr is the heap::alloc'd *mut Stream stored in self.streams; the
            // map entry outlives the returned borrow because the armed dispatch depth defers
            // the only free path (rewrite_read's pending close drain) while the guard is live.
            stream: unsafe { &mut *stream_ptr },
            _dispatch,
        }
    }

    pub(crate) fn dispatch(&self, event: JSH2FrameParser::Gc, value: JSValue) {
        value.ensure_still_alive();
        let Some(this_value) = self.strong_this.get().try_get() else {
            return;
        };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else {
            return;
        };
        let _dispatch = self.enter_dispatch();
        let _ = self.handlers.get().call_event_handler(
            event,
            this_value,
            ctx_value,
            &[ctx_value, value],
        );
    }

    pub(crate) fn call(&self, event: JSH2FrameParser::Gc, value: JSValue) -> JSValue {
        let Some(this_value) = self.strong_this.get().try_get() else {
            return JSValue::ZERO;
        };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else {
            return JSValue::ZERO;
        };
        value.ensure_still_alive();
        let _dispatch = self.enter_dispatch();
        self.handlers
            .get()
            .call_event_handler_with_result(event, this_value, &[ctx_value, value])
    }

    pub(crate) fn dispatch_write_callback(&self, callback: JSValue) {
        let _dispatch = self.enter_dispatch();
        let _ = self.handlers.get().call_write_callback(callback, &[]);
    }

    pub(crate) fn dispatch_with_extra(
        &self,
        event: JSH2FrameParser::Gc,
        value: JSValue,
        extra: JSValue,
    ) {
        let Some(this_value) = self.strong_this.get().try_get() else {
            return;
        };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else {
            return;
        };
        value.ensure_still_alive();
        extra.ensure_still_alive();
        let _dispatch = self.enter_dispatch();
        let _ = self.handlers.get().call_event_handler(
            event,
            this_value,
            ctx_value,
            &[ctx_value, value, extra],
        );
    }

    pub(crate) fn dispatch_with_2_extra(
        &self,
        event: JSH2FrameParser::Gc,
        value: JSValue,
        extra: JSValue,
        extra2: JSValue,
    ) {
        let Some(this_value) = self.strong_this.get().try_get() else {
            return;
        };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else {
            return;
        };
        value.ensure_still_alive();
        extra.ensure_still_alive();
        extra2.ensure_still_alive();
        let _dispatch = self.enter_dispatch();
        let _ = self.handlers.get().call_event_handler(
            event,
            this_value,
            ctx_value,
            &[ctx_value, value, extra, extra2],
        );
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

    pub(crate) fn generic_flush<S: NativeSocketWrite>(&self, mut socket: S) -> usize {
        let buffer_len = self.write_buffer.get().slice()[self.write_buffer_offset.get()..].len();
        if buffer_len > 0 {
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
        bun_output::scoped_log!(
            H2FrameParser,
            "flushStreamQueue {}",
            self.outbound_queue_size.get()
        );
        let mut written: usize = 0;
        let mut something_was_flushed = true;

        // try to send as much as we can until we reach backpressure or until we can't flush anymore
        while self.outbound_queue_size.get() > 0 && something_was_flushed {
            let mut it = StreamResumableIterator::init(self);
            something_was_flushed = false;
            while let Some(stream) = it.next() {
                // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the
                // map entry exists. Separate heap allocation from `self`, so no aliasing.
                let stream = unsafe { &mut *stream };
                // reach backpressure
                let result = stream.flush_queue(self, &mut written);
                match result {
                    FlushState::Flushed => something_was_flushed = true,
                    FlushState::NoAction => continue, // we can continue
                    FlushState::Backpressure => return written, // backpressure we need to return
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
                    let global = self.handlers.get().global();
                    // A failed conversion means the VM is terminating (or OOM): report
                    // nothing flushed instead of calling JS with an empty value.
                    let Ok(output_value) = self
                        .handlers
                        .get()
                        .binary_type
                        .to_js(&self.write_buffer.get().slice()[offset..], &global)
                    else {
                        return 0;
                    };
                    self.js_socket_flushing.set(true);
                    let result = self.call(JSH2FrameParser::Gc::onWrite, output_value);
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
                let code = match self
                    .handlers
                    .get()
                    .binary_type
                    .to_js(bytes, &self.handlers.get().global())
                {
                    Ok(output_value) => {
                        let result = self.call(JSH2FrameParser::Gc::onWrite, output_value);
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

    /// Whether a write to this session's transport synchronously runs user JS: a JS-backed
    /// socket's onWrite is the user's Duplex, and a socket upgraded from a JS Duplex
    /// (`tls.connect({ socket })`) writes its records through that Duplex.
    fn transport_write_runs_js(&self) -> bool {
        match self.native_socket.get() {
            BunSocket::None => true,
            BunSocket::Tls(s) | BunSocket::TlsWriteonly(s) => matches!(
                s.get().socket.get().socket,
                bun_uws::InternalSocket::UpgradedDuplex(_)
            ),
            BunSocket::Tcp(s) | BunSocket::TcpWriteonly(s) => matches!(
                s.get().socket.get().socket,
                bun_uws::InternalSocket::UpgradedDuplex(_)
            ),
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
    /// alone entirely - the connect-error path owns their failure delivery, and closing
    /// a semi-connected socket runs no terminal callback (stranding its refs, see the
    /// close host_fn in socket_body).
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

    fn close_socket_for_dead_transport<const SSL: bool>(socket: &crate::socket::NewSocket<SSL>) {
        let handler = socket.socket.get();
        if !handler.is_established() {
            return;
        }
        handler.close(bun_uws::CloseCode::Normal);
    }

    pub(crate) fn on_auto_flush(&self) -> bool {
        let _keepalive = self.keepalive();
        if self.transport_write_fatal.get() {
            // Returning `false` makes DeferredTaskQueue::run remove the entry
            // itself, so only the registration's flag and ref are released here
            // - never a re-entrant map mutation from inside run(). The flag is
            // cleared before the close so the teardown paths the close re-enters
            // (detach -> unregister_auto_flush) see an unregistered flusher and
            // early-return instead of removing a map entry run() still owns.
            self.auto_flusher.get().registered.set(false);
            self.deref();
            // An empty write buffer here means a later write in the same flush()
            // cycle already drained the bytes the failing send left behind (racy
            // one-off errnos, e.g. macOS EPROTOTYPE) - the transport recovered.
            if self.has_backpressure() {
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
                JSH2FrameParser::Gc::onError,
                JSValue::js_number(ErrorCode::COMPRESSION_ERROR.0 as f64),
                JSValue::js_number(self.last_stream_id.get() as f64),
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
    /// moved out before _write — it can re-enter JS (JS-stream-backed sockets) and no
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
        if matches!(self.native_socket.get(), BunSocket::None) {
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
            // The flush's _write can re-enter JS and re-cork a different parser;
            // re-assert ownership before touching the shared cork state again.
            self.cork();
            bytes = &bytes[avail..];
        }
    }

    /// `write()` for a session with no native socket, whose bytes reach the wire through the
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
        TLSSocket::write_maybe_corked(*self, buf)
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

    fn string_or_empty_to_js(&self, payload: &[u8]) -> JsResult<JSValue> {
        let global = self.handlers.get().global();
        bun_string_jsc::create_utf8_for_js(&global, payload)
    }

    /// Returned *Stream is heap-allocated and stable for the lifetime of this H2FrameParser.
    fn handle_received_stream_id(&self, stream_identifier: u32) -> Option<*mut Stream> {
        // connection stream
        if stream_identifier == 0 {
            return None;
        }

        // already exists
        if let Some(stream) = self.streams.get().get(&stream_identifier).copied() {
            return Some(stream);
        }

        if stream_identifier > self.last_stream_id.get() {
            self.last_stream_id.set(stream_identifier);
        }
        let peer_parity: u32 = if self.is_server.get() { 1 } else { 0 };
        if stream_identifier % 2 == peer_parity
            && stream_identifier > self.last_peer_stream_id.get()
        {
            self.last_peer_stream_id.set(stream_identifier);
        }

        // new stream open
        let local_window_size = if self.outstanding_settings.get() > 0 {
            DEFAULT_WINDOW_SIZE as u32
        } else {
            self.local_settings.get().initial_window_size
        };
        let stream = bun_core::heap::into_raw(Box::new(Stream::init(
            stream_identifier,
            local_window_size,
            self.remote_settings
                .get()
                .map(|s| s.initial_window_size)
                .unwrap_or(DEFAULT_WINDOW_SIZE as u32),
            self.padding_strategy.get(),
        )));
        self.streams
            .with_mut(|s| s.insert(stream_identifier, stream));

        let Some(this_value) = self.strong_this.get().try_get() else {
            return Some(stream);
        };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else {
            return Some(stream);
        };
        let Some(callback) = JSH2FrameParser::Gc::onStreamStart.get(this_value) else {
            return Some(stream);
        };

        let global = self.handlers.get().global();
        // The callback runs arbitrary JS while `stream` is held (here and by every
        // caller): arm the dispatch guard so a reentrant read() cannot free the box at
        // depth 0. Bare guard, not enter_stream_dispatch — rst_stream reached from the
        // callback takes its own `&mut` to this stream, so ours must wait for the return.
        let _dispatch = self.enter_dispatch();
        // A top-level call of its own: a throwing `streamStart` is reported and
        // yields no stream object. Called bare (no scope of its own, so no
        // checkpoint per stream on the socket path); the parser drive is the
        // landing frame that folds it.
        if global.has_exception() {
            return Some(stream);
        }
        let returned = match callback.call(
            &global,
            ctx_value,
            &[ctx_value, JSValue::js_number(stream_identifier as f64)],
        ) {
            Ok(v) => v,
            Err(err) => {
                crate::dispatch::fold(Err(err));
                JSValue::ZERO
            }
        };
        // streamStart returns the JS stream it created; storing it here saves the
        // setStreamContext host call the JS layer used to make per stream.
        // Skipped when the callback closed the stream: free_resources dropped its
        // sctx root, and re-rooting would pin the dead JS stream until session death.
        if returned.is_object()
            && !self
                .pending_engine_stream_closes
                .get()
                .contains(&stream_identifier)
        {
            self.sctx.with_mut(|m| {
                m.insert(stream_identifier, StrongOptional::create(returned, &global));
            });
            self.enter_stream_dispatch(stream)
                .set_context(returned, &global);
        }
        Some(stream)
    }

    fn to_writer(&self) -> DirectWriterStruct {
        DirectWriterStruct {
            writer: bun_ptr::BackRef::new(self),
        }
    }
}

/// Bridge the rewrite engine's `Settings` to the JS settings object via the legacy wire payload.
fn rewrite_settings_to_js(s: &crate::api::h2::settings::Settings, global: GlobalRef) -> JSValue {
    let fp = FullSettingsPayload {
        header_table_size: s.header_table_size,
        enable_push: s.enable_push,
        max_concurrent_streams: s.max_concurrent_streams,
        initial_window_size: s.initial_window_size,
        max_frame_size: s.max_frame_size,
        max_header_list_size: s.max_header_list_size,
        enable_connect_protocol: s.enable_connect_protocol,
    };
    fp.to_js(&global)
}

impl H2FrameParser {
    /// Bridge the legacy local SETTINGS payload to the rewrite engine's Settings.
    fn rewrite_local_settings(&self) -> crate::api::h2::settings::Settings {
        let s = self.local_settings.get();
        crate::api::h2::settings::Settings {
            header_table_size: s.header_table_size,
            enable_push: s.enable_push,
            max_concurrent_streams: s.max_concurrent_streams,
            initial_window_size: s.initial_window_size,
            max_frame_size: s.max_frame_size,
            max_header_list_size: s.max_header_list_size,
            enable_connect_protocol: s.enable_connect_protocol,
        }
    }

    /// Lazily create the rewrite engine once is_server + local settings are known.
    fn ensure_engine(&self) {
        if self.engine.borrow().is_none() {
            let mut conn = crate::api::h2::connection::Connection::new(
                self.is_server.get(),
                self.rewrite_local_settings(),
            );
            // The engine is created lazily on the first inbound read, by which point settings()
            // may already have submitted (still unACKed) values; received header blocks must be
            // checked against the constructor-time limit until the peer ACKs a later submission.
            conn.enforced_max_header_list_size = self.enforced_max_header_list_size.get();
            *self.engine.borrow_mut() = Some(conn);
        }
    }

    /// Resolve the JS stream context for the rewrite engine's dispatches: the `sctx` map (populated
    /// by setStreamContext, i.e. server-side inbound streams) or the legacy stream's own context
    /// (populated directly by the legacy request() for client-initiated streams).
    fn rewrite_stream_ctx(&self, stream_id: u32) -> JSValue {
        if let Some(ctx) = self.sctx.get().get(&stream_id).and_then(|s| s.get()) {
            return ctx;
        }
        if let Some(stream) = self.streams.get().get(&stream_id).copied() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            return unsafe { (*stream).get_identifier() };
        }
        JSValue::UNDEFINED
    }

    /// Record outbound DATA the legacy encoder wrote so the engine's send windows track reality.
    /// Buffered in cells and applied in rewrite_read: inbound WINDOW_UPDATE handling always goes
    /// through rewrite_read first, so the windows are in sync before any overflow check runs.
    pub(crate) fn note_engine_send_consumed(&self, stream_id: u32, n: u64) {
        if n == 0 {
            return;
        }
        self.pending_send_window_consumed
            .set(self.pending_send_window_consumed.get() + n);
        self.pending_stream_send_consumed.with_mut(|v| {
            if let Some(last) = v.last_mut()
                && last.0 == stream_id
            {
                last.1 += n;
            } else {
                v.push((stream_id, n));
            }
        });
    }

    /// Mirror the engine's frame counters into plain Cells so getFrameCounters() never
    /// contends with the engine borrow (destroy can run inside a dispatch).
    fn sync_engine_frame_counters(&self) {
        if let Ok(guard) = self.engine.try_borrow() {
            if let Some(engine) = guard.as_ref() {
                self.engine_frames_received.set(engine.frames_received);
                self.engine_frames_sent.set(engine.frames_sent);
            }
        }
    }

    /// Feed inbound bytes through the rewrite engine, buffering the unconsumed tail (design B).
    fn rewrite_read(&self, bytes: &[u8]) {
        bun_output::scoped_log!(H2FrameParser, "rewriteRead {}", bytes.len());
        // Re-entrancy guard: receive() dispatches into JS between frames, and user code can feed
        // bytes back into the same parser from inside such a dispatch (e.g. a custom Duplex whose
        // write path synchronously pushes back into the socket). The engine cell stays mutably
        // borrowed across the outer receive(), so queue the bytes for the outer call to drain
        // rather than panicking on a second borrow.
        if self.engine.try_borrow_mut().is_err() {
            self.rewrite_tail.with_mut(|t| t.extend_from_slice(bytes));
            return;
        }
        self.ensure_engine();
        // Keep the engine's local settings in sync with the JS-configured cell (settings() may be
        // called after the engine was lazily created). Plain Copy structs — no allocation.
        if let Some(engine) = self.engine.borrow_mut().as_mut() {
            engine.local_settings = self.rewrite_local_settings();
            engine.max_header_list_pairs = self.max_header_list_pairs.get();
            engine.max_settings = self.max_settings.get();
            engine.max_invalid_frames = self.max_session_invalid_frames.get();
            // Outbound-ACK-flood counter: only reset when the transport actually
            // drained (nghttp2 decrements per-send). Resetting per receive() lets
            // a peer that never reads keep it under the limit forever.
            if self.write_buffer.get().slice()[self.write_buffer_offset.get()..].is_empty() {
                engine.note_outbound_drained();
            }
            // Apply any receive-window growth setLocalWindowSize() accumulated while a dispatch
            // held this borrow.
            let pending = self.pending_recv_window_growth.replace(0);
            if pending > 0 {
                engine.recv_window.grow(pending);
            }
            // Apply outbound DATA the legacy encoder wrote since the last batch, so the engine's
            // send windows reflect what is actually in flight (§6.9.1 overflow stays peer-error
            // only).
            let sent = self.pending_send_window_consumed.replace(0);
            if sent > 0 {
                engine.send_window.consume(sent as i64);
            }
            self.pending_stream_send_consumed.with_mut(|v| {
                // A client-initiated stream has no engine entry until its first inbound
                // frame; dropping its consume here would leave the engine's send window
                // permanently wider than the peer's view. Keep unmatched entries queued —
                // but only while the legacy stream is still alive: a pushed stream the
                // client never sends frames on would otherwise park its entry forever
                // (and get scanned on every read).
                v.retain(|&(id, n)| {
                    if let Some(s) = engine.streams.get_mut(&id) {
                        s.send_window.consume(n as i64);
                        false
                    } else {
                        self.streams.get().contains_key(&id)
                    }
                });
            });
            // Register SETTINGS submissions the legacy encoder sent since the last batch, so the
            // engine attributes each inbound ACK to the right submission (§6.5.3).
            self.pending_settings_window_submissions.with_mut(|v| {
                for w in v.drain(..) {
                    engine.pending_local_settings_acks.push_back(w);
                }
            });
            // Streams whose legacy lifecycle finished since the last batch: evict the engine
            // entry and free the legacy slot. free_resources already ran for these (it is the
            // only producer of this queue); duplicate ids are fine — remove() yields None.
            if self.dispatch_depth.get() == 0 {
                self.pending_engine_stream_closes.with_mut(|v| {
                    for id in v.drain(..) {
                        engine.close_stream(id);
                        if let Some(stream) = self.streams.with_mut(|m| m.remove(&id)) {
                            // SAFETY: stream is the heap::alloc'd *mut Stream owned by the
                            // map entry just removed; free_resources ran when it was queued,
                            // dispatch_depth == 0 means no caller below us on the stack holds
                            // a `&mut Stream` across anything that can run user JS (every
                            // such site arms enter_dispatch), ids never repeat within a
                            // session, so this frees exactly once.
                            unsafe {
                                drop(bun_core::heap::take(stream));
                            }
                        }
                    }
                });
            }
        }
        if self.rewrite_tail.get().is_empty() {
            let feed = {
                let mut guard = self.engine.borrow_mut();
                guard.as_mut().unwrap().receive(self, bytes)
            };
            if feed.fatal {
                // GOAWAY is on the wire and on_error tore the session down; feeding the
                // remainder would only re-parse frames for a dead connection.
                self.rewrite_tail.with_mut(|t| t.clear());
                let _ = self.flush();
                return;
            }
            let consumed = feed.consumed;
            if consumed < bytes.len() {
                self.rewrite_tail.with_mut(|t| {
                    // A reentrant read() during dispatch may have queued bytes already; this
                    // batch's unconsumed remainder precedes them on the wire.
                    let _ = t.splice(0..0, bytes[consumed..].iter().copied());
                });
            }
        } else {
            let mut combined = self.rewrite_tail.with_mut(std::mem::take);
            combined.extend_from_slice(bytes);
            let feed = {
                let mut guard = self.engine.borrow_mut();
                guard.as_mut().unwrap().receive(self, &combined)
            };
            if feed.fatal {
                self.rewrite_tail.with_mut(|t| t.clear());
                let _ = self.flush();
                return;
            }
            let consumed = feed.consumed;
            self.rewrite_tail.with_mut(|t| {
                if consumed < combined.len() {
                    let _ = t.splice(0..0, combined[consumed..].iter().copied());
                }
            });
        }
        // Drain bytes queued by reentrant reads during the dispatches above. Stop when the engine
        // makes no progress (an incomplete frame waiting for more input stays in the tail).
        loop {
            if self.rewrite_tail.get().is_empty() {
                break;
            }
            let pending = self.rewrite_tail.with_mut(std::mem::take);
            let feed = {
                let mut guard = self.engine.borrow_mut();
                guard.as_mut().unwrap().receive(self, &pending)
            };
            if feed.fatal {
                self.rewrite_tail.with_mut(|t| t.clear());
                let _ = self.flush();
                return;
            }
            let consumed = feed.consumed;
            self.rewrite_tail
                .with_mut(|t| drop(t.splice(0..0, pending[consumed..].iter().copied())));
            if consumed == 0 {
                break;
            }
        }
        // Uncork: flush the engine's queued control/response frames to the socket.
        let _ = self.flush();
    }
}

/// The from-scratch engine calls back into H2FrameParser (the embedder) through this.
impl crate::api::h2::connection::Sink for H2FrameParser {
    /// A frame callback left an exception pending (a value it could not build): no later frame
    /// in this batch is dispatched over it; `read()` throws it and `on_native_read` returns it to
    /// the socket dispatch. (A termination between frames is what `run_callback`'s gate covers.)
    #[inline]
    fn should_stop(&self) -> bool {
        self.left_exception.get()
    }

    fn on_frame_counters(&self, received: u64, sent: u64) {
        self.engine_frames_received.set(received);
        self.engine_frames_sent.set(sent);
    }

    fn write(&self, bytes: &[u8]) -> crate::api::h2::connection::WriteResult {
        if self.write(bytes) {
            crate::api::h2::connection::WriteResult::Sent
        } else {
            crate::api::h2::connection::WriteResult::Queued
        }
    }

    fn on_error(&self, lib_error_code: i32, _last: u32, debug: &[u8]) {
        // The engine detected a connection error and already wrote the GOAWAY: surface it to JS
        // as the negative nghttp2-style library error code (the JS handler builds node's
        // NghttpError from it: code ERR_HTTP2_ERROR, message nghttp2_strerror), then the end
        // callback so the session tears itself down and closes the socket.
        let g = self.global();
        let Some(chunk) = self.or_stop(self.handlers.get().binary_type.to_js(debug, &g)) else {
            return;
        };
        if lib_error_code != 0 {
            self.dispatch_with_2_extra(
                JSH2FrameParser::Gc::onError,
                JSValue::js_number(lib_error_code as f64),
                JSValue::js_number(self.last_stream_id.get() as f64),
                chunk,
            );
        }
        self.dispatch_with_extra(
            JSH2FrameParser::Gc::onEnd,
            JSValue::js_number(self.last_stream_id.get() as f64),
            chunk,
        );
    }

    fn on_too_many_invalid_frames(&self) {
        // The peer exceeded maxSessionInvalidFrames: surface a session error. The JS error handler
        // recognizes the string code and destroys the session with ERR_HTTP2_TOO_MANY_INVALID_FRAMES.
        let Some(code_js) =
            self.or_stop(self.string_or_empty_to_js(b"ERR_HTTP2_TOO_MANY_INVALID_FRAMES"))
        else {
            return;
        };
        self.dispatch_with_2_extra(
            JSH2FrameParser::Gc::onError,
            code_js,
            JSValue::js_number(self.last_stream_id.get() as f64),
            JSValue::UNDEFINED,
        );
    }

    fn on_local_settings(&self, settings: &crate::api::h2::settings::Settings) {
        // Bridge: our SETTINGS was ACKed — release the legacy outstanding-settings slot so the
        // legacy settings() host fn doesn't hit MAX_PENDING_SETTINGS_ACK.
        self.outstanding_settings
            .set(self.outstanding_settings.get().saturating_sub(1));
        let g = self.global();
        let js = rewrite_settings_to_js(settings, g);
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
        self.dispatch(JSH2FrameParser::Gc::onLocalSettings, js);
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

    fn on_remote_settings(&self, settings: &crate::api::h2::settings::Settings) {
        // Bridge: the legacy outbound (frame sizing, window init) reads the remote_settings Cell.
        let fp = FullSettingsPayload {
            header_table_size: settings.header_table_size,
            enable_push: settings.enable_push,
            max_concurrent_streams: settings.max_concurrent_streams,
            initial_window_size: settings.initial_window_size,
            max_frame_size: settings.max_frame_size,
            max_header_list_size: settings.max_header_list_size,
            enable_connect_protocol: settings.enable_connect_protocol,
        };
        self.remote_settings.set(Some(fp));
        // §6.9.2 (mirrors the legacy inbound): when the peer's INITIAL_WINDOW_SIZE grows, raise the
        // send window of streams opened before its SETTINGS arrived (a client's first request is
        // typically sent before the server's SETTINGS lands), then resume queued sends.
        let mut window_grew = false;
        for (_, item) in self.streams.get().iter() {
            // SAFETY: item is &*mut Stream from streams.iter(); the boxed Stream outlives the iteration
            let stream = unsafe { &mut **item };
            if (settings.initial_window_size as u64) > stream.remote_window_size {
                stream.remote_window_size = settings.initial_window_size as u64;
                window_grew = true;
            }
        }
        // Resume queued sends only when a window actually grew; there is nothing to flush otherwise.
        if window_grew {
            let _ = self.flush();
        }
        let g = self.global();
        let js = rewrite_settings_to_js(settings, g);
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
        self.dispatch(JSH2FrameParser::Gc::onRemoteSettings, js);
    }

    fn on_ping(&self, payload: &[u8], is_ack: bool) {
        if is_ack {
            // node (Http2Session::HandlePingFrame): a PING ACK with no outstanding ping is
            // unsolicited and treated as a connection error (NGHTTP2_ERR_PROTO -> NghttpError
            // "Protocol error"); the JS error handler destroys the session.
            if self.out_standing_pings.get() == 0 {
                let g = self.global();
                let Some(chunk) = self.or_stop(
                    self.handlers
                        .get()
                        .binary_type
                        .to_js(b"unsolicited PING ACK", &g),
                ) else {
                    return;
                };
                self.dispatch_with_2_extra(
                    JSH2FrameParser::Gc::onError,
                    JSValue::js_number(crate::api::h2::wire::lib_error::PROTO as f64),
                    JSValue::js_number(self.last_stream_id.get() as f64),
                    chunk,
                );
                return;
            }
            // Balance the increment from send_ping: the legacy inbound path decremented this in
            // handle_ping; the engine path must do the same or the outstanding-ping limit trips
            // on long-lived sessions.
            self.out_standing_pings
                .set(self.out_standing_pings.get().saturating_sub(1));
        }
        let g = self.global();
        let Some(buffer) = self.or_stop(self.handlers.get().binary_type.to_js(payload, &g)) else {
            return;
        };
        self.dispatch_with_extra(JSH2FrameParser::Gc::onPing, buffer, JSValue::from(is_ack));
    }

    fn on_go_away(&self, code: u32, last: u32, debug: &[u8]) {
        // Always a Buffer (possibly empty) to match the legacy dispatch shape. The lastStreamID
        // surfaced to JS is the peer's Last-Stream-ID from the GOAWAY payload (node's documented
        // semantics for the 'goaway' event).
        let g = self.global();
        let Some(chunk) = self.or_stop(self.handlers.get().binary_type.to_js(debug, &g)) else {
            return;
        };
        self.dispatch_with_2_extra(
            JSH2FrameParser::Gc::onGoAway,
            JSValue::js_number(code as f64),
            JSValue::js_number(last as f64),
            chunk,
        );
    }

    fn on_window_update(&self, stream_id: u32, increment: u32) {
        bun_output::scoped_log!(
            H2FrameParser,
            "engine WU received stream={} inc={}",
            stream_id,
            increment
        );
        // Bridge: the legacy outbound reads its own window cells to decide how much DATA to send.
        if stream_id == 0 {
            self.remote_window_size
                .set(self.remote_window_size.get() + increment as u64);
        } else if let Some(stream) = self.streams.get().get(&stream_id).copied() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            unsafe { (*stream).remote_window_size += increment as u64 };
        }
        let _ = self.flush();
    }

    fn on_altsvc(&self, stream_id: u32, origin: &[u8], value: &[u8]) {
        let Some(origin_js) = self.or_stop(self.string_or_empty_to_js(origin)) else {
            return;
        };
        let Some(value_js) = self.or_stop(self.string_or_empty_to_js(value)) else {
            return;
        };
        self.dispatch_with_2_extra(
            JSH2FrameParser::Gc::onAltSvc,
            origin_js,
            value_js,
            JSValue::js_number(stream_id as f64),
        );
    }

    fn can_open_stream(&self) -> bool {
        // node (Http2Session::OnBeginHeadersCallback): a new inbound stream is refused when the
        // session is over its maxSessionMemory budget.
        !self.is_over_session_memory_limit()
    }

    fn is_local_stream(&self, stream_id: u32) -> bool {
        // The legacy outbound created an entry in the legacy streams map for every locally
        // initiated stream (request/respond), so membership there means "we sent HEADERS on it".
        self.streams.get().contains_key(&stream_id)
    }

    fn highest_started_stream_id(&self) -> u32 {
        // handle_received_stream_id raises this for every stream registered on this side
        // (including locally-initiated ones) and eviction never lowers it.
        self.last_stream_id.get()
    }

    fn is_stream_reading(&self, stream_id: u32) -> bool {
        match self.streams.get().get(&stream_id).copied() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            Some(stream) => unsafe { !(*stream).reading_paused },
            None => true,
        }
    }

    fn on_push_promise(&self, _parent_id: u32, promised_id: u32) {
        // The promised request headers follow via on_header/on_headers_complete for promised_id;
        // remember it so that completion dispatches onStreamPush instead of onStreamHeaders.
        self.rewrite_pending_push.set(promised_id);
    }

    fn on_origin(&self, payload: &[u8]) {
        // Match the legacy dispatch shape: a single origin is passed as a string, multiple origins
        // as an array — one onOrigin dispatch per ORIGIN frame.
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
            let Some(origin_js) = self.or_stop(self.string_or_empty_to_js(origin)) else {
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
        self.dispatch(JSH2FrameParser::Gc::onOrigin, origin_value);
    }

    fn on_stream_open(&self, stream_id: u32) {
        // Bridge: create the legacy stream entry (the legacy outbound host fns — respond/sendData/
        // rstStream/getStreamState — look streams up there) AND dispatch onStreamStart, which the
        // legacy helper already does. The JS streamStart handler then calls setStreamContext,
        // populating both `sctx` and the legacy stream context.
        let _ = self.handle_received_stream_id(stream_id);
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

    fn on_headers_complete(&self, stream_id: u32, end_stream: bool, flags: u8) {
        // Bridge: the JS endAfterHeaders getter reads the legacy stream's end_after_headers flag.
        if let Some(stream) = self.streams.get().get(&stream_id).copied() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            unsafe { (*stream).end_after_headers = end_stream };
        }
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
                let v = bun_jsc::call_zero_is_throw(&g, || unsafe {
                    Bun__h2__materializeHeaders(&g, block.as_ptr(), meta.as_ptr(), field_count)
                });
                block.clear();
                meta.clear();
                v
            })
        });
        let Some(tuple) = self.or_stop(tuple) else {
            return;
        };
        if self.rewrite_pending_push.get() == stream_id && stream_id != 0 {
            // A PUSH_PROMISE header block: surface the promised request to JS as a pushed stream.
            self.rewrite_pending_push.set(0);
            self.dispatch_with_2_extra(
                JSH2FrameParser::Gc::onStreamPush,
                JSValue::js_number(stream_id as f64),
                tuple,
                JSValue::js_number(flags as f64),
            );
        } else {
            let stream_ctx = self.rewrite_stream_ctx(stream_id);
            self.dispatch_with_2_extra(
                JSH2FrameParser::Gc::onStreamHeaders,
                stream_ctx,
                tuple,
                JSValue::js_number(flags as f64),
            );
        }
    }

    fn on_data(&self, stream_id: u32, data: &[u8]) {
        let g = self.global();
        let stream_ctx = self.rewrite_stream_ctx(stream_id);
        let Some(chunk) = self.or_stop(self.handlers.get().binary_type.to_js(data, &g)) else {
            return;
        };
        self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamData, stream_ctx, chunk);
    }

    fn on_stream_end(&self, stream_id: u32, state: u8) {
        // The engine only sees the inbound half while outbound flows through the legacy path, so it
        // can't know the local side already sent END_STREAM. Combine with the legacy stream's local
        // state: remote-closed (6) on a stream whose local half is closed (5/7) is fully CLOSED (7),
        // mirroring the legacy handle_data/headers END_STREAM logic.
        let mut effective = state;
        if let Some(stream) = self.streams.get().get(&stream_id).copied() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            let legacy_state = unsafe { (*stream).state };
            if state == 6
                && matches!(
                    legacy_state,
                    StreamState::HALF_CLOSED_LOCAL | StreamState::CLOSED
                )
            {
                effective = 7;
            }
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            unsafe {
                (*stream).state = match effective {
                    5 => StreamState::HALF_CLOSED_LOCAL,
                    6 => StreamState::HALF_CLOSED_REMOTE,
                    7 => StreamState::CLOSED,
                    _ => legacy_state,
                };
            }
        }
        let stream_ctx = self.rewrite_stream_ctx(stream_id);
        self.dispatch_with_extra(
            JSH2FrameParser::Gc::onStreamEnd,
            stream_ctx,
            JSValue::js_number(effective as f64),
        );
        if effective == 7 {
            // Fully closed. In the sync-response flow the JS handler already half-closed the
            // local side during the HEADERS dispatch, so the legacy send-close branch saw
            // OPEN and skipped its teardown — free the legacy context here or it (its Strong
            // JS stream root, and the engine's map entry) leaks per request.
            if let Some(stream) = self.streams.get().get(&stream_id).copied() {
                // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
                unsafe { (*stream).free_resources::<false>(self) };
            }
            // Release the per-stream JS context root so it can be collected (also done by
            // free_resources, but a stream may have no legacy entry).
            self.sctx.with_mut(|m| {
                m.remove(&stream_id);
            });
        }
    }

    fn on_stream_rejected(&self, stream_id: u32) {
        // maxSessionRejectedStreams: counts only locally-initiated rejections (oversized or
        // malformed header blocks) - peer-sent RST_STREAM frames must not consume the budget.
        self.rejected_streams.set(self.rejected_streams.get() + 1);
        if self.max_rejected_streams.get() <= self.rejected_streams.get() {
            self.send_go_away(
                stream_id,
                ErrorCode::ENHANCE_YOUR_CALM,
                b"ENHANCE_YOUR_CALM",
                self.last_stream_id.get(),
                true,
            );
        }
    }

    fn on_stream_reset(&self, stream_id: u32, code: u32) {
        // A mid-block rejection (e.g. max_header_list_size) leaves partially-accumulated header
        // arrays behind; drop them so they can't leak into the next stream's dispatch. The same
        // applies to the pending PUSH_PROMISE marker - a rejected push block must not make the
        // next HEADERS dispatch as a push.
        self.hdr_block.with_mut(|b| b.clear());
        self.hdr_meta.with_mut(|m| m.clear());
        if self.rewrite_pending_push.get() == stream_id && stream_id != 0 {
            self.rewrite_pending_push.set(0);
        }
        // Bridge: mark the legacy stream closed with the rst code (capturing the prior state for
        // the aborted dispatch below).
        let mut old_state: u8 = StreamState::OPEN as u8;
        if let Some(stream) = self.streams.get().get(&stream_id).copied() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            unsafe {
                old_state = (*stream).state as u8;
                (*stream).state = StreamState::CLOSED;
                (*stream).rst_code = code;
            }
        }
        let stream_ctx = self.rewrite_stream_ctx(stream_id);
        if code == crate::api::h2::wire::ErrorCode::Cancel.as_u32() {
            // A peer CANCEL is an abort, not an error (node emits 'aborted' and closes with
            // rstCode 8 without an 'error' event).
            self.dispatch_with_2_extra(
                JSH2FrameParser::Gc::onAborted,
                stream_ctx,
                JSValue::UNDEFINED,
                JSValue::js_number(old_state as f64),
            );
        } else {
            self.dispatch_with_extra(
                JSH2FrameParser::Gc::onStreamError,
                stream_ctx,
                JSValue::js_number(code as f64),
            );
        }
        // The reset closes the stream; free the legacy slot (queueing the engine eviction)
        // and release its JS context root, mirroring the on_stream_end full-close path.
        if let Some(stream) = self.streams.get().get(&stream_id).copied() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            unsafe { (*stream).free_resources::<false>(self) };
        }
        self.sctx.with_mut(|m| {
            m.remove(&stream_id);
        });
    }
}

// Note: holds a `BackRef<H2FrameParser>` so the borrow of the parser ends
// at `to_writer()`'s return — `Stream::flush_queue` interleaves field
// reads/writes on the parser between `writer.write()` calls. R-2: `write()`
// takes `&self` (Cell/JsCell-backed), so a shared back-reference is sufficient
// and the `BackRef` invariant (parser outlives this struct) holds by
// construction.
struct DirectWriterStruct {
    writer: bun_ptr::BackRef<H2FrameParser>,
}
impl bun_io::Write for DirectWriterStruct {
    fn write_all(&mut self, data: &[u8]) -> bun_io::Result<()> {
        if self.writer.write(data) {
            Ok(())
        } else {
            Err(bun_core::Error::WriteFailed)
        }
    }
}

impl DirectWriterStruct {
    /// The payload of a PADDED DATA frame (RFC 9113 6.1); the caller wrote the frame header.
    fn write_padded(&mut self, data: &[u8], padding: u8) -> bun_io::Result<()> {
        let payload_size = 1 + data.len() + padding as usize;
        // Taken by value so a re-entrant call gets its own; see take_h2_padded_frame_buffer.
        let global = self.writer.global();
        let mut buffer = global
            .bun_vm()
            .as_mut()
            .rare_data()
            .take_h2_padded_frame_buffer();
        buffer[0] = padding;
        buffer[1..=data.len()].copy_from_slice(data);
        buffer[1 + data.len()..payload_size].fill(0);
        let result = self.write_all(&buffer[..payload_size]);
        global
            .bun_vm()
            .as_mut()
            .rare_data()
            .put_back_h2_padded_frame_buffer(buffer);
        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — JS host fns (part 1)
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    pub(crate) fn load_settings_from_js_value(
        &self,
        global_object: &JSGlobalObject,
        options: JSValue,
    ) -> JsResult<()> {
        if options.is_empty_or_undefined_or_null() || !options.is_object() {
            return Err(global_object.throw(format_args!("Expected settings to be a object")));
        }

        // R-2: read-modify-write the `Cell<FullSettingsPayload>` via a local copy.
        let mut local_settings = self.local_settings.get();
        // The wire-emit mask is per-call: node's updateSettingsBuffer starts flags at 0 and only
        // sends entries the user provided in this call. local_settings remains cumulative.
        let mut explicit_settings: u8 = 0;

        macro_rules! number_setting {
            ($key:literal, $field:ident, $bit:expr, $min:expr, $max:expr, $err:literal) => {{
                if let Some(v) = options.get(global_object, $key)? {
                    if v.is_number() {
                        let value = v.as_number();
                        if value < ($min as f64) || value > $max {
                            return global_object
                                .err_http2_invalid_setting_value_range_error($err)
                                .throw();
                        }
                        local_settings.$field = value as u32;
                        explicit_settings |= $bit;
                    } else if !v.is_empty_or_undefined_or_null() {
                        return global_object
                            .err_http2_invalid_setting_value_range_error(concat!(
                                "Expected ",
                                $key,
                                " to be a number"
                            ))
                            .throw();
                    }
                }
            }};
        }

        number_setting!(
            "headerTableSize",
            header_table_size,
            SETTING_BIT_HEADER_TABLE_SIZE,
            0,
            MAX_HEADER_TABLE_SIZE_F64,
            "Expected headerTableSize to be a number between 0 and 2^32-1"
        );

        if let Some(enable_push) = options.get(global_object, "enablePush")? {
            if enable_push.is_boolean() {
                local_settings.enable_push = if enable_push.as_boolean() { 1 } else { 0 };
                explicit_settings |= SETTING_BIT_ENABLE_PUSH;
            } else if !enable_push.is_undefined() {
                return global_object
                    .err_http2_invalid_setting_value("Expected enablePush to be a boolean")
                    .throw();
            }
        }

        if let Some(v) = options.get(global_object, "initialWindowSize")? {
            if v.is_number() {
                let value = v.as_number();
                if value < 0.0 || value > MAX_WINDOW_SIZE_F64 {
                    return global_object
                        .err_http2_invalid_setting_value_range_error(
                            "Expected initialWindowSize to be a number between 0 and 2^32-1",
                        )
                        .throw();
                }
                bun_output::scoped_log!(H2FrameParser, "initialWindowSize: {}", value as u32);
                local_settings.initial_window_size = value as u32;
                explicit_settings |= SETTING_BIT_INITIAL_WINDOW_SIZE;
            } else if !v.is_empty_or_undefined_or_null() {
                return global_object
                    .err_http2_invalid_setting_value_range_error(
                        "Expected initialWindowSize to be a number",
                    )
                    .throw();
            }
        }

        number_setting!(
            "maxFrameSize",
            max_frame_size,
            SETTING_BIT_MAX_FRAME_SIZE,
            16384,
            MAX_FRAME_SIZE_F64,
            "Expected maxFrameSize to be a number between 16,384 and 2^24-1"
        );
        number_setting!(
            "maxConcurrentStreams",
            max_concurrent_streams,
            SETTING_BIT_MAX_CONCURRENT_STREAMS,
            0,
            MAX_HEADER_TABLE_SIZE_F64,
            "Expected maxConcurrentStreams to be a number between 0 and 2^32-1"
        );
        number_setting!(
            "maxHeaderListSize",
            max_header_list_size,
            SETTING_BIT_MAX_HEADER_LIST_SIZE,
            0,
            MAX_HEADER_TABLE_SIZE_F64,
            "Expected maxHeaderListSize to be a number between 0 and 2^32-1"
        );
        number_setting!(
            "maxHeaderSize",
            max_header_list_size,
            SETTING_BIT_MAX_HEADER_LIST_SIZE,
            0,
            MAX_HEADER_TABLE_SIZE_F64,
            "Expected maxHeaderSize to be a number between 0 and 2^32-1"
        );

        if let Some(ecp) = options.get(global_object, "enableConnectProtocol")? {
            if ecp.is_boolean() {
                local_settings.enable_connect_protocol = if ecp.as_boolean() { 1 } else { 0 };
                explicit_settings |= SETTING_BIT_ENABLE_CONNECT_PROTOCOL;
            } else if !ecp.is_undefined() {
                return global_object
                    .err_http2_invalid_setting_value(
                        "Expected enableConnectProtocol to be a boolean",
                    )
                    .throw();
            }
        }

        // Stage customSettings before committing anything — a later validation throw must not
        // leave partial state installed for the next submission.
        let mut staged_custom: Vec<(u16, u32)> = Vec::new();
        // Validate customSettings and remember them so they go on the wire with our SETTINGS.
        if let Some(custom_settings) = options.get(global_object, "customSettings")? {
            if !custom_settings.is_undefined() {
                let Some(custom_settings_obj) = custom_settings.get_object() else {
                    return global_object
                        .err_http2_invalid_setting_value("Expected customSettings to be an object")
                        .throw();
                };

                let mut count: usize = 0;
                let iter = bun_jsc::JSPropertyIterator::init(
                    global_object,
                    custom_settings_obj,
                    bun_jsc::JSPropertyIteratorOptions {
                        skip_empty_name: false,
                        include_value: true,
                        ..Default::default()
                    },
                )?;

                while let Some((prop_name, setting_value)) = iter.next()? {
                    count += 1;
                    if count > MAX_CUSTOM_SETTINGS {
                        return global_object
                            .err_http2_too_many_custom_settings(
                                "Number of custom settings exceeds MAX_ADDITIONAL_SETTINGS",
                            )
                            .throw();
                    }

                    // Validate setting ID (key) is in range [0, 0xFFFF]
                    let setting_id_str = prop_name.to_utf8();
                    // Parse bytes directly (ASCII decimal); do not insert
                    // UTF-8 validation on external data.
                    let Some(setting_id) =
                        bun_core::parse_int::<u32>(setting_id_str.slice(), 10).ok()
                    else {
                        return global_object
                            .err_http2_invalid_setting_value_range_error(
                                "Invalid custom setting identifier",
                            )
                            .throw();
                    };
                    if setting_id > 0xFFFF {
                        return global_object
                            .err_http2_invalid_setting_value_range_error(
                                "Invalid custom setting identifier",
                            )
                            .throw();
                    }

                    // Validate setting value is in range [0, 2^32-1]
                    if setting_value.is_number() {
                        let value = setting_value.as_number();
                        if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                            return global_object
                                .err_http2_invalid_setting_value_range_error(
                                    "Invalid custom setting value",
                                )
                                .throw();
                        }
                        staged_custom.push((setting_id as u16, value as u32));
                    } else {
                        return global_object
                            .err_http2_invalid_setting_value_range_error(
                                "Expected custom setting value to be a number",
                            )
                            .throw();
                    }
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

        self.local_settings.set(local_settings);
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

    #[bun_jsc::host_fn(method)]
    pub(crate) fn update_settings(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [options] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected settings argument")));
        }

        this.load_settings_from_js_value(global_object, options)?;

        Ok(JSValue::from(this.set_settings(this.local_settings.get())))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_local_window_size(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [window_size] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(
                global_object.throw_invalid_arguments(format_args!("Expected windowSize argument"))
            );
        }
        if !window_size.is_number() {
            return Err(global_object
                .throw_invalid_arguments(format_args!("Expected windowSize to be a number")));
        }
        let window_size_value: u32 = window_size.to_u32();
        if this.used_window_size.get() > window_size_value as u64 {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "Expected windowSize to be greater than usedWindowSize"
            )));
        }
        let old_window_size = this.window_size.get();
        this.window_size.set(window_size_value as u64);
        if this.local_settings.get().initial_window_size < window_size_value {
            let mut s = this.local_settings.get();
            s.initial_window_size = window_size_value;
            this.local_settings.set(s);
        }
        if window_size_value as u64 > old_window_size {
            let increment: u32 = (window_size_value as u64 - old_window_size) as u32;
            this.send_window_update(0, UInt31WithReserved::init(increment, false));
            // Keep the rewrite engine's receive window in sync: we just advertised a larger
            // window, so the engine must accept that much DATA without tripping its overflow
            // check. try_borrow: setLocalWindowSize can be called from JS inside a dispatch
            // (rewrite_read holds the engine borrow there); deferring the sync to the pending
            // delta keeps that path panic-free.
            match this.engine.try_borrow_mut() {
                Ok(mut guard) => match guard.as_mut() {
                    Some(engine) => engine.recv_window.grow(increment as i64),
                    None => {
                        // The engine is created lazily on the first inbound read; carry the
                        // growth forward so it applies when that happens.
                        this.pending_recv_window_growth
                            .set(this.pending_recv_window_growth.get() + increment as i64);
                    }
                },
                Err(_) => {
                    // A dispatch is in progress; accumulate the delta for rewrite_read to apply
                    // when the borrow is released.
                    this.pending_recv_window_growth
                        .set(this.pending_recv_window_growth.get() + increment as i64);
                }
            }
        }
        for (_, item) in this.streams.get().iter() {
            // SAFETY: item is &*mut Stream from streams.iter(); the boxed Stream outlives the iteration
            let stream = unsafe { &mut **item };
            if stream.used_window_size > window_size_value as u64 {
                continue;
            }
            stream.window_size = window_size_value as u64;
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_frame_counters(
        this: &Self,
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.sync_engine_frame_counters();
        let result = JSValue::create_empty_object(global_object, 2);
        result.put(
            global_object,
            b"framesReceived",
            JSValue::js_number(this.engine_frames_received.get() as f64),
        );
        result.put(
            global_object,
            b"framesSent",
            JSValue::js_number(
                (this.frames_sent_legacy.get() + this.engine_frames_sent.get()) as f64,
            ),
        );
        Ok(result)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_current_state(
        this: &Self,
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = JSValue::create_empty_object(global_object, 9);
        result.put(
            global_object,
            b"effectiveLocalWindowSize",
            JSValue::js_number(this.window_size.get() as f64),
        );
        result.put(
            global_object,
            b"effectiveRecvDataLength",
            JSValue::js_number((this.window_size.get() - this.used_window_size.get()) as f64),
        );
        result.put(
            global_object,
            b"nextStreamID",
            JSValue::js_number(this.get_next_stream_id() as f64),
        );
        result.put(
            global_object,
            b"lastProcStreamID",
            JSValue::js_number(this.last_stream_id.get() as f64),
        );

        let settings = this.remote_settings.get().unwrap_or_default();
        let remote_iws = settings.initial_window_size;
        let local_iws = this.local_settings.get().initial_window_size;
        let local_hts = this.local_settings.get().header_table_size;
        result.put(
            global_object,
            b"remoteWindowSize",
            JSValue::js_number(remote_iws as f64),
        );
        result.put(
            global_object,
            b"localWindowSize",
            JSValue::js_number(local_iws as f64),
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
            JSValue::js_number(this.outbound_queue_size.get() as f64),
        );
        Ok(result)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn goaway(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [error_code_arg, last_stream_arg, opaque_data_arg] =
            callframe.arguments_as_array::<3>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected errorCode argument")));
        }

        if !error_code_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected errorCode to be a number")));
        }
        let error_code = error_code_arg.to_int32();

        let mut last_stream_id = this.last_peer_stream_id.get();
        if callframe.arguments_count() >= 2 {
            if !last_stream_arg.is_empty_or_undefined_or_null() {
                if !last_stream_arg.is_number() {
                    return Err(
                        global_object.throw(format_args!("Expected lastStreamId to be a number"))
                    );
                }
                let id = last_stream_arg.to_int32();
                // node: a lastStreamID of 0 or less (the JS wrapper's default) means "use the
                // last processed stream id"; only an explicit positive id overrides it
                // (validateNumber imposes no range, so negative values reach this path too).
                // Without this, graceful close puts Last-Stream-ID=0 on the wire, telling the
                // peer that every in-flight stream is safe to retry.
                if id > 0 {
                    last_stream_id = u32::try_from(id).expect("int cast");
                }
            }
            if callframe.arguments_count() >= 3 {
                if !opaque_data_arg.is_empty_or_undefined_or_null() {
                    if let Some(array_buffer) = opaque_data_arg.as_array_buffer(global_object) {
                        // Own the bytes: write() re-enters JS on JS-backed sockets and can detach this.
                        let copied = array_buffer.byte_slice().to_vec();
                        this.send_go_away(
                            0,
                            ErrorCode(error_code as u32),
                            &copied,
                            last_stream_id,
                            false,
                        );
                        return Ok(JSValue::UNDEFINED);
                    }
                }
            }
        }

        this.send_go_away(0, ErrorCode(error_code as u32), b"", last_stream_id, false);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn ping(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [payload_arg] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected payload argument")));
        }

        // node (Http2Session::AddPing): when the outstanding-ping budget is exhausted, ping()
        // returns false and the JS callback is invoked with ERR_HTTP2_PING_CANCEL — it does NOT
        // throw.
        if this.out_standing_pings.get() >= this.max_outstanding_pings.get() {
            return Ok(JSValue::FALSE);
        }

        if let Some(array_buffer) = payload_arg.as_array_buffer(global_object) {
            let slice = array_buffer.slice();
            this.send_ping(false, slice);
            return Ok(JSValue::TRUE);
        }

        Err(global_object.throw(format_args!("Expected payload to be a Buffer")))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn origin(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let origin_arg = callframe.argument(0);
        if origin_arg.is_empty_or_undefined_or_null() {
            // empty origin frame
            let mut buffer = [0u8; FrameHeader::BYTE_SIZE];
            let mut stream = FixedBufferStream::new(&mut buffer);

            let frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_ORIGIN as u8,
                flags: 0,
                stream_identifier: 0,
                length: 0,
            };
            let _ = frame.write(&mut stream, &this.frames_sent_legacy);
            let _ = this.write(&buffer);
            return Ok(JSValue::UNDEFINED);
        }

        if origin_arg.is_string() {
            let origin_string = origin_arg.to_utf8(global_object)?;
            let slice = origin_string.slice();
            if slice.len() + 2 > 16384 {
                let exception = global_object.to_type_error(
                    bun_jsc::ErrorCode::HTTP2_ORIGIN_LENGTH,
                    format_args!("HTTP/2 ORIGIN frames are limited to 16382 bytes"),
                );
                return Err(global_object.throw_value(exception));
            }

            let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 2];
            let mut stream = FixedBufferStream::new(&mut buffer);

            let frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_ORIGIN as u8,
                flags: 0,
                stream_identifier: 0,
                length: u32::try_from(slice.len() + 2).expect("int cast"),
            };
            let _ = frame.write(&mut stream, &this.frames_sent_legacy);
            let _ = stream.write_all(&u16::try_from(slice.len()).expect("int cast").to_be_bytes());
            let _ = this.write(&buffer);
            if !slice.is_empty() {
                let _ = this.write(slice);
            }
        } else if origin_arg.is_array() {
            let mut buffer = vec![0u8; FrameHeader::BYTE_SIZE + 16384];
            // Heap-allocated to avoid a 16K stack frame.
            let mut stream = FixedBufferStream::new(&mut buffer);
            stream.seek_to(FrameHeader::BYTE_SIZE);
            let mut value_iter = origin_arg.array_iterator(global_object)?;

            while let Some(item) = value_iter.next()? {
                if !item.is_string() {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "Expected origin to be a string or an array of strings"
                    )));
                }
                let origin_string = item.to_utf8(global_object)?;
                let slice = origin_string.slice();
                let fits = u16::try_from(slice.len()).is_ok_and(|len| {
                    stream.write_all(&len.to_be_bytes()).is_ok() && stream.write_all(slice).is_ok()
                });
                if !fits {
                    let exception = global_object.to_type_error(
                        bun_jsc::ErrorCode::HTTP2_ORIGIN_LENGTH,
                        format_args!("HTTP/2 ORIGIN frames are limited to 16382 bytes"),
                    );
                    return Err(global_object.throw_value(exception));
                }
            }

            let total_length: u32 = u32::try_from(stream.pos).expect("int cast");
            let frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_ORIGIN as u8,
                flags: 0,
                stream_identifier: 0,
                length: total_length - FrameHeader::BYTE_SIZE as u32, // payload length
            };
            stream.reset();
            let _ = frame.write(&mut stream, &this.frames_sent_legacy);
            let _ = this.write(&buffer[0..total_length as usize]);
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn altsvc(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut origin_slice: Option<bun_core::Utf8Bytes> = None;
        let mut value_slice: Option<bun_core::Utf8Bytes> = None;

        let mut origin_str: &[u8] = b"";
        let mut value_str: &[u8] = b"";
        let mut stream_id: u32 = 0;
        let origin_string = callframe.argument(0);
        if !origin_string.is_empty_or_undefined_or_null() {
            if !origin_string.is_string() {
                return Err(global_object.throw_invalid_argument_type_value(
                    b"origin",
                    b"origin",
                    origin_string,
                ));
            }
            origin_slice = Some(origin_string.to_utf8(global_object)?);
            origin_str = origin_slice.as_ref().unwrap().slice();
        }

        let value_string = callframe.argument(1);
        if !value_string.is_empty_or_undefined_or_null() {
            if !value_string.is_string() {
                return Err(global_object.throw_invalid_argument_type_value(
                    b"value",
                    b"value",
                    value_string,
                ));
            }
            value_slice = Some(value_string.to_utf8(global_object)?);
            value_str = value_slice.as_ref().unwrap().slice();
        }

        let stream_id_js = callframe.argument(2);
        if !stream_id_js.is_empty_or_undefined_or_null() {
            if !stream_id_js.is_number() {
                return Err(global_object.throw(format_args!("Expected streamId to be a number")));
            }
            stream_id = stream_id_js.to_u32();
        }
        if stream_id > 0 {
            // dont error but dont send frame to invalid stream id
            if this.streams.get().get(&stream_id).is_none() {
                return Ok(JSValue::UNDEFINED);
            }
        }
        this.send_alt_svc(stream_id, origin_str, value_str);
        // origin_slice/value_slice dropped here
        let _ = (origin_slice, value_slice);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_end_after_headers(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_arg] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected stream argument")));
        }

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let Some(stream) = this.streams.get().get(&stream_id).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };

        // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
        Ok(JSValue::from(unsafe { (*stream).end_after_headers }))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn is_stream_aborted(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_arg] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected stream argument")));
        }

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let Some(stream) = this.streams.get().get(&stream_id).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };
        // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
        let stream = unsafe { &*stream };

        if let Some(signal_ref) = &stream.signal {
            return Ok(JSValue::from(signal_ref.is_aborted()));
        }
        // closed with cancel = aborted
        Ok(JSValue::from(
            stream.state == StreamState::CLOSED && stream.rst_code == ErrorCode::CANCEL.0,
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_stream_state(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_arg] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected stream argument")));
        }

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let Some(stream) = this.streams.get().get(&stream_id).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };
        // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
        let stream = unsafe { &mut *stream };
        let state = JSValue::create_empty_object(global_object, 6);

        state.put(
            global_object,
            b"localWindowSize",
            JSValue::js_number(stream.window_size as f64),
        );
        state.put(
            global_object,
            b"state",
            JSValue::js_number(stream.state as u8 as f64),
        );
        state.put(
            global_object,
            b"localClose",
            JSValue::js_number(if stream.can_send_data() { 0.0 } else { 1.0 }),
        );
        state.put(
            global_object,
            b"remoteClose",
            JSValue::js_number(if stream.can_receive_data() { 0.0 } else { 1.0 }),
        );
        // TODO: sumDependencyWeight
        state.put(
            global_object,
            b"sumDependencyWeight",
            JSValue::js_number(0.0),
        );
        state.put(
            global_object,
            b"weight",
            JSValue::js_number(stream.weight as f64),
        );

        Ok(state)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_stream_priority(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_arg, options] = callframe.arguments_as_array::<2>();
        if callframe.arguments_count() < 2 {
            return Err(global_object.throw(format_args!("Expected stream and options arguments")));
        }

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let Some(stream_ptr) = this.streams.get().get(&stream_id).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };
        // The `options` getters below can run user JS while `stream` is borrowed.
        let mut stream = this.enter_stream_dispatch(stream_ptr);

        if !stream.can_send_data() && !stream.can_receive_data() {
            return Ok(JSValue::FALSE);
        }

        if !options.is_object() {
            return Err(global_object.throw(format_args!("Invalid priority")));
        }

        let mut weight = stream.weight;
        let mut exclusive = stream.exclusive;
        let mut parent_id = stream.stream_dependency;
        let mut silent = false;
        if let Some(js_weight) = options.get(global_object, "weight")? {
            if js_weight.is_number() {
                let weight_u32 = js_weight.to_u32();
                if weight_u32 > 255 {
                    return Err(global_object.throw(format_args!("Invalid weight")));
                }
                weight = u16::try_from(weight_u32).expect("int cast");
            }
        }

        if let Some(js_parent) = options.get(global_object, "parent")? {
            if js_parent.is_number() {
                parent_id = js_parent.to_u32();
                if parent_id == 0 || parent_id > MAX_STREAM_ID {
                    return Err(global_object.throw(format_args!("Invalid stream id")));
                }
            }
        }

        if let Some(js_exclusive) = options.get(global_object, "exclusive")? {
            exclusive = js_exclusive.to_boolean();
        }

        if let Some(js_silent) = options.get(global_object, "silent")? {
            if js_silent.is_boolean() {
                silent = js_silent.as_boolean();
            } else {
                return Err(global_object
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                        format_args!("options.silent must be a boolean"),
                    )
                    .throw());
            }
        }
        if parent_id == stream.id {
            this.send_go_away(
                stream.id,
                ErrorCode::PROTOCOL_ERROR,
                b"Stream with self dependency",
                this.last_stream_id.get(),
                true,
            );
            return Ok(JSValue::FALSE);
        }

        stream.stream_dependency = parent_id;
        stream.exclusive = exclusive;
        stream.weight = weight;

        if !silent {
            let stream_identifier =
                UInt31WithReserved::init(stream.stream_dependency, stream.exclusive);

            let priority = StreamPriority {
                stream_identifier: stream_identifier.to_uint32(),
                weight: stream.weight as u8,
            };
            let frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_PRIORITY as u8,
                flags: 0,
                stream_identifier: stream.id,
                length: StreamPriority::BYTE_SIZE as u32,
            };

            let mut writer = this.to_writer();
            let _ = frame.write(&mut writer, &this.frames_sent_legacy);
            let _ = priority.write(&mut writer);
        }
        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn rst_stream(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(H2FrameParser, "rstStream");
        let [stream_arg, error_arg] = callframe.arguments_as_array::<2>();
        if callframe.arguments_count() < 2 {
            return Err(global_object.throw(format_args!("Expected stream and code arguments")));
        }

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        if !error_arg.is_number() {
            return Err(global_object.throw(format_args!("Invalid ErrorCode")));
        }
        let error_code = error_arg.to_u32();

        // maxSessionRejectedStreams: a REFUSED_STREAM reset from the JS layer (the
        // max-concurrent-streams refusal in streamStart) is the same rejection class the engine
        // counts; budget it identically so a flood of refused streams still tears the session
        // down. Server-side only: a client's GOAWAY sweep resets its own unprocessed streams
        // with REFUSED_STREAM and must not consume the budget.
        if error_code == ErrorCode::REFUSED_STREAM.0 && this.is_server.get() {
            this.rejected_streams.set(this.rejected_streams.get() + 1);
            if this.max_rejected_streams.get() <= this.rejected_streams.get() {
                this.send_go_away(
                    stream_id,
                    ErrorCode::ENHANCE_YOUR_CALM,
                    b"ENHANCE_YOUR_CALM",
                    this.last_stream_id.get(),
                    true,
                );
                return Ok(JSValue::UNDEFINED);
            }
        }

        let Some(stream) = this.streams.get().get(&stream_id).copied() else {
            // Streams the legacy bookkeeping never registered (e.g. peer-initiated pushed streams
            // surfaced by the rewrite engine) get the RST_STREAM written directly. The frame is
            // built here rather than through the engine so this stays callable from inside an
            // engine dispatch (the engine cell may already be borrowed).
            //
            // A NO_ERROR reset for an unknown id is always a no-op: it reaches here from the
            // deferred JS close path (rstNextTick after _destroy) once a cleanly-completed
            // stream's entry has been evicted. Node sends no RST for cleanly-closed streams;
            // writing one makes the peer answer with RST(STREAM_CLOSED) per request.
            if error_code != ErrorCode::NO_ERROR.0 {
                let mut frame = [0u8; 13];
                frame[2] = 4; // length = 4
                frame[3] = 3; // RST_STREAM
                frame[5..9].copy_from_slice(&stream_id.to_be_bytes());
                frame[9..13].copy_from_slice(&error_code.to_be_bytes());
                // Hand-serialized (bypasses FrameHeader::write), so account for
                // it the way every other outbound frame site does.
                this.frames_sent_legacy
                    .set(this.frames_sent_legacy.get() + 1);
                this.write(&frame);
                let _ = this.flush();
            }
            return Ok(JSValue::TRUE);
        };

        // SAFETY: stream is a *mut Stream from self.streams; valid while the map entry exists
        this.end_stream(unsafe { &mut *stream }, ErrorCode(error_code));

        Ok(JSValue::TRUE)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — JS host fns (part 2)
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    // get memory usage in bytes
    fn get_session_memory_usage_bytes(&self) -> usize {
        let stream_count = self.streams.get().len();
        self.write_buffer.get().len_u32() as usize
            + self.queued_data_size.get() as usize
            + stream_count * core::mem::size_of::<Stream>()
    }

    // node's IsAvailableSessionMemory: byte-exact comparison against the configured MiB budget.
    // The previous integer-MiB floor allowed nearly one extra MiB through.
    fn is_over_session_memory_limit(&self) -> bool {
        self.get_session_memory_usage_bytes() > self.max_session_memory.get() as usize * 1024 * 1024
    }

    // get memory in bytes
    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_buffer_size(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            (this.write_buffer.get().len_u32() as u64 + this.queued_data_size.get()) as f64,
        ))
    }

    /// Returns `(settled_state, callback_deferred)`: the state the close tail settled on (5 =
    /// HALF_CLOSED_LOCAL, 7 = CLOSED, 0 = none) and whether `callback` was left to the caller.
    fn send_data(
        &self,
        stream: &mut Stream,
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
            if self.is_server.get() {
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

        let can_close = close && !stream.wait_for_trailers;
        if payload.is_empty() {
            // empty payload we still need to send a frame
            let data_header = FrameHeader {
                type_: FrameType::HTTP_FRAME_DATA as u8,
                flags: if can_close {
                    DataFrameFlags::END_STREAM as u8
                } else {
                    0
                },
                stream_identifier: stream_id,
                length: 0,
            };
            if self.has_backpressure() || self.outbound_queue_size.get() > 0 {
                enqueued = true;
                stream.queue_frame(self, b"", callback, close);
            } else {
                let mut writer = self.to_writer();
                let _ = data_header.write(&mut writer, &self.frames_sent_legacy);
            }
        } else {
            let mut offset: usize = 0;

            while offset < payload.len() {
                // max frame size will always be at least 16384 (but we need to respect the flow control)
                let mut max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME
                    .min(
                        (self
                            .remote_window_size
                            .get()
                            .saturating_sub(self.remote_used_window_size.get()))
                            as usize,
                    )
                    .min(
                        (stream
                            .remote_window_size
                            .saturating_sub(stream.remote_used_window_size))
                            as usize,
                    );
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

                if self.has_backpressure()
                    || self.outbound_queue_size.get() > 0
                    || is_flow_control_limited
                {
                    // Preserve wire order: anything already batched goes out before the
                    // queued remainder is flushed later by the drain path.
                    self.flush_batch_buffer();
                    enqueued = true;
                    // write the full frame in memory and queue the frame
                    // the callback will only be called after the last frame is sended
                    stream.queue_frame(
                        self,
                        slice,
                        if offset >= payload.len() {
                            callback
                        } else {
                            JSValue::UNDEFINED
                        },
                        offset >= payload.len() && close,
                    );
                } else {
                    let padding = stream.get_padding(size, max_size - 1);
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
                    stream.remote_used_window_size += payload_size as u64;
                    self.remote_used_window_size
                        .set(self.remote_used_window_size.get() + payload_size as u64);
                    self.note_engine_send_consumed(stream_id, payload_size as u64);
                    let mut flags: u8 = if end_stream {
                        DataFrameFlags::END_STREAM as u8
                    } else {
                        0
                    };
                    if padding != 0 {
                        flags |= DataFrameFlags::PADDED as u8;
                    }
                    let data_header = FrameHeader {
                        type_: FrameType::HTTP_FRAME_DATA as u8,
                        flags,
                        stream_identifier: stream_id,
                        length: u32::try_from(payload_size).expect("int cast"),
                    };
                    if payload.len() <= MAX_PAYLOAD_SIZE_WITHOUT_FRAME {
                        // Single-frame payload: the cork coalesces it with neighbors.
                        let mut writer = self.to_writer();
                        let _ = data_header.write(&mut writer, &self.frames_sent_legacy);
                        if padding != 0 {
                            let _ = writer.write_padded(slice, padding);
                        } else {
                            let _ = writer.write_all(slice);
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
                                            * FrameHeader::BYTE_SIZE
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
                            let _ = data_header.write(batch, &self.frames_sent_legacy);
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
                if stream.wait_for_trailers {
                    self.dispatch(JSH2FrameParser::Gc::onWantTrailers, stream.get_identifier());
                } else {
                    let identifier = stream.get_identifier();
                    identifier.ensure_still_alive();
                    if stream.state == StreamState::HALF_CLOSED_REMOTE {
                        stream.state = StreamState::CLOSED;
                        stream.free_resources::<false>(self);
                    } else {
                        stream.state = StreamState::HALF_CLOSED_LOCAL;
                    }
                    settled_state = stream.state as u8;
                    if !(suppress_half_closed_local_dispatch
                        && stream.state == StreamState::HALF_CLOSED_LOCAL)
                    {
                        self.dispatch_with_extra(
                            JSH2FrameParser::Gc::onStreamEnd,
                            identifier,
                            JSValue::js_number(stream.state as u8 as f64),
                        );
                    }
                }
            }
        }
        (settled_state, callback_deferred)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn no_trailers(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_arg] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!(
                "Expected stream, headers and sensitiveHeaders arguments"
            )));
        }

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected stream to be a number")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let Some(stream) = this.streams.get().get(&stream_id).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };
        // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
        let stream = unsafe { &mut *stream };

        stream.wait_for_trailers = false;
        let _ = this.send_data(
            stream,
            b"",
            JSValue::UNDEFINED,
            SendDataOptions {
                close: true,
                suppress_half_closed_local_dispatch: false,
                defer_write_callback: false,
            },
        );
        Ok(JSValue::UNDEFINED)
    }

    /// node's strictSingleValueFields option (default true): when disabled, duplicate
    /// single-value headers are encoded as-is instead of being rejected.
    fn single_value_index_checked(&self, name: &[u8]) -> Option<usize> {
        if !self.strict_single_value_fields.get() {
            return None;
        }
        single_value_headers_index_of(name)
    }

    /// setStreamReading(streamId, reading): the JS readable for the stream paused (false) or
    /// resumed (true). While paused the engine stops replenishing the stream's receive window;
    /// on resume the deferred replenishment is sent immediately so a peer stalled on a zero
    /// window is released without waiting for further inbound traffic.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_stream_reading(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_arg, reading_arg] = callframe.arguments_as_array::<2>();
        if callframe.arguments_count() < 2 {
            return Err(
                global_object.throw(format_args!("Expected streamId and reading arguments"))
            );
        }
        if !stream_arg.is_number() {
            return Ok(JSValue::UNDEFINED);
        }
        let stream_id = stream_arg.to_u32();
        let reading = reading_arg.to_boolean();
        let Some(stream) = this.streams.get().get(&stream_id).copied() else {
            // The stream already finished (or never reached the wire); nothing to backpressure.
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
        unsafe { (*stream).reading_paused = !reading };
        if reading {
            // Resumed: send the deferred WINDOW_UPDATE now. try_borrow: a resume issued from
            // inside a dispatch (the engine borrow is held by rewrite_read) is covered by the
            // batch-end replenish instead.
            if let Ok(mut guard) = this.engine.try_borrow_mut() {
                if let Some(engine) = guard.as_mut() {
                    engine.replenish_stream(this, stream_id);
                }
            }
            let _ = this.flush();
        }
        Ok(JSValue::UNDEFINED)
    }

    /// validate header name and convert to lowecase if needed
    fn to_valid_header_name<'a>(in_: &'a [u8], out: &'a mut [u8]) -> crate::Result<&'a [u8]> {
        if in_.len() > 4096 {
            return Err(crate::Error::InvalidHeaderName);
        }
        debug_assert!(out.len() >= in_.len());
        let mut in_slice = in_;
        let mut out_slice = &mut out[..];
        let mut any = false;
        // lets validate and convert to lowercase in one pass
        'begin: loop {
            for (i, &c) in in_slice.iter().enumerate() {
                match c {
                    b'A'..=b'Z' => {
                        out_slice[..i].copy_from_slice(&in_slice[0..i]);
                        out_slice[i] = c.to_ascii_lowercase();
                        let end = i + 1;
                        in_slice = &in_slice[end..];
                        out_slice = &mut out_slice[end..];
                        any = true;
                        continue 'begin;
                    }
                    b'a'..=b'z'
                    | b'0'..=b'9'
                    | b'!'
                    | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~' => {}
                    b':' => {
                        // only allow pseudoheaders at the beginning
                        if i != 0 || any {
                            return Err(crate::Error::InvalidHeaderName);
                        }
                        continue;
                    }
                    _ => return Err(crate::Error::InvalidHeaderName),
                }
            }

            if any {
                out_slice[..in_slice.len()].copy_from_slice(in_slice);
            }
            break 'begin;
        }

        Ok(if any { &out[0..in_.len()] } else { in_ })
    }

    /// Property lookups by name go through `getIfPropertyExistsImpl`, which must
    /// not be handed an integer-index-like name (debug assert). Header names that
    /// are all ASCII digits are valid HTTP tokens but can never be marked
    /// sensitive, so callers skip the lookup for them.
    fn is_index_like_name(name: &[u8]) -> bool {
        if name.is_empty() {
            return false;
        }
        for &c in name {
            if !c.is_ascii_digit() {
                return false;
            }
        }
        true
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn send_trailers(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_arg, headers_arg, sensitive_arg] = callframe.arguments_as_array::<3>();
        if callframe.arguments_count() < 3 {
            return Err(global_object.throw(format_args!(
                "Expected stream, headers and sensitiveHeaders arguments"
            )));
        }

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected stream to be a number")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let Some(stream_ptr) = this.streams.get().get(&stream_id).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };
        // The header/sensitive-object getters and value coercions below can run user JS
        // while `stream` is borrowed.
        let mut stream = this.enter_stream_dispatch(stream_ptr);

        let Some(headers_obj) = headers_arg.get_object() else {
            return Err(global_object.throw(format_args!("Expected headers to be an object")));
        };

        if !sensitive_arg.is_object() {
            return Err(
                global_object.throw(format_args!("Expected sensitiveHeaders to be an object"))
            );
        }

        let mut encoded_headers: Vec<u8> = Vec::new();
        if encoded_headers.try_reserve(16384).is_err() {
            return Err(global_object.throw(format_args!("Failed to allocate header buffer")));
        }
        // max header name length for lshpack
        let mut name_buffer = [0u8; 4096];

        let iter = bun_jsc::JSPropertyIterator::init(
            global_object,
            headers_obj,
            bun_jsc::JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
                ..Default::default()
            },
        )?;

        let mut single_value_headers = [false; SINGLE_VALUE_HEADERS_LEN];

        // Encode trailer headers using HPACK
        while let Some((header_name, js_value)) = iter.next()? {
            if header_name.length() == 0 {
                continue;
            }

            let name_slice = header_name.to_utf8();
            let name = name_slice.slice();

            if name.first() == Some(&b':') {
                let exception = global_object.to_type_error(
                    bun_jsc::ErrorCode::HTTP2_INVALID_PSEUDOHEADER,
                    format_args!(
                        "\"{}\" is an invalid pseudoheader or is used incorrectly",
                        BStr::new(name)
                    ),
                );
                return Err(global_object.throw_value(exception));
            }

            if js_value.is_undefined_or_null() {
                let exception = global_object.to_type_error(
                    bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE,
                    format_args!("Invalid value for header \"{}\"", BStr::new(name)),
                );
                return Err(global_object.throw_value(exception));
            }
            let validated_name = match Self::to_valid_header_name(name, &mut name_buffer[..]) {
                Ok(n) => n,
                Err(_) => {
                    let exception = global_object.to_type_error(
                        bun_jsc::ErrorCode::INVALID_HTTP_TOKEN,
                        format_args!(
                            "The arguments Header name is invalid. Received {}",
                            BStr::new(name)
                        ),
                    );
                    return Err(global_object.throw_value(exception));
                }
            };

            // closure for encode error handling
            let mut handle_encode = |this: &Self,
                                     value: &[u8],
                                     never_index: bool|
             -> JsResult<Option<JSValue>> {
                if !is_valid_header_value(value) {
                    let exception = global_object.to_type_error(
                        bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE,
                        format_args!("Invalid value for header \"{}\"", BStr::new(validated_name)),
                    );
                    return Err(global_object.throw_value(exception));
                }
                bun_output::scoped_log!(
                    H2FrameParser,
                    "encode header {} {}",
                    BStr::new(validated_name),
                    BStr::new(value)
                );
                match this.encode_header_into_list(
                    &mut encoded_headers,
                    validated_name,
                    value,
                    never_index,
                ) {
                    Ok(_) => Ok(None),
                    Err(crate::Error::Alloc(bun_alloc::AllocError)) => {
                        Err(global_object.throw(format_args!("Failed to allocate header buffer")))
                    }
                    Err(_) => {
                        // nghttp2 checks maxSendHeaderBlockLength pre-deflation and fires
                        // on_frame_not_send_callback(NGHTTP2_ERR_FRAME_SIZE_ERROR); Node surfaces
                        // 'frameError' + ERR_HTTP2_STREAM_ERROR (test-http2-exceeds-server-trailer-size.js).
                        let identifier = stream.get_identifier();
                        identifier.ensure_still_alive();
                        this.dispatch_with_2_extra(
                            JSH2FrameParser::Gc::onFrameError,
                            identifier,
                            JSValue::js_number(FrameType::HTTP_FRAME_HEADERS as u8 as f64),
                            JSValue::js_number(ErrorCode::FRAME_SIZE_ERROR.0 as f64),
                        );
                        let triggering_id = stream.id;
                        this.end_stream(&mut stream, ErrorCode::FRAME_SIZE_ERROR);
                        this.send_go_away(
                            triggering_id,
                            ErrorCode::NO_ERROR,
                            b"",
                            this.last_stream_id.get(),
                            true,
                        );
                        Ok(Some(JSValue::UNDEFINED))
                    }
                }
            };

            if js_value.js_type().is_array() {
                let mut value_iter = js_value.array_iterator(global_object)?;

                if let Some(idx) = this.single_value_index_checked(validated_name) {
                    if value_iter.len > 1 || single_value_headers[idx] {
                        let exception = global_object.to_type_error(
                            bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                            format_args!(
                                "Header field \"{}\" must only have a single value",
                                BStr::new(validated_name)
                            ),
                        );
                        return Err(global_object.throw_value(exception));
                    }
                    single_value_headers[idx] = true;
                }

                while let Some(item) = value_iter.next()? {
                    if item.is_empty_or_undefined_or_null() {
                        let exception = global_object.to_type_error(
                            bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE,
                            format_args!(
                                "Invalid value for header \"{}\"",
                                BStr::new(validated_name)
                            ),
                        );
                        return Err(global_object.throw_value(exception));
                    }

                    let value_view = item.to_js_string_view(global_object)?;

                    // All-digit names can't be passed to get_truthy (integer-index-like names
                    // trip a debug assert in getIfPropertyExistsImpl) and can never be sensitive.
                    let never_index = if Self::is_index_like_name(validated_name) {
                        false
                    } else {
                        match sensitive_arg.get_truthy(global_object, validated_name)? {
                            Some(_) => true,
                            None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                        }
                    };

                    let value_bytes = header_value_bytes(&value_view);
                    let value = value_bytes.as_ref();

                    if let Some(ret) = handle_encode(this, value, never_index)? {
                        return Ok(ret);
                    }
                }
            } else {
                if let Some(idx) = this.single_value_index_checked(validated_name) {
                    if single_value_headers[idx] {
                        let exception = global_object.to_type_error(
                            bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                            format_args!(
                                "Header field \"{}\" must only have a single value",
                                BStr::new(validated_name)
                            ),
                        );
                        return Err(global_object.throw_value(exception));
                    }
                    single_value_headers[idx] = true;
                }
                let value_view = js_value.to_js_string_view(global_object)?;

                // All-digit names can't be passed to get_truthy (integer-index-like names trip
                // a debug assert in getIfPropertyExistsImpl) and can never be sensitive.
                let never_index = if Self::is_index_like_name(validated_name) {
                    false
                } else {
                    match sensitive_arg.get_truthy(global_object, validated_name)? {
                        Some(_) => true,
                        None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                    }
                };

                let value_bytes = header_value_bytes(&value_view);
                let value = value_bytes.as_ref();
                bun_output::scoped_log!(
                    H2FrameParser,
                    "encode header {} {}",
                    BStr::new(name),
                    BStr::new(value)
                );

                if let Some(ret) = handle_encode(this, value, never_index)? {
                    return Ok(ret);
                }
            }
        }
        let encoded_data = encoded_headers.as_slice();
        let encoded_size = encoded_data.len();

        // RFC 7540 Section 8.1: Trailers are sent as a HEADERS frame with END_STREAM flag
        let base_flags: u8 = HeadersFrameFlags::END_STREAM as u8;
        // RFC 7540 Section 4.2: SETTINGS_MAX_FRAME_SIZE determines max frame payload
        let actual_max_frame_size = this
            .remote_settings
            .get()
            .unwrap_or_else(|| this.local_settings.get())
            .max_frame_size as usize;

        bun_output::scoped_log!(H2FrameParser, "trailers encoded_size {}", encoded_size);

        let mut writer = this.to_writer();

        if encoded_size <= actual_max_frame_size {
            // Single HEADERS frame - header block fits in one frame
            let frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags: base_flags | HeadersFrameFlags::END_HEADERS as u8,
                stream_identifier: stream.id,
                length: u32::try_from(encoded_size).expect("int cast"),
            };
            let _ = frame.write(&mut writer, &this.frames_sent_legacy);
            let _ = writer.write_all(encoded_data);
        } else {
            bun_output::scoped_log!(
                H2FrameParser,
                "Using CONTINUATION frames for trailers: encoded_size={} max_frame_size={}",
                encoded_size,
                actual_max_frame_size
            );

            let first_chunk_size = actual_max_frame_size;

            let headers_frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags: base_flags, // END_STREAM but NOT END_HEADERS
                stream_identifier: stream.id,
                length: u32::try_from(first_chunk_size).expect("int cast"),
            };
            let _ = headers_frame.write(&mut writer, &this.frames_sent_legacy);
            let _ = writer.write_all(&encoded_data[0..first_chunk_size]);

            let mut offset: usize = first_chunk_size;
            while offset < encoded_size {
                let remaining = encoded_size - offset;
                let chunk_size = remaining.min(actual_max_frame_size);
                let is_last = offset + chunk_size >= encoded_size;

                let cont_frame = FrameHeader {
                    type_: FrameType::HTTP_FRAME_CONTINUATION as u8,
                    flags: if is_last {
                        HeadersFrameFlags::END_HEADERS as u8
                    } else {
                        0
                    },
                    stream_identifier: stream.id,
                    length: u32::try_from(chunk_size).expect("int cast"),
                };
                let _ = cont_frame.write(&mut writer, &this.frames_sent_legacy);
                let _ = writer.write_all(&encoded_data[offset..offset + chunk_size]);

                offset += chunk_size;
            }
        }
        let identifier = stream.get_identifier();
        identifier.ensure_still_alive();
        if stream.state == StreamState::HALF_CLOSED_REMOTE {
            stream.state = StreamState::CLOSED;
            stream.free_resources::<false>(this);
        } else {
            stream.state = StreamState::HALF_CLOSED_LOCAL;
        }
        this.dispatch_with_extra(
            JSH2FrameParser::Gc::onStreamEnd,
            identifier,
            JSValue::js_number(stream.state as u8 as f64),
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn write_stream(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_undef::<6>();
        let [
            stream_arg,
            data_arg,
            encoding_arg,
            close_arg,
            callback_arg,
            defer_callback_arg,
        ] = args.ptr;

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected stream to be a number")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }
        let close = close_arg.to_boolean();

        let Some(stream_ptr) = this.streams.get().get(&stream_id).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };
        // Coercing `data_arg` (a String subclass's toString) can run user JS while `stream`
        // is borrowed.
        let mut stream = this.enter_stream_dispatch(stream_ptr);
        if !stream.can_send_data() {
            this.dispatch_write_callback(callback_arg);
            return Ok(JSValue::FALSE);
        }

        let encoding: Encoding = 'brk: {
            if encoding_arg.is_undefined() {
                break 'brk Encoding::Utf8;
            }
            if !encoding_arg.is_string() {
                return Err(global_object.throw_invalid_argument_type_value(
                    b"write",
                    b"encoding",
                    encoding_arg,
                ));
            }
            match Encoding::from_js(encoding_arg, global_object)? {
                Some(e) => break 'brk e,
                None => {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"write",
                        b"encoding",
                        encoding_arg,
                    ));
                }
            }
        };

        let buffer = match StringOrBuffer::from_js_with_encoding(global_object, data_arg, encoding)?
        {
            Some(b) => b,
            None => {
                return Err(global_object.throw_invalid_argument_type_value(
                    b"write",
                    b"Buffer or String",
                    data_arg,
                ));
            }
        };

        let payload = this.stable_payload(buffer.slice());
        let (settled_state, callback_deferred) = this.send_data(
            &mut stream,
            &payload,
            callback_arg,
            SendDataOptions {
                close,
                suppress_half_closed_local_dispatch: true,
                defer_write_callback: defer_callback_arg.to_boolean(),
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
        let stream_id = self.last_stream_id.get();
        if self.is_server.get() {
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

    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_next_stream_id(
        this: &Self,
        _global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments();
        debug_assert!(args_list.len() >= 1);
        let stream_id_arg = args_list[0];
        debug_assert!(stream_id_arg.is_number());
        // Store the id `get_next_stream_id` steps from. A fractional id passes the JS layer's
        // `id <= 0` check and truncates to 0 here; 0 (and 1 on a client) has no predecessor,
        // so the subtraction saturates to the initial state instead of wrapping.
        let next_stream_id = stream_id_arg.to_u32();
        let last_stream_id = if this.is_server.get() {
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
        this.last_stream_id.set(last_stream_id);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn has_native_read(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::from(matches!(
            this.native_socket.get(),
            BunSocket::Tcp(_) | BunSocket::Tls(_)
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_next_stream(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let id = this.get_next_stream_id();
        if id > MAX_STREAM_ID {
            return Ok(JSValue::js_number(-1.0));
        }
        if this.handle_received_stream_id(id).is_none() {
            return Ok(JSValue::js_number(-1.0));
        }
        Ok(JSValue::js_number(id as f64))
    }

    /// Server-side: send a PUSH_PROMISE frame on `parentId` announcing `promisedId` + the promised
    /// request headers (RFC 9113 §6.6 / §8.4). The promised (even) stream is allocated by the JS
    /// layer via getNextStream; the server then responds on it with the normal request() path.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn push_promise(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if !this.is_server.get() {
            return Err(
                global_object.throw(format_args!("Push streams can only be created by servers"))
            );
        }
        let [parent_id_arg, promised_id_arg, headers_arg, sensitive_arg] =
            callframe.arguments_as_array::<4>();
        if callframe.arguments_count() < 4 {
            return Err(global_object.throw(format_args!(
                "Expected parentId, promisedId, headers and sensitiveHeaders arguments"
            )));
        }
        let parent_id = parent_id_arg.to_u32();
        let promised_id = promised_id_arg.to_u32();
        if promised_id > MAX_STREAM_ID {
            return Ok(JSValue::js_number(-1.0));
        }
        let Some(headers_obj) = headers_arg.get_object() else {
            return Err(global_object.throw(format_args!("Expected headers to be an object")));
        };

        let mut name_buffer = [0u8; 4096];
        let mut encoded_headers: Vec<u8> = Vec::new();
        let mut single_value_headers = [false; SINGLE_VALUE_HEADERS_LEN];

        // A PUSH_PROMISE carries a REQUEST, so request pseudo-headers are valid even on the server.
        // Pseudo-headers must be encoded first, so iterate twice.
        for ignore_pseudo_headers in 0..2usize {
            let iter = bun_jsc::JSPropertyIterator::init(
                global_object,
                headers_obj,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                    ..Default::default()
                },
            )?;
            while let Some((header_name, js_value)) = iter.next()? {
                if header_name.length() == 0 {
                    continue;
                }
                let name_slice = header_name.to_utf8();
                let name = name_slice.slice();
                let validated_name = match Self::to_valid_header_name(name, &mut name_buffer[..]) {
                    Ok(n) => n,
                    Err(_) => {
                        let exception = global_object.to_type_error(
                            bun_jsc::ErrorCode::INVALID_HTTP_TOKEN,
                            format_args!(
                                "The arguments Header name is invalid. Received \"{}\"",
                                BStr::new(name)
                            ),
                        );
                        return Err(global_object.throw_value(exception));
                    }
                };
                if name.first() == Some(&b':') {
                    if ignore_pseudo_headers == 1 {
                        continue;
                    }
                    if !is_valid_request_pseudo_header(validated_name) {
                        return Err(global_object
                            .err(
                                JscErrorCode::HTTP2_INVALID_PSEUDOHEADER,
                                format_args!(
                                    "\"{}\" is an invalid pseudoheader or is used incorrectly",
                                    BStr::new(name)
                                ),
                            )
                            .throw());
                    }
                } else if ignore_pseudo_headers == 0 {
                    continue;
                }
                if js_value.is_empty_or_undefined_or_null() {
                    continue;
                }
                // All-digit names can't be passed to get_truthy (integer-index-like names trip
                // a debug assert in getIfPropertyExistsImpl) and can never be sensitive.
                let never_index = if Self::is_index_like_name(validated_name) {
                    false
                } else {
                    match sensitive_arg.get_truthy(global_object, validated_name)? {
                        Some(_) => true,
                        None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                    }
                };
                let mut encode_value = |item: JSValue| -> JsResult<Option<JSValue>> {
                    let value_view = item.to_js_string_view(global_object)?;
                    let value_bytes = header_value_bytes(&value_view);
                    let value = value_bytes.as_ref();
                    if !is_valid_header_value(value) {
                        return Err(global_object
                            .err(
                                JscErrorCode::HTTP2_INVALID_HEADER_VALUE,
                                format_args!(
                                    "Invalid value for header \"{}\"",
                                    BStr::new(validated_name)
                                ),
                            )
                            .throw());
                    }
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "encode header {} {}",
                        BStr::new(validated_name),
                        BStr::new(value)
                    );
                    if this
                        .encode_header_into_list(
                            &mut encoded_headers,
                            validated_name,
                            value,
                            never_index,
                        )
                        .is_err()
                    {
                        // Same as the request/respond encode failures: nghttp2 fails the whole
                        // session, and node never surfaces this through the pushStream callback.
                        this.schedule_header_compression_session_error();
                        return Ok(Some(JSValue::js_number(-1.0)));
                    }
                    Ok(None)
                };
                if js_value.js_type().is_array() {
                    let mut value_iter = js_value.array_iterator(global_object)?;
                    if let Some(idx) = this.single_value_index_checked(validated_name) {
                        if value_iter.len > 1 || single_value_headers[idx] {
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                                    format_args!(
                                        "Header field \"{}\" must only have a single value",
                                        BStr::new(validated_name)
                                    ),
                                )
                                .throw());
                        }
                        single_value_headers[idx] = true;
                    }
                    while let Some(item) = value_iter.next()? {
                        if item.is_empty_or_undefined_or_null() {
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_INVALID_HEADER_VALUE,
                                    format_args!(
                                        "Invalid value for header \"{}\"",
                                        BStr::new(validated_name)
                                    ),
                                )
                                .throw());
                        }
                        if let Some(ret) = encode_value(item)? {
                            return Ok(ret);
                        }
                    }
                } else {
                    if let Some(idx) = this.single_value_index_checked(validated_name) {
                        if single_value_headers[idx] {
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                                    format_args!(
                                        "Header field \"{}\" must only have a single value",
                                        BStr::new(validated_name)
                                    ),
                                )
                                .throw());
                        }
                        single_value_headers[idx] = true;
                    }
                    if let Some(ret) = encode_value(js_value)? {
                        return Ok(ret);
                    }
                }
            }
        }

        let max_frame =
            this.remote_settings
                .get()
                .map(|s| s.max_frame_size)
                .unwrap_or_else(|| this.local_settings.get().max_frame_size) as usize;
        let payload_size = 4 + encoded_headers.len();
        if payload_size <= max_frame {
            // PUSH_PROMISE frame: 9-byte header + 4-byte promised stream id + the header block.
            let mut hdr_buf = [0u8; FrameHeader::BYTE_SIZE + 4];
            let mut ws = FixedBufferStream::new(&mut hdr_buf);
            let frame = FrameHeader {
                type_: 0x05,
                flags: 0x04, // END_HEADERS
                stream_identifier: parent_id,
                length: payload_size as u32,
            };
            let _ = frame.write(&mut ws, &this.frames_sent_legacy);
            let promised_be = (promised_id & 0x7fff_ffff).swap_bytes();
            let _ = ws.write_all(&promised_be.to_ne_bytes());
            let _ = this.write(&hdr_buf);
            let _ = this.write(&encoded_headers);
        } else {
            // §6.6/§6.10: an oversized block is split - the PUSH_PROMISE (without END_HEADERS)
            // carries the promised id + the first fragment, then CONTINUATION frames on the
            // parent stream carry the rest; the last one sets END_HEADERS. Mirrors the
            // send_trailers()/request() splitting.
            let first_chunk = max_frame - 4;
            let mut hdr_buf = [0u8; FrameHeader::BYTE_SIZE + 4];
            let mut ws = FixedBufferStream::new(&mut hdr_buf);
            let frame = FrameHeader {
                type_: 0x05,
                flags: 0, // continued below
                stream_identifier: parent_id,
                length: max_frame as u32,
            };
            let _ = frame.write(&mut ws, &this.frames_sent_legacy);
            let promised_be = (promised_id & 0x7fff_ffff).swap_bytes();
            let _ = ws.write_all(&promised_be.to_ne_bytes());
            let _ = this.write(&hdr_buf);
            let _ = this.write(&encoded_headers[..first_chunk]);

            let mut offset = first_chunk;
            while offset < encoded_headers.len() {
                let chunk = (encoded_headers.len() - offset).min(max_frame);
                let is_last = offset + chunk >= encoded_headers.len();
                let mut cont_buf = [0u8; FrameHeader::BYTE_SIZE];
                let mut cs = FixedBufferStream::new(&mut cont_buf);
                let cont = FrameHeader {
                    type_: FrameType::HTTP_FRAME_CONTINUATION as u8,
                    flags: if is_last { 0x04 } else { 0 }, // END_HEADERS on the final fragment
                    stream_identifier: parent_id,
                    length: chunk as u32,
                };
                let _ = cont.write(&mut cs, &this.frames_sent_legacy);
                let _ = this.write(&cont_buf);
                let _ = this.write(&encoded_headers[offset..offset + chunk]);
                offset += chunk;
            }
        }

        let _ = this.flush();
        Ok(JSValue::js_number(promised_id as f64))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_stream_context(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_id_arg] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected stream_id argument")));
        }

        if !stream_id_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected stream_id to be a number")));
        }

        let Some(stream) = this.streams.get().get(&stream_id_arg.to_u32()).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };

        // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
        Ok(unsafe { (*stream).js_context.get() }.unwrap_or(JSValue::UNDEFINED))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_stream_context(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [stream_id_arg, context_arg] = callframe.arguments_as_array::<2>();
        if callframe.arguments_count() < 2 {
            return Err(
                global_object.throw(format_args!("Expected stream_id and context arguments"))
            );
        }

        if !stream_id_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected stream_id to be a number")));
        }
        let stream_id = stream_id_arg.to_u32();
        if context_arg.is_empty_or_undefined_or_null() {
            // Release: a pushed stream torn down before its PUSH_PROMISE left has no reset
            // dispatch coming, so the JS layer drops the context root explicitly.
            this.sctx.with_mut(|m| {
                m.remove(&stream_id);
            });
            return Ok(JSValue::UNDEFINED);
        }
        if !context_arg.is_object() {
            return Err(global_object.throw(format_args!("Expected context to be an object")));
        }

        // Rewrite engine: record the JS stream context for the engine's Sink callbacks. Dropping a
        // previous entry releases its root (StrongOptional: Drop -> destroy).
        this.sctx.with_mut(|m| {
            m.insert(
                stream_id,
                StrongOptional::create(context_arg, global_object),
            );
        });

        // Legacy path: also set on the legacy stream if it still exists (best-effort).
        if let Some(stream) = this.streams.get().get(&stream_id).copied() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            unsafe { (*stream).set_context(context_arg, global_object) };
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn for_each_stream(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.len() < 1 || !args[0].is_callable() {
            return Ok(JSValue::UNDEFINED);
        }
        let callback = args[0];
        let this_value: JSValue = if args.len() > 1 {
            args[1]
        } else {
            JSValue::UNDEFINED
        };
        let mut _count: u32 = 0;
        let mut it = StreamResumableIterator::init(this);
        while let Some(stream) = it.next() {
            // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
            let Some(value) = (unsafe { (*stream).js_context.get() }) else {
                continue;
            };
            this.handlers.get().vm.event_loop_mut().run_callback(
                callback,
                global_object,
                this_value,
                &[value],
            );
            _count += 1;
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn emit_abort_to_all_streams(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // R-2: StreamResumableIterator stores a `ParentRef`; `streams` is `JsCell`-backed,
        // so the loop body can keep using `this` (`&Self`) directly.
        let mut it = StreamResumableIterator::init(this);
        while let Some(stream_ptr) = it.next() {
            // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for
            // the lifetime of the entry. Separate heap allocation from `this`, so no aliasing.
            let stream = unsafe { &mut *stream_ptr };
            // this is the oposite logic of emitErrorToallStreams, in this case we wanna to cancel this streams
            if this.is_server.get() {
                if stream.id % 2 == 0 {
                    continue;
                }
            } else if stream.id % 2 != 0 {
                continue;
            }
            if stream.state != StreamState::CLOSED {
                let old_state = stream.state;
                stream.state = StreamState::CLOSED;
                stream.rst_code = ErrorCode::CANCEL.0;
                let identifier = stream.get_identifier();
                identifier.ensure_still_alive();
                stream.free_resources::<false>(this);
                this.dispatch_with_2_extra(
                    JSH2FrameParser::Gc::onAborted,
                    identifier,
                    JSValue::UNDEFINED,
                    JSValue::js_number(old_state as u8 as f64),
                );
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn emit_error_to_all_streams(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [error_arg] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected error argument")));
        }

        // Like `goaway`: only numbers reach `to_u32` (it requires one), and the code is read
        // once before any `&mut Stream` exists instead of once per stream inside the loop.
        if !error_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected errorCode to be a number")));
        }
        let rst_code = error_arg.to_u32();

        // R-2: StreamResumableIterator stores a `ParentRef`; `streams` is `JsCell`-backed,
        // so the loop body can keep using `this` (`&Self`) directly.
        let mut it = StreamResumableIterator::init(this);
        while let Some(stream_ptr) = it.next() {
            // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for
            // the lifetime of the entry. Separate heap allocation from `this`, so no aliasing.
            let stream = unsafe { &mut *stream_ptr };
            if stream.state != StreamState::CLOSED {
                stream.state = StreamState::CLOSED;
                stream.rst_code = rst_code;
                let identifier = stream.get_identifier();
                identifier.ensure_still_alive();
                stream.free_resources::<false>(this);
                this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, identifier, error_arg);
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn flush_from_js(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::js_number(this.flush() as f64))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn request(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(H2FrameParser, "request");

        let [
            stream_id_arg,
            stream_ctx_arg,
            headers_arg,
            sensitive_arg,
            options_arg,
        ] = callframe.arguments_as_array::<5>();
        if callframe.arguments_count() < 4 {
            return Err(global_object.throw(format_args!(
                "Expected stream_id, stream_ctx, headers and sensitiveHeaders arguments"
            )));
        }

        let Some(headers_obj) = headers_arg.get_object() else {
            return Err(global_object.throw(format_args!("Expected headers to be an object")));
        };

        if !sensitive_arg.is_object() {
            return Err(
                global_object.throw(format_args!("Expected sensitiveHeaders to be an object"))
            );
        }
        let mut encoded_headers: Vec<u8> = Vec::new();
        if encoded_headers.try_reserve(16384).is_err() {
            return Err(global_object.throw(format_args!("Failed to allocate header buffer")));
        }
        // max header name length for lshpack
        let mut name_buffer = [0u8; 4096];
        let stream_id: u32 =
            if !stream_id_arg.is_empty_or_undefined_or_null() && stream_id_arg.is_number() {
                stream_id_arg.to_u32()
            } else {
                this.get_next_stream_id()
            };
        if stream_id > MAX_STREAM_ID {
            return Ok(JSValue::js_number(-1.0));
        }

        // we iterate twice, because pseudo headers must be sent first, but can appear anywhere in the headers object
        let mut single_value_headers = [false; SINGLE_VALUE_HEADERS_LEN];

        // Raw (flat [name, value, ...] array) headers form: encode each pair in
        // its given order, pseudo-headers first (same two-pass split as the
        // object form below), preserving interleaved duplicates on the wire.
        let headers_are_raw_pairs = headers_arg.js_type().is_array();
        if headers_are_raw_pairs {
            for ignore_pseudo_headers in 0..2usize {
                let mut pairs = headers_arg.array_iterator(global_object)?;
                loop {
                    let Some(name_js) = pairs.next()? else { break };
                    let Some(value_js) = pairs.next()? else { break };
                    if name_js.is_empty_or_undefined_or_null() || value_js.is_undefined_or_null() {
                        continue;
                    }

                    let name_view = name_js.to_js_string_view(global_object)?;
                    let name_slice = name_view.to_utf8();
                    let name = name_slice.slice();
                    if name.is_empty() {
                        continue;
                    }

                    let validated_name =
                        match Self::to_valid_header_name(name, &mut name_buffer[..]) {
                            Ok(n) => n,
                            Err(_) => {
                                let exception = global_object.to_type_error(
                                    bun_jsc::ErrorCode::INVALID_HTTP_TOKEN,
                                    format_args!(
                                        "The arguments Header name is invalid. Received \"{}\"",
                                        BStr::new(name)
                                    ),
                                );
                                return Err(global_object.throw_value(exception));
                            }
                        };

                    if name.first() == Some(&b':') {
                        if ignore_pseudo_headers == 1 {
                            continue;
                        }

                        if this.is_server.get() {
                            if !is_valid_response_pseudo_header(validated_name) {
                                return Err(global_object.err(JscErrorCode::HTTP2_INVALID_PSEUDOHEADER, format_args!("\"{}\" is an invalid pseudoheader or is used incorrectly", BStr::new(name))).throw());
                            }
                        } else if !is_valid_request_pseudo_header(validated_name) {
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_INVALID_PSEUDOHEADER,
                                    format_args!(
                                        "\"{}\" is an invalid pseudoheader or is used incorrectly",
                                        BStr::new(name)
                                    ),
                                )
                                .throw());
                        }
                    } else if ignore_pseudo_headers == 0 {
                        continue;
                    }

                    if let Some(idx) = this.single_value_index_checked(validated_name) {
                        if single_value_headers[idx] {
                            let exception = global_object.to_type_error(
                                bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                                format_args!(
                                    "Header field \"{}\" must only have a single value",
                                    BStr::new(validated_name)
                                ),
                            );
                            return Err(global_object.throw_value(exception));
                        }
                        single_value_headers[idx] = true;
                    }

                    let value_view = value_js.to_js_string_view(global_object)?;

                    let never_index = if Self::is_index_like_name(validated_name) {
                        false
                    } else {
                        match sensitive_arg.get_truthy(global_object, validated_name)? {
                            Some(_) => true,
                            None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                        }
                    };

                    let value_bytes = header_value_bytes(&value_view);
                    let value = value_bytes.as_ref();
                    if !is_valid_header_value(value) {
                        return Err(global_object
                            .err(
                                JscErrorCode::HTTP2_INVALID_HEADER_VALUE,
                                format_args!(
                                    "Invalid value for header \"{}\"",
                                    BStr::new(validated_name)
                                ),
                            )
                            .throw());
                    }
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "encode header {} {}",
                        BStr::new(validated_name),
                        BStr::new(value)
                    );

                    if let Err(err) = this.encode_header_into_list(
                        &mut encoded_headers,
                        validated_name,
                        value,
                        never_index,
                    ) {
                        if matches!(err, crate::Error::Alloc(_)) {
                            return Err(global_object
                                .throw(format_args!("Failed to allocate header buffer")));
                        }
                        let Some(stream) = this.handle_received_stream_id(stream_id) else {
                            return Ok(JSValue::js_number(-1.0));
                        };
                        // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
                        let stream = unsafe { &mut *stream };
                        if !stream_ctx_arg.is_empty_or_undefined_or_null()
                            && stream_ctx_arg.is_object()
                        {
                            stream.set_context(stream_ctx_arg, global_object);
                        }
                        this.schedule_header_compression_session_error();
                        return Ok(JSValue::js_number(stream_id as f64));
                    }
                }
            }
        }

        for ignore_pseudo_headers in 0..(if headers_are_raw_pairs {
            0usize
        } else {
            2usize
        }) {
            // Note: `bun_jsc::JSPropertyIterator` (runtime-options variant) lacks `.reset()`;
            // re-initialize per pass instead — the observable property walk is the same.
            let iter = bun_jsc::JSPropertyIterator::init(
                global_object,
                headers_obj,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                    ..Default::default()
                },
            )?;

            while let Some((header_name, js_value)) = iter.next()? {
                if header_name.length() == 0 {
                    continue;
                }

                let name_slice = header_name.to_utf8();
                let name = name_slice.slice();

                let validated_name = match Self::to_valid_header_name(name, &mut name_buffer[..]) {
                    Ok(n) => n,
                    Err(_) => {
                        let exception = global_object.to_type_error(
                            bun_jsc::ErrorCode::INVALID_HTTP_TOKEN,
                            format_args!(
                                "The arguments Header name is invalid. Received \"{}\"",
                                BStr::new(name)
                            ),
                        );
                        return Err(global_object.throw_value(exception));
                    }
                };

                if name.first() == Some(&b':') {
                    if ignore_pseudo_headers == 1 {
                        continue;
                    }

                    if this.is_server.get() {
                        if !is_valid_response_pseudo_header(validated_name) {
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_INVALID_PSEUDOHEADER,
                                    format_args!(
                                        "\"{}\" is an invalid pseudoheader or is used incorrectly",
                                        BStr::new(name)
                                    ),
                                )
                                .throw());
                        }
                    } else {
                        if !is_valid_request_pseudo_header(validated_name) {
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_INVALID_PSEUDOHEADER,
                                    format_args!(
                                        "\"{}\" is an invalid pseudoheader or is used incorrectly",
                                        BStr::new(name)
                                    ),
                                )
                                .throw());
                        }
                    }
                } else if ignore_pseudo_headers == 0 {
                    continue;
                }

                if js_value.is_undefined_or_null() {
                    let exception = global_object.to_type_error(
                        bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE,
                        format_args!("Invalid value for header \"{}\"", BStr::new(name)),
                    );
                    return Err(global_object.throw_value(exception));
                }

                if js_value.js_type().is_array() {
                    bun_output::scoped_log!(H2FrameParser, "array header {}", BStr::new(name));
                    let mut value_iter = js_value.array_iterator(global_object)?;

                    if let Some(idx) = this.single_value_index_checked(validated_name) {
                        if value_iter.len > 1 || single_value_headers[idx] {
                            let exception = global_object.to_type_error(
                                bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                                format_args!(
                                    "Header field \"{}\" must only have a single value",
                                    BStr::new(validated_name)
                                ),
                            );
                            return Err(global_object.throw_value(exception));
                        }
                        single_value_headers[idx] = true;
                    }

                    while let Some(item) = value_iter.next()? {
                        if item.is_empty_or_undefined_or_null() {
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_INVALID_HEADER_VALUE,
                                    format_args!(
                                        "Invalid value for header \"{}\"",
                                        BStr::new(validated_name)
                                    ),
                                )
                                .throw());
                        }

                        let value_view = item.to_js_string_view(global_object)?;

                        let never_index = if Self::is_index_like_name(validated_name) {
                            false
                        } else {
                            match sensitive_arg.get_truthy(global_object, validated_name)? {
                                Some(_) => true,
                                None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                            }
                        };

                        let value_bytes = header_value_bytes(&value_view);
                        let value = value_bytes.as_ref();
                        if !is_valid_header_value(value) {
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_INVALID_HEADER_VALUE,
                                    format_args!(
                                        "Invalid value for header \"{}\"",
                                        BStr::new(validated_name)
                                    ),
                                )
                                .throw());
                        }
                        bun_output::scoped_log!(
                            H2FrameParser,
                            "encode header {} {}",
                            BStr::new(validated_name),
                            BStr::new(value)
                        );

                        if let Err(err) = this.encode_header_into_list(
                            &mut encoded_headers,
                            validated_name,
                            value,
                            never_index,
                        ) {
                            if matches!(err, crate::Error::Alloc(_)) {
                                return Err(global_object
                                    .throw(format_args!("Failed to allocate header buffer")));
                            }
                            let Some(stream) = this.handle_received_stream_id(stream_id) else {
                                return Ok(JSValue::js_number(-1.0));
                            };
                            // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
                            let stream = unsafe { &mut *stream };
                            if !stream_ctx_arg.is_empty_or_undefined_or_null()
                                && stream_ctx_arg.is_object()
                            {
                                stream.set_context(stream_ctx_arg, global_object);
                            }
                            this.schedule_header_compression_session_error();
                            return Ok(JSValue::UNDEFINED);
                        }
                    }
                } else if !js_value.is_empty_or_undefined_or_null() {
                    bun_output::scoped_log!(H2FrameParser, "single header {}", BStr::new(name));
                    if let Some(idx) = this.single_value_index_checked(validated_name) {
                        if single_value_headers[idx] {
                            let exception = global_object.to_type_error(
                                bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                                format_args!(
                                    "Header field \"{}\" must only have a single value",
                                    BStr::new(validated_name)
                                ),
                            );
                            return Err(global_object.throw_value(exception));
                        }
                        single_value_headers[idx] = true;
                    }
                    let value_view = js_value.to_js_string_view(global_object)?;

                    let never_index = if Self::is_index_like_name(validated_name) {
                        false
                    } else {
                        match sensitive_arg.get_truthy(global_object, validated_name)? {
                            Some(_) => true,
                            None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                        }
                    };

                    let value_bytes = header_value_bytes(&value_view);
                    let value = value_bytes.as_ref();
                    if !is_valid_header_value(value) {
                        return Err(global_object
                            .err(
                                JscErrorCode::HTTP2_INVALID_HEADER_VALUE,
                                format_args!(
                                    "Invalid value for header \"{}\"",
                                    BStr::new(validated_name)
                                ),
                            )
                            .throw());
                    }
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "encode header {} {}",
                        BStr::new(validated_name),
                        BStr::new(value)
                    );

                    if let Err(err) = this.encode_header_into_list(
                        &mut encoded_headers,
                        validated_name,
                        value,
                        never_index,
                    ) {
                        if matches!(err, crate::Error::Alloc(_)) {
                            return Err(global_object
                                .throw(format_args!("Failed to allocate header buffer")));
                        }
                        let Some(stream) = this.handle_received_stream_id(stream_id) else {
                            return Ok(JSValue::js_number(-1.0));
                        };
                        // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
                        let stream = unsafe { &mut *stream };
                        if !stream_ctx_arg.is_empty_or_undefined_or_null()
                            && stream_ctx_arg.is_object()
                        {
                            stream.set_context(stream_ctx_arg, global_object);
                        }
                        this.schedule_header_compression_session_error();
                        return Ok(JSValue::js_number(stream_id as f64));
                    }
                }
            }
        }
        let encoded_size = encoded_headers.len();

        let Some(stream_ptr) = this.handle_received_stream_id(stream_id) else {
            return Ok(JSValue::js_number(-1.0));
        };
        // The `options` getters below can run user JS while `stream` is borrowed.
        let mut stream = this.enter_stream_dispatch(stream_ptr);
        if !stream_ctx_arg.is_empty_or_undefined_or_null() && stream_ctx_arg.is_object() {
            stream.set_context(stream_ctx_arg, global_object);
        }
        let mut flags: u8 = HeadersFrameFlags::END_HEADERS as u8;
        let mut exclusive: bool = false;
        let mut has_priority: bool = false;
        let mut weight: i32 = 0;
        let mut parent: i32 = 0;
        let mut silent: bool = false;
        let mut wait_for_trailers: bool = false;
        let mut end_stream: bool = false;
        if callframe.arguments_count() > 4 && !options_arg.is_empty_or_undefined_or_null() {
            let options = options_arg;
            if !options.is_object() {
                stream.state = StreamState::CLOSED;
                stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
                this.dispatch_with_extra(
                    JSH2FrameParser::Gc::onStreamError,
                    stream.get_identifier(),
                    JSValue::js_number(stream.rst_code as f64),
                );
                return Ok(JSValue::js_number(stream_id as f64));
            }

            if let Some(padding_js) = options.get(global_object, "paddingStrategy")? {
                if padding_js.is_number() {
                    stream.padding_strategy = match padding_js.to_u32() {
                        1 => PaddingStrategy::Aligned,
                        2 => PaddingStrategy::Max,
                        _ => PaddingStrategy::None,
                    };
                }
            }

            if let Some(trailes_js) = options.get(global_object, "waitForTrailers")? {
                if trailes_js.is_boolean() {
                    wait_for_trailers = trailes_js.as_boolean();
                    stream.wait_for_trailers = wait_for_trailers;
                }
            }

            if let Some(silent_js) = options.get(global_object, "silent")? {
                if silent_js.is_boolean() {
                    silent = silent_js.as_boolean();
                } else {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"options.silent",
                        b"boolean",
                        silent_js,
                    ));
                }
            }

            if let Some(end_stream_js) = options.get(global_object, "endStream")? {
                if end_stream_js.is_boolean() {
                    if end_stream_js.as_boolean() {
                        end_stream = true;
                        // will end the stream after trailers
                        if !wait_for_trailers || this.is_server.get() {
                            flags |= HeadersFrameFlags::END_STREAM as u8;
                        }
                    }
                } else {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"options.endStream",
                        b"boolean",
                        end_stream_js,
                    ));
                }
            }

            if let Some(exclusive_js) = options.get(global_object, "exclusive")? {
                if exclusive_js.is_boolean() {
                    if exclusive_js.as_boolean() {
                        exclusive = true;
                        stream.exclusive = true;
                        has_priority = true;
                    }
                } else {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"options.exclusive",
                        b"boolean",
                        exclusive_js,
                    ));
                }
            }

            if let Some(parent_js) = options.get(global_object, "parent")? {
                if parent_js.is_number() || parent_js.is_int32() {
                    has_priority = true;
                    parent = parent_js.to_int32();
                    if parent <= 0 || parent as u32 > MAX_STREAM_ID {
                        stream.state = StreamState::CLOSED;
                        stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
                        this.dispatch_with_extra(
                            JSH2FrameParser::Gc::onStreamError,
                            stream.get_identifier(),
                            JSValue::js_number(stream.rst_code as f64),
                        );
                        return Ok(JSValue::js_number(stream.id as f64));
                    }
                    stream.stream_dependency = u32::try_from(parent).expect("int cast");
                } else {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"options.parent",
                        b"number",
                        parent_js,
                    ));
                }
            }

            if let Some(weight_js) = options.get(global_object, "weight")? {
                if weight_js.is_number() || weight_js.is_int32() {
                    has_priority = true;
                    weight = weight_js.to_int32();
                    if weight < 1 || weight > u8::MAX as i32 {
                        stream.state = StreamState::CLOSED;
                        stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
                        this.dispatch_with_extra(
                            JSH2FrameParser::Gc::onStreamError,
                            stream.get_identifier(),
                            JSValue::js_number(stream.rst_code as f64),
                        );
                        return Ok(JSValue::js_number(stream_id as f64));
                    }
                    stream.weight = u16::try_from(weight).expect("int cast");
                } else {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"options.weight",
                        b"number",
                        weight_js,
                    ));
                }

                if weight < 1 || weight > u8::MAX as i32 {
                    stream.state = StreamState::CLOSED;
                    stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
                    this.dispatch_with_extra(
                        JSH2FrameParser::Gc::onStreamError,
                        stream.get_identifier(),
                        JSValue::js_number(stream.rst_code as f64),
                    );
                    return Ok(JSValue::js_number(stream_id as f64));
                }

                stream.weight = u16::try_from(weight).expect("int cast");
            }

            if let Some(signal_arg) = options.get(global_object, "signal")? {
                if let Some(signal_ptr) = AbortSignal::from_js(signal_arg) {
                    // SAFETY: `from_js` returns a live *mut AbortSignal owned by JSC; rooted via `signal_arg` on the stack.
                    let signal_ = unsafe { &mut *signal_ptr };
                    if signal_.aborted() {
                        stream.state = StreamState::IDLE;
                        let wrapped =
                            Bun__wrapAbortError(global_object, signal_.js_reason(global_object));
                        this.abort_stream(&mut stream, wrapped);
                        return Ok(JSValue::js_number(stream_id as f64));
                    }
                    stream.attach_signal(this, signal_);
                } else {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"options.signal",
                        b"AbortSignal",
                        signal_arg,
                    ));
                }
            }
        }

        // too much memory being use
        if this.is_over_session_memory_limit() {
            stream.state = StreamState::CLOSED;
            stream.rst_code = ErrorCode::ENHANCE_YOUR_CALM.0;
            this.rejected_streams.set(this.rejected_streams.get() + 1);
            this.dispatch_with_extra(
                JSH2FrameParser::Gc::onStreamError,
                stream.get_identifier(),
                JSValue::js_number(stream.rst_code as f64),
            );
            if this.rejected_streams.get() >= this.max_rejected_streams.get() {
                let global = this.handlers.get().global();
                let chunk = this
                    .handlers
                    .get()
                    .binary_type
                    .to_js(b"ENHANCE_YOUR_CALM", &global)?;
                this.dispatch_with_2_extra(
                    JSH2FrameParser::Gc::onError,
                    JSValue::js_number(ErrorCode::ENHANCE_YOUR_CALM.0 as f64),
                    JSValue::js_number(this.last_stream_id.get() as f64),
                    chunk,
                );
            }
            return Ok(JSValue::js_number(stream_id as f64));
        }
        let mut length: usize = encoded_size;
        if has_priority {
            length += 5;
            flags |= HeadersFrameFlags::PRIORITY as u8;
        }

        bun_output::scoped_log!(H2FrameParser, "request encoded_size {}", encoded_size);

        // Check if headers block exceeds maxSendHeaderBlockLength
        if this.max_send_header_block_length.get() != 0
            && encoded_size > this.max_send_header_block_length.get() as usize
        {
            stream.state = StreamState::CLOSED;
            stream.rst_code = ErrorCode::REFUSED_STREAM.0;

            this.dispatch_with_2_extra(
                JSH2FrameParser::Gc::onFrameError,
                stream.get_identifier(),
                JSValue::js_number(FrameType::HTTP_FRAME_HEADERS as u8 as f64),
                JSValue::js_number(ErrorCode::FRAME_SIZE_ERROR.0 as f64),
            );

            this.dispatch_with_extra(
                JSH2FrameParser::Gc::onStreamError,
                stream.get_identifier(),
                JSValue::js_number(stream.rst_code as f64),
            );
            return Ok(JSValue::js_number(stream_id as f64));
        }

        let actual_max_frame_size = this
            .remote_settings
            .get()
            .unwrap_or_else(|| this.local_settings.get())
            .max_frame_size as usize;
        let priority_overhead: usize = if has_priority {
            StreamPriority::BYTE_SIZE
        } else {
            0
        };
        let available_payload = actual_max_frame_size - priority_overhead;
        // Reserve one byte for the pad-length field so `encoded_size +
        // padding_overhead` never exceeds `available_payload`; otherwise the
        // CONTINUATION branch below would slice past the end of the encoded
        // header block. CONTINUATION frames cannot carry padding, so it is
        // disabled whenever the block does not fit in a single HEADERS frame.
        let padding: u8 = if encoded_size >= available_payload {
            0
        } else {
            stream.get_padding(encoded_size, available_payload - 1)
        };
        let padding_overhead: usize = if padding != 0 {
            padding as usize + 1
        } else {
            0
        };
        let headers_frame_max_payload = available_payload - padding_overhead;

        let mut writer = this.to_writer();

        // Check if we need CONTINUATION frames
        if encoded_size <= headers_frame_max_payload {
            // Single HEADERS frame - fits in one frame
            let payload_size = encoded_size + priority_overhead + padding_overhead;
            bun_output::scoped_log!(
                H2FrameParser,
                "padding: {} size: {} max_size: {} payload_size: {}",
                padding,
                encoded_size,
                encoded_headers.len(),
                payload_size
            );

            if padding != 0 {
                flags |= HeadersFrameFlags::PADDED as u8;
                // Grow before any frame byte is written: failing after the header went out
                // would abandon the frame mid-serialization (the JS-transport tracker would
                // hold the stream mid-frame and the wire would owe a payload).
                if encoded_headers
                    .try_reserve(encoded_size + padding_overhead - encoded_headers.len())
                    .is_err()
                {
                    return Err(
                        global_object.throw(format_args!("Failed to allocate padding buffer"))
                    );
                }
            }

            let frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags,
                stream_identifier: stream.id,
                length: u32::try_from(payload_size).expect("int cast"),
            };
            let _ = frame.write(&mut writer, &this.frames_sent_legacy);

            // Write priority data if present
            if has_priority {
                let stream_identifier =
                    UInt31WithReserved::init(u32::try_from(parent).expect("int cast"), exclusive);
                let priority_data = StreamPriority {
                    stream_identifier: stream_identifier.to_uint32(),
                    weight: u8::try_from(weight).expect("int cast"),
                };
                let _ = priority_data.write(&mut writer);
            }

            // Handle padding
            if padding != 0 {
                // Zero-fill the padding region (RFC 7540 §6.2: padding octets MUST be zero) and
                // ensure the slice we hand to writer covers only initialized bytes. Cannot
                // allocate: the capacity was reserved above, before the frame header went out.
                encoded_headers.resize(encoded_size + padding_overhead, 0);
                let buffer = encoded_headers.as_mut_slice();
                // memmove: shift right by 1 to make room for the pad-length byte
                buffer.copy_within(0..encoded_size, 1);
                buffer[0] = padding;
                let _ = writer.write_all(buffer);
            } else {
                let _ = writer.write_all(&encoded_headers);
            }
        } else {
            bun_output::scoped_log!(
                H2FrameParser,
                "Using CONTINUATION frames: encoded_size={} max_frame_payload={}",
                encoded_size,
                actual_max_frame_size
            );

            let first_chunk_size = actual_max_frame_size - priority_overhead;
            let headers_flags = flags & !(HeadersFrameFlags::END_HEADERS as u8);

            let headers_frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags: headers_flags
                    | (if has_priority {
                        HeadersFrameFlags::PRIORITY as u8
                    } else {
                        0
                    }),
                stream_identifier: stream.id,
                length: u32::try_from(first_chunk_size + priority_overhead).expect("int cast"),
            };
            let _ = headers_frame.write(&mut writer, &this.frames_sent_legacy);

            if has_priority {
                let stream_identifier =
                    UInt31WithReserved::init(u32::try_from(parent).expect("int cast"), exclusive);
                let priority_data = StreamPriority {
                    stream_identifier: stream_identifier.to_uint32(),
                    weight: u8::try_from(weight).expect("int cast"),
                };
                let _ = priority_data.write(&mut writer);
            }

            // Write first chunk of header block fragment
            let _ = writer.write_all(&encoded_headers[0..first_chunk_size]);

            let mut offset: usize = first_chunk_size;
            while offset < encoded_size {
                let remaining = encoded_size - offset;
                let chunk_size = remaining.min(actual_max_frame_size);
                let is_last = offset + chunk_size >= encoded_size;

                let cont_frame = FrameHeader {
                    type_: FrameType::HTTP_FRAME_CONTINUATION as u8,
                    flags: if is_last {
                        HeadersFrameFlags::END_HEADERS as u8
                    } else {
                        0
                    },
                    stream_identifier: stream.id,
                    length: u32::try_from(chunk_size).expect("int cast"),
                };
                let _ = cont_frame.write(&mut writer, &this.frames_sent_legacy);
                let _ = writer.write_all(&encoded_headers[offset..offset + chunk_size]);

                offset += chunk_size;
            }
        }

        if end_stream {
            stream.end_after_headers = true;

            if wait_for_trailers {
                stream.state = StreamState::HALF_CLOSED_LOCAL;
                this.dispatch(JSH2FrameParser::Gc::onWantTrailers, stream.get_identifier());
                return Ok(JSValue::js_number(stream_id as f64));
            }

            // A HEADERS frame carrying END_STREAM half-closes our side; when
            // the peer already half-closed (a server responding after the
            // request body finished) the stream is now fully closed. Mirror
            // send_data / send_trailers: transition the state forward and
            // dispatch onStreamEnd — without this a headers-only END_STREAM
            // response regressed the state to HALF_CLOSED_LOCAL and never
            // told JS, leaking the stream (and the session's connection
            // count) until socket close.
            let identifier = stream.get_identifier();
            identifier.ensure_still_alive();
            if stream.state == StreamState::HALF_CLOSED_REMOTE {
                stream.state = StreamState::CLOSED;
                stream.free_resources::<false>(this);
            } else {
                stream.state = StreamState::HALF_CLOSED_LOCAL;
            }
            this.dispatch_with_extra(
                JSH2FrameParser::Gc::onStreamEnd,
                identifier,
                JSValue::js_number(stream.state as u8 as f64),
            );
        } else {
            stream.wait_for_trailers = wait_for_trailers;
        }

        if silent {
            // TODO: should we make use of this in the future? We validate it.
        }

        let _ = length;
        Ok(JSValue::js_number(stream_id as f64))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn read(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [buffer] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected 1 argument")));
        }
        buffer.ensure_still_alive();
        // Same engine-driven inbound path as on_native_read (JS-fed sockets / proxied streams).
        // The engine dispatches into JS between frames, and a handler can detach/transfer this
        // ArrayBuffer; copy the bytes so the parse never reads freed memory.
        if let Some(array_buffer) = buffer.as_array_buffer(global_object) {
            let copied = array_buffer.byte_slice().to_vec();
            this.rewrite_read(&copied);
            if this.left_exception.replace(false) {
                return Err(bun_jsc::JsError::Thrown);
            }
            Ok(JSValue::UNDEFINED)
        } else {
            Err(global_object.throw(format_args!("Expected data to be a Buffer or ArrayBuffer")))
        }
    }

    pub(crate) fn on_native_read(&self, data: &[u8]) -> JsResult<()> {
        bun_output::scoped_log!(H2FrameParser, "onNativeRead");
        let _keepalive = self.keepalive();
        // Engine-driven inbound: all reads flow through the rewritten connection engine.
        self.rewrite_read(data);
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
    }

    pub(crate) fn on_native_close(&self) {
        bun_output::scoped_log!(H2FrameParser, "onNativeClose");
        // detach_native_socket can drop the socket's last ref (Writeonly deref),
        // so match on_native_read/on_native_writable and hold our own +1.
        let _keepalive = self.keepalive();
        self.detach_native_socket();
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_native_socket_from_js(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [socket_js] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected socket argument")));
        }

        this.detach_native_socket();
        if let Some(socket) = TLSSocket::from_js(socket_js) {
            bun_output::scoped_log!(H2FrameParser, "TLSSocket attached");
            this.native_socket.attach::<true>(socket, this.ref_guard());
            // if we started with non native and go to native we now control the backpressure internally
            this.has_nonnative_backpressure.set(false);
            let _ = this.flush();
        } else if let Some(socket) = TCPSocket::from_js(socket_js) {
            bun_output::scoped_log!(H2FrameParser, "TCPSocket attached");
            this.native_socket.attach::<false>(socket, this.ref_guard());
            // if we started with non native and go to native we now control the backpressure internally
            this.has_nonnative_backpressure.set(false);
            let _ = this.flush();
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn detach_native_socket(&self) {
        self.native_socket.detach();
    }

    /// Saturating read of a numeric session limit into its u32 field.
    fn session_option_u32(value: JSValue) -> u32 {
        u32::try_from(value.to_uint64_no_truncate()).unwrap_or(u32::MAX)
    }

    pub(crate) fn constructor(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<*mut H2FrameParser> {
        let [options] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_object.throw(format_args!("Expected 1 argument")));
        }

        if options.is_empty_or_undefined_or_null() || options.is_boolean() || !options.is_object() {
            return Err(
                global_object.throw_invalid_arguments(format_args!("expected options as argument"))
            );
        }

        let Some(context_obj) = options.get(global_object, "context")? else {
            return Err(global_object.throw(format_args!("Expected \"context\" option")));
        };
        let mut handler_js = JSValue::ZERO;
        if let Some(handlers_) = options.get(global_object, "handlers")? {
            handler_js = handlers_;
        }
        let handlers = Handlers::from_js(global_object, handler_js, this_value)?;

        let init = H2FrameParser {
            ref_count: bun_ptr::RefCount::init(),
            native_keepalives: Cell::new(0),
            handlers: JsCell::new(handlers),
            global_this: GlobalRef::from(global_object),
            strong_this: JsCell::new(JsRef::empty()),
            native_socket: NativeSocket::default(),
            local_settings: Cell::new(FullSettingsPayload::default()),
            explicit_settings: Cell::new(0),
            custom_settings: JsCell::new(Vec::new()),
            wire_custom_settings: JsCell::new(Vec::new()),
            remote_custom_settings_filter: JsCell::new(Vec::new()),
            remote_custom_settings: JsCell::new(Vec::new()),
            enforced_max_header_list_size: Cell::new(
                FullSettingsPayload::default().max_header_list_size,
            ),
            remote_settings: Cell::new(None),
            window_size: Cell::new(DEFAULT_WINDOW_SIZE),
            used_window_size: Cell::new(0),
            remote_window_size: Cell::new(DEFAULT_WINDOW_SIZE),
            remote_used_window_size: Cell::new(0),
            max_header_list_pairs: Cell::new(128),
            max_settings: Cell::new(32),
            pending_recv_window_growth: Cell::new(0),
            pending_send_window_consumed: Cell::new(0),
            pending_stream_send_consumed: JsCell::new(Vec::new()),
            pending_engine_stream_closes: JsCell::new(Vec::new()),
            dispatch_depth: Cell::new(0),
            pending_settings_window_submissions: JsCell::new(Vec::new()),
            max_rejected_streams: Cell::new(100),
            max_session_invalid_frames: Cell::new(1000),
            max_outstanding_settings: Cell::new(10),
            outstanding_settings: Cell::new(0),
            rejected_streams: Cell::new(0),
            max_session_memory: Cell::new(10),
            queued_data_size: Cell::new(0),
            max_outstanding_pings: Cell::new(10),
            out_standing_pings: Cell::new(0),
            max_send_header_block_length: Cell::new(0),
            strict_single_value_fields: Cell::new(true),
            last_stream_id: Cell::new(0),
            last_peer_stream_id: Cell::new(0),
            is_server: Cell::new(false),
            left_exception: Cell::new(false),
            write_buffer: JsCell::new(Vec::<u8>::default()),
            write_buffer_offset: Cell::new(0),
            outbound_queue_size: Cell::new(0),
            streams: JsCell::new(BunHashMap::default()),
            hpack: JsCell::new(None),
            has_nonnative_backpressure: Cell::new(false),
            js_socket_flushing: Cell::new(false),
            transport_write_fatal: Cell::new(false),
            pending_header_compression_error: Cell::new(false),
            frames_sent_legacy: Cell::new(0),
            engine_frames_received: Cell::new(0),
            engine_frames_sent: Cell::new(0),
            tx_tracker: Cell::new(TxFrameTracker::default()),
            auto_flusher: JsCell::new(AutoFlusher::default()),
            padding_strategy: Cell::new(PaddingStrategy::None),
            engine: core::cell::RefCell::new(None),
            rewrite_tail: JsCell::new(Vec::new()),
            rewrite_pending_push: Cell::new(0),
            sctx: JsCell::new(BunHashMap::default()),
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
        // The remaining `?` sites below may throw a JS exception; the guard
        // drops `this` (its `Drop` detaches any socket attached below) and
        // returns the slot to the pool / frees the Box. Defused on success.
        let guard = scopeguard::guard(this, Self::release);
        // SAFETY: `this` was just allocated above; unique ownership, non-null.
        // R-2: deref as shared — every method below takes `&self`.
        let this_ref = unsafe { &*this };

        // check if socket is provided, and if it is a valid native socket
        if let Some(socket_js) = options.get(global_object, "native")? {
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
        }
        if let Some(settings_js) = options.get(global_object, "settings")? {
            if !settings_js.is_empty_or_undefined_or_null() {
                bun_output::scoped_log!(H2FrameParser, "settings received in the constructor");
                this_ref.load_settings_from_js_value(global_object, settings_js)?;
                // The constructor settings ride on the connection preface, so received header
                // blocks are checked against them right away; later settings() submissions only
                // take effect for enforcement once the peer ACKs them.
                this_ref
                    .enforced_max_header_list_size
                    .set(this_ref.local_settings.get().max_header_list_size);

                if let Some(max_pings) = settings_js.get(global_object, "maxOutstandingPings")? {
                    if max_pings.is_number() {
                        this_ref
                            .max_outstanding_pings
                            .set(max_pings.to_uint64_no_truncate());
                    }
                }
                if let Some(max_memory) = settings_js.get(global_object, "maxSessionMemory")? {
                    if max_memory.is_number() {
                        this_ref
                            .max_session_memory
                            .set(Self::session_option_u32(max_memory).max(1));
                    }
                }
                if let Some(max_header_list_pairs) =
                    settings_js.get(global_object, "maxHeaderListPairs")?
                {
                    if max_header_list_pairs.is_number() {
                        this_ref
                            .max_header_list_pairs
                            .set(Self::session_option_u32(max_header_list_pairs).max(4));
                    }
                }
                if let Some(max_settings) = settings_js.get(global_object, "maxSettings")? {
                    if max_settings.is_number() {
                        this_ref
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
                            .max_session_invalid_frames
                            .set(Self::session_option_u32(max_session_invalid_frames));
                    }
                }
                if let Some(max_outstanding_settings) =
                    settings_js.get(global_object, "maxOutstandingSettings")?
                {
                    if max_outstanding_settings.is_number() {
                        this_ref
                            .max_outstanding_settings
                            .set(Self::session_option_u32(max_outstanding_settings).max(1));
                    }
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
                            .padding_strategy
                            .set(match padding_strategy.to_u32() {
                                1 => PaddingStrategy::Aligned,
                                2 => PaddingStrategy::Max,
                                _ => PaddingStrategy::None,
                            });
                    }
                }
            }
        }
        let mut is_server = false;
        if let Some(type_js) = options.get(global_object, "type")? {
            is_server = type_js.is_number() && type_js.to_u32() == 0;
        }

        this_ref.is_server.set(is_server);
        JSH2FrameParser::Gc::context.set(this_value, global_object, context_obj);

        this_ref
            .strong_this
            .with_mut(|s| s.set_strong(this_value, global_object));

        // Note: `HPACK::init` returns a C-allocated wrapper that must be
        // torn down via `lshpack_wrapper_deinit` (runs `lshpack_{enc,dec}_cleanup`
        // before freeing). Wrapping it in `heap::take` and letting `Box` drop
        // would `mi_free` the struct but leak the encoder/decoder internals.
        this_ref.hpack.set(Some(lshpack::HpackHandle::new(
            this_ref.local_settings.get().header_table_size,
        )));
        if is_server {
            let _ = this_ref.set_settings(this_ref.local_settings.get());
        } else {
            // consider that we need to queue until the first flush
            this_ref.has_nonnative_backpressure.set(true);
            this_ref.send_preface_and_settings();
        }
        Ok(scopeguard::ScopeGuard::into_inner(guard))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn detach_from_js(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // R-2: StreamResumableIterator stores a `ParentRef`; `streams` is `JsCell`-backed,
        // so the loop body can keep using `this` (`&Self`) directly.
        let mut it = StreamResumableIterator::init(this);
        while let Some(stream) = it.next() {
            // SAFETY: stream is *mut Stream from self.streams; valid until freed below / map
            // cleared. `stream` points into a disjoint Box.
            unsafe { (*stream).free_resources::<false>(this) };
        }
        this.detach();
        if let Some(this_value) = this.strong_this.get().try_get() {
            // `global_this` is `GlobalRef` (JSC_BORROW) — Deref gives `&JSGlobalObject`.
            JSH2FrameParser::Gc::context.clear(this_value, &this.global_this);
            this.strong_this.with_mut(|s| s.set_weak(this_value));
        }
        Ok(JSValue::UNDEFINED)
    }

    /// be careful when calling detach be sure that the socket is closed and the parser not accesible anymore
    /// this function can be called multiple times, it will erase stream info
    pub(crate) fn detach(&self) {
        self.uncork();
        self.unregister_auto_flush();
        self.detach_native_socket();

        // Free the allocation, not just the length: detach() is reachable from JS without a
        // following `deinit`, so the capacity must be released here.
        self.write_buffer.with_mut(|wb| wb.clear_and_free());
        self.tx_tracker.set(TxFrameTracker::default());
        // Drop every per-stream JS context root; the parser is detaching.
        self.sctx.with_mut(|m| m.clear());
        self.write_buffer_offset.set(0);

        // `HpackHandle::drop` → `lshpack_wrapper_deinit` (cleanup + free).
        self.hpack.set(None);
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

impl Drop for H2FrameParser {
    fn drop(&mut self) {
        bun_output::scoped_log!(H2FrameParser, "deinit");

        self.detach();
        // Note: take the map out first so `self` is free for
        // `free_resources(self)` while we walk the entries.
        let streams = self.streams.replace(BunHashMap::default());
        for (_, item) in streams.iter() {
            let stream = *item;
            // SAFETY: stream is *mut Stream from self.streams; this is final teardown, freed exactly once via heap::take
            unsafe {
                (*stream).free_resources::<true>(self);
                drop(bun_core::heap::take(stream));
            }
        }
        drop(streams);
    }
}

impl H2FrameParser {
    pub(crate) fn finalize(&self) {
        bun_output::scoped_log!(H2FrameParser, "finalize");
        self.strong_this.set(JsRef::empty());
        if VirtualMachine::get().is_shutting_down() {
            // Free the streams first: `free_resources` releases the refs their signals hold.
            // The map is emptied so a later `Drop` won't double-free.
            let streams = self.streams.replace(BunHashMap::default());
            for (_, item) in streams.iter() {
                let stream = *item;
                // SAFETY: map has been emptied; each entry is freed exactly once.
                unsafe {
                    (*stream).free_resources::<true>(self);
                    drop(bun_core::heap::take(stream));
                }
            }
            drop(streams);
            // Then the refs of frames/tasks that will never run again, so the
            // wrapper's deref can actually reach zero and run `Drop`.
            self.release_refs_stranded_by_exit();
        }
    }
}
