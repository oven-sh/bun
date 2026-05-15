//! HTTP/2 frame parser — ported from h2_frame_parser.zig
#![allow(
    non_camel_case_types,
    non_upper_case_globals,
    clippy::too_many_arguments
)]

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::ptr::NonNull;

use crate::api::socket::{TCPSocket, TLSSocket};
use crate::node::{Encoding, StringOrBuffer};
use crate::socket::NativeCallbacks;
use crate::webcore::AutoFlusher;
use bstr::BStr;
use bun_collections::{ByteVecExt, HashMap as BunHashMap, HiveArrayFallback, VecExt};
use bun_core::MutableString;
use bun_core::{String as BunString, ZigString, strings};
use bun_http::lshpack;
use bun_jsc::AbortSignal;
use bun_jsc::ErrorCode as JscErrorCode;
use bun_jsc::StringJsc as _;
use bun_jsc::abort_signal::AbortListener;
use bun_jsc::array_buffer::BinaryType;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsClass, JsRef, JsResult, Strong,
    StrongOptional,
};
use bun_ptr::IntrusiveRc;

bun_output::declare_scope!(H2FrameParser, visible);

// ──────────────────────────────────────────────────────────────────────────
// Codegen modules — `jsc.Codegen.JSH2FrameParser` / `JSTCPSocket` / `JSTLSSocket`.
// Hand-rolled extern bindings to the C++ shims emitted by generate-classes.ts
// (see `${TypeName}__fromJS` etc. in build/*/codegen/ZigGeneratedClasses.cpp);
// replace with the macro-derived modules once the .rs codegen backend lands.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_snake_case, non_camel_case_types, dead_code)]
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
        onFrameError
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

    /// Lazily fetch the JS constructor from `globalObject` (Zig:
    /// `JSH2FrameParser.getConstructor`).
    #[inline]
    pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
        __get_constructor(global.as_mut_ptr())
    }
}
// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const MAX_PAYLOAD_SIZE_WITHOUT_FRAME: usize = 16384 - FrameHeader::BYTE_SIZE - 1;

#[derive(Default, Clone, Copy)]
enum BunSocket {
    #[default]
    None,
    // BACKREF — the socket strictly outlives the H2FrameParser while attached:
    // `Tls`/`Tcp` are kept alive by the `IntrusiveRc<H2FrameParser>` stored in
    // the socket's `native_callback` slot (released in `detach_native_socket`),
    // and `*Writeonly` are kept alive by the manual `ref_()`/`deref()` pair in
    // `attach_to_native_socket` / `detach_native_socket`. `BackRef` makes the
    // shared-only deref safe at every read site (all `NewSocket` methods used
    // here take `&self`). LIFETIMES.tsv: SHARED — intrusive refcount, *T
    // crosses FFI; `NewSocket<SSL>` does not implement `bun_ptr::RefCounted`
    // (hand-rolled `ref_()/deref()` on a `Cell<u32>`), so `IntrusiveArc` cannot
    // wrap it.
    Tls(bun_ptr::BackRef<TLSSocket>),
    TlsWriteonly(bun_ptr::BackRef<TLSSocket>),
    Tcp(bun_ptr::BackRef<TCPSocket>),
    TcpWriteonly(bun_ptr::BackRef<TCPSocket>),
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    safe fn JSC__JSGlobalObject__getHTTP2CommonString(
        global_object: &JSGlobalObject,
        hpack_index: u32,
    ) -> JSValue;
    safe fn Bun__wrapAbortError(global_object: &JSGlobalObject, cause: JSValue) -> JSValue;
}

// ──────────────────────────────────────────────────────────────────────────
// Local shim for `globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE*, fmt, .{}).throw()`
// (Zig codegen surfaces these as per-code helper methods on JSGlobalObject; the
// Rust ErrorCode table exposes them via `JscErrorCode::*` instead.)
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
    fn err_invalid_arg_type(&self, msg: &'static str) -> H2ErrBuilder<'_>;
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
    #[inline]
    fn err_invalid_arg_type(&self, msg: &'static str) -> H2ErrBuilder<'_> {
        H2ErrBuilder {
            global: self,
            code: JscErrorCode::INVALID_ARG_TYPE,
            msg,
        }
    }
}

pub fn get_http2_common_string(
    global_object: &JSGlobalObject,
    hpack_index: u32,
) -> Option<JSValue> {
    if hpack_index == 255 {
        return None;
    }
    let value = JSC__JSGlobalObject__getHTTP2CommonString(global_object, hpack_index);
    if value.is_empty_or_undefined_or_null() {
        return None;
    }
    Some(value)
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
// RFC 7541 Section 4.1: Each header entry has 32 bytes of overhead
// for the HPACK dynamic table entry structure
const HPACK_ENTRY_OVERHEAD: usize = 32;
// Maximum number of custom settings (same as Node.js MAX_ADDITIONAL_SETTINGS)
const MAX_CUSTOM_SETTINGS: usize = 10;
// Maximum custom setting ID (0xFFFF per RFC 7540)
const MAX_CUSTOM_SETTING_ID: f64 = 0xFFFF as f64;

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
    HTTP_FRAME_PUSH_PROMISE = 0x05,
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

#[repr(u8)]
enum SettingsFlags {
    ACK = 0x1,
}

// Non-exhaustive enum in Zig (`_` catch-all) → newtype over u32
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ErrorCode(u32);
impl ErrorCode {
    const NO_ERROR: Self = Self(0x0);
    const PROTOCOL_ERROR: Self = Self(0x1);
    const INTERNAL_ERROR: Self = Self(0x2);
    const FLOW_CONTROL_ERROR: Self = Self(0x3);
    const SETTINGS_TIMEOUT: Self = Self(0x4);
    const STREAM_CLOSED: Self = Self(0x5);
    const FRAME_SIZE_ERROR: Self = Self(0x6);
    const REFUSED_STREAM: Self = Self(0x7);
    const CANCEL: Self = Self(0x8);
    const COMPRESSION_ERROR: Self = Self(0x9);
    const CONNECT_ERROR: Self = Self(0xa);
    const ENHANCE_YOUR_CALM: Self = Self(0xb);
    const INADEQUATE_SECURITY: Self = Self(0xc);
    const HTTP_1_1_REQUIRED: Self = Self(0xd);
    const MAX_PENDING_SETTINGS_ACK: Self = Self(0xe);
}

// Non-exhaustive enum in Zig → newtype over u16
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
struct SettingsType(u16);
impl SettingsType {
    const SETTINGS_HEADER_TABLE_SIZE: Self = Self(0x1);
    const SETTINGS_ENABLE_PUSH: Self = Self(0x2);
    const SETTINGS_MAX_CONCURRENT_STREAMS: Self = Self(0x3);
    const SETTINGS_INITIAL_WINDOW_SIZE: Self = Self(0x4);
    const SETTINGS_MAX_FRAME_SIZE: Self = Self(0x5);
    const SETTINGS_MAX_HEADER_LIST_SIZE: Self = Self(0x6);
    // non standard extension settings here (we still dont support this ones)
    const SETTINGS_ENABLE_CONNECT_PROTOCOL: Self = Self(0x8);
    const SETTINGS_NO_RFC7540_PRIORITIES: Self = Self(0x9);
}

#[inline]
fn u32_from_bytes(src: &[u8]) -> u32 {
    debug_assert!(src.len() == 4);
    u32::from_be_bytes(src[0..4].try_into().expect("infallible: size matches"))
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
    fn from(value: u32) -> Self {
        Self(value)
    }
    #[inline]
    fn init(value: u32, reserved: bool) -> Self {
        Self((value & 0x7fff_ffff) | if reserved { 0x8000_0000 } else { 0 })
    }
    /// PORT NOTE (intentional divergence): Zig's `toUInt32()` is `@bitCast` of
    /// `packed struct(u32){ reserved: bool, uint31: u31 }`, which on little-endian places
    /// `reserved` in bit 0 and yields `(uint31 << 1) | reserved`. That is a latent RFC 7540
    /// §6.3 bug in Zig's deprecated PRIORITY path — the wire format wants the reserved/E
    /// bit at bit 31. We keep the RFC-compliant `(reserved << 31) | uint31` layout here, which
    /// already matches `from_bytes`/`write` and the on-wire `StreamPriority.stream_identifier`.
    #[inline]
    fn to_uint32(self) -> u32 {
        self.0
    }
    #[inline]
    fn from_bytes(src: &[u8]) -> Self {
        Self(u32_from_bytes(src))
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
    pub const BYTE_SIZE: usize = 5;
    #[inline]
    fn write(&self, writer: &mut impl WireWriter) -> bool {
        let mut swap = *self;
        swap.stream_identifier = swap.stream_identifier.swap_bytes();
        writer.write_all(bytemuck::bytes_of(&swap)).is_ok()
    }
    #[inline]
    fn from(dst: &mut StreamPriority, src: &[u8]) {
        // SAFETY: src.len() == BYTE_SIZE asserted by caller
        unsafe {
            core::ptr::copy_nonoverlapping(
                src.as_ptr(),
                std::ptr::from_mut(dst).cast::<u8>(),
                Self::BYTE_SIZE,
            );
        }
        dst.stream_identifier = dst.stream_identifier.swap_bytes();
    }
}

// packed struct(u72): length: u24, type: u8, flags: u8, streamIdentifier: u32
// TODO(port): u24 — represented as u32 here; wire encoding handled in write()/from()
#[derive(Clone, Copy)]
pub struct FrameHeader {
    length: u32, // u24 on the wire
    type_: u8,
    flags: u8,
    stream_identifier: u32,
}
impl Default for FrameHeader {
    fn default() -> Self {
        Self {
            length: 0,
            type_: FrameType::HTTP_FRAME_SETTINGS as u8,
            flags: 0,
            stream_identifier: 0,
        }
    }
}
impl FrameHeader {
    pub const BYTE_SIZE: usize = 9;
    #[inline]
    fn write(&self, writer: &mut impl WireWriter) -> bool {
        // TODO(port): byteSwapAllFields on packed struct(u72) — emit big-endian wire format manually
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
    /// Zig accumulates raw wire bytes directly into the packed `struct(u72)`
    /// across two `from()` calls and byte-swaps at the end. `FrameHeader` here
    /// is not `#[repr(packed)]` (its `length` is a widened `u32`), so the
    /// caller assembles the 9 raw bytes on the stack and hands us the finished
    /// buffer instead — no per-instance or thread-local scratch needed.
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

// packed struct(u48): type: u16, value: u32
#[repr(C, packed)]
#[derive(Clone, Copy, Default)]
pub struct SettingsPayloadUnit {
    type_: u16,
    value: u32,
}
impl SettingsPayloadUnit {
    pub const BYTE_SIZE: usize = 6;
    #[inline]
    fn from<const END: bool>(dst: &mut SettingsPayloadUnit, src: &[u8], offset: usize) {
        // SAFETY: caller guarantees src.len() + offset <= BYTE_SIZE
        unsafe {
            core::ptr::copy_nonoverlapping(
                src.as_ptr(),
                std::ptr::from_mut(dst).cast::<u8>().add(offset),
                src.len(),
            );
        }
        if END {
            dst.type_ = u16::swap_bytes(dst.type_);
            dst.value = u32::swap_bytes(dst.value);
        }
    }
}

// packed struct(u336) — 7 × (u16 type + u32 value) = 42 bytes
// TODO(port): #[repr(C, packed)] for wire layout; verify byteSwapAllFields equivalence in Phase B
#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct FullSettingsPayload {
    _header_table_size_type: u16,
    header_table_size: u32,
    _enable_push_type: u16,
    enable_push: u32,
    _max_concurrent_streams_type: u16,
    max_concurrent_streams: u32,
    _initial_window_size_type: u16,
    initial_window_size: u32,
    _max_frame_size_type: u16,
    max_frame_size: u32,
    _max_header_list_size_type: u16,
    max_header_list_size: u32,
    _enable_connect_protocol_type: u16,
    enable_connect_protocol: u32,
}
// SAFETY: `#[repr(C, packed)]` with only `u16`/`u32` fields — no padding, no
// niches, every 42-byte pattern is a valid value.
unsafe impl bytemuck::Zeroable for FullSettingsPayload {}
// SAFETY: see `Zeroable` impl above; additionally `Copy + 'static`.
unsafe impl bytemuck::Pod for FullSettingsPayload {}
const _: () =
    assert!(core::mem::size_of::<FullSettingsPayload>() == FullSettingsPayload::BYTE_SIZE);
impl Default for FullSettingsPayload {
    fn default() -> Self {
        Self {
            _header_table_size_type: SettingsType::SETTINGS_HEADER_TABLE_SIZE.0,
            header_table_size: 4096,
            _enable_push_type: SettingsType::SETTINGS_ENABLE_PUSH.0,
            enable_push: 1,
            _max_concurrent_streams_type: SettingsType::SETTINGS_MAX_CONCURRENT_STREAMS.0,
            max_concurrent_streams: 4294967295,
            _initial_window_size_type: SettingsType::SETTINGS_INITIAL_WINDOW_SIZE.0,
            initial_window_size: 65535,
            _max_frame_size_type: SettingsType::SETTINGS_MAX_FRAME_SIZE.0,
            max_frame_size: 16384,
            _max_header_list_size_type: SettingsType::SETTINGS_MAX_HEADER_LIST_SIZE.0,
            max_header_list_size: 65535,
            _enable_connect_protocol_type: SettingsType::SETTINGS_ENABLE_CONNECT_PROTOCOL.0,
            enable_connect_protocol: 0,
        }
    }
}
impl FullSettingsPayload {
    pub const BYTE_SIZE: usize = 42;

    pub fn to_js(&self, global_object: &JSGlobalObject) -> JSValue {
        let result = JSValue::create_empty_object(global_object, 8);
        // Packed-field reads are by-value (Copy) → no unaligned-ref hazard.
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

    pub fn update_with(&mut self, option: SettingsPayloadUnit) {
        match SettingsType(option.type_) {
            SettingsType::SETTINGS_HEADER_TABLE_SIZE => self.header_table_size = option.value,
            SettingsType::SETTINGS_ENABLE_PUSH => self.enable_push = option.value,
            SettingsType::SETTINGS_MAX_CONCURRENT_STREAMS => {
                self.max_concurrent_streams = option.value
            }
            SettingsType::SETTINGS_INITIAL_WINDOW_SIZE => self.initial_window_size = option.value,
            SettingsType::SETTINGS_MAX_FRAME_SIZE => self.max_frame_size = option.value,
            SettingsType::SETTINGS_MAX_HEADER_LIST_SIZE => self.max_header_list_size = option.value,
            SettingsType::SETTINGS_ENABLE_CONNECT_PROTOCOL => {
                self.enable_connect_protocol = option.value
            }
            _ => {}
        }
    }

    pub fn write(&self, writer: &mut impl WireWriter) -> bool {
        let mut swap = *self;
        // TODO(port): byteSwapAllFields — swap each field manually
        swap._header_table_size_type = swap._header_table_size_type.swap_bytes();
        swap.header_table_size = swap.header_table_size.swap_bytes();
        swap._enable_push_type = swap._enable_push_type.swap_bytes();
        swap.enable_push = swap.enable_push.swap_bytes();
        swap._max_concurrent_streams_type = swap._max_concurrent_streams_type.swap_bytes();
        swap.max_concurrent_streams = swap.max_concurrent_streams.swap_bytes();
        swap._initial_window_size_type = swap._initial_window_size_type.swap_bytes();
        swap.initial_window_size = swap.initial_window_size.swap_bytes();
        swap._max_frame_size_type = swap._max_frame_size_type.swap_bytes();
        swap.max_frame_size = swap.max_frame_size.swap_bytes();
        swap._max_header_list_size_type = swap._max_header_list_size_type.swap_bytes();
        swap.max_header_list_size = swap.max_header_list_size.swap_bytes();
        swap._enable_connect_protocol_type = swap._enable_connect_protocol_type.swap_bytes();
        swap.enable_connect_protocol = swap.enable_connect_protocol.swap_bytes();
        writer.write_all(bytemuck::bytes_of(&swap)).is_ok()
    }
}

/// Writer trait used for `(comptime Writer: type, writer: Writer)` params.
/// All call sites use either a `FixedBufferStream` cursor or `DirectWriterStruct`.
use bun_io::Write as WireWriter;

// ──────────────────────────────────────────────────────────────────────────
// Static header maps
// ──────────────────────────────────────────────────────────────────────────

// PERF(port): was phf::Map<&[u8], ()> used only via .contains_key() on a 1-entry
// set. A single slice compare is strictly cheaper than a SipHash + compare.
#[inline]
fn is_valid_response_pseudo_header(name: &[u8]) -> bool {
    name == b":status"
}

// PERF(port): was phf::Map<&[u8], ()> used only via .contains_key() on a 5-entry
// set. phf hashes the full key (SipHash) before compare; with 5 keys whose
// lengths are {5,7,7,9,10} a length-gated match rejects most misses on a single
// usize compare and hits in ≤2 slice compares — cheaper than the hash.
#[inline]
fn is_valid_request_pseudo_header(name: &[u8]) -> bool {
    match name.len() {
        5 => name == b":path",
        7 => name == b":method" || name == b":scheme",
        9 => name == b":protocol",
        10 => name == b":authority",
        _ => false,
    }
}

const SINGLE_VALUE_HEADERS_LEN: usize = 40;

/// Returns a stable index in `0..SINGLE_VALUE_HEADERS_LEN` for headers that
/// must carry only a single value, or `None` otherwise. The index is used
/// solely to address a per-request `[bool; SINGLE_VALUE_HEADERS_LEN]` bitset
/// for duplicate detection — the concrete numeric value has no other meaning.
///
/// PERF(port): Zig used `ComptimeStringMap.indexOf`, which compiles to a
/// length-gated switch. The Phase-A draft used a `phf::Map` but, because phf
/// does not expose stable indices, had to fall back to a *linear*
/// `.entries().position()` scan — 40 slice compares per header per HTTP/2
/// request. The hand-rolled match below restores the Zig dispatch shape: one
/// `usize` length compare rejects every miss whose length has no entries, and
/// the largest same-length bucket is 5 entries (len 7), so a hit costs at
/// most 5 short slice compares and a miss typically costs 0–2.
fn single_value_headers_index_of(name: &[u8]) -> Option<usize> {
    match name.len() {
        2 => match name {
            b"tk" => Some(36),
            _ => None,
        },
        3 => match name {
            b"age" => Some(9),
            b"dnt" => Some(19),
            _ => None,
        },
        4 => match name {
            b"date" => Some(18),
            b"etag" => Some(20),
            b"from" => Some(22),
            b"host" => Some(23),
            _ => None,
        },
        5 => match name {
            b":path" => Some(4),
            b"range" => Some(33),
            _ => None,
        },
        7 => match name {
            b":status" => Some(0),
            b":method" => Some(1),
            b":scheme" => Some(3),
            b"expires" => Some(21),
            b"referer" => Some(34),
            _ => None,
        },
        8 => match name {
            b"if-match" => Some(24),
            b"if-range" => Some(27),
            b"location" => Some(30),
            _ => None,
        },
        9 => match name {
            b":protocol" => Some(5),
            _ => None,
        },
        10 => match name {
            b":authority" => Some(2),
            b"user-agent" => Some(38),
            _ => None,
        },
        11 => match name {
            b"content-md5" => Some(15),
            b"retry-after" => Some(35),
            _ => None,
        },
        12 => match name {
            b"content-type" => Some(17),
            b"max-forwards" => Some(31),
            _ => None,
        },
        13 => match name {
            b"authorization" => Some(10),
            b"content-range" => Some(16),
            b"if-none-match" => Some(26),
            b"last-modified" => Some(29),
            _ => None,
        },
        14 => match name {
            b"content-length" => Some(13),
            _ => None,
        },
        16 => match name {
            b"content-encoding" => Some(11),
            b"content-language" => Some(12),
            b"content-location" => Some(14),
            _ => None,
        },
        17 => match name {
            b"if-modified-since" => Some(25),
            _ => None,
        },
        19 => match name {
            b"if-unmodified-since" => Some(28),
            b"proxy-authorization" => Some(32),
            _ => None,
        },
        22 => match name {
            b"access-control-max-age" => Some(7),
            b"x-content-type-options" => Some(39),
            _ => None,
        },
        25 => match name {
            b"upgrade-insecure-requests" => Some(37),
            _ => None,
        },
        29 => match name {
            b"access-control-request-method" => Some(8),
            _ => None,
        },
        32 => match name {
            b"access-control-allow-credentials" => Some(6),
            _ => None,
        },
        _ => None,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Standalone host functions
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn]
pub fn js_get_unpacked_settings(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let mut settings = FullSettingsPayload::default();

    let args_list = callframe.arguments_old::<1>();
    if args_list.len < 1 {
        return Ok(settings.to_js(global_object));
    }

    let data_arg = args_list.ptr[0];

    if let Some(array_buffer) = data_arg.as_array_buffer(global_object) {
        let payload = array_buffer.byte_slice();
        let setting_byte_size = SettingsPayloadUnit::BYTE_SIZE;
        if payload.len() < setting_byte_size || payload.len() % setting_byte_size != 0 {
            return Err(global_object.throw(format_args!(
                "Expected buf to be a Buffer of at least 6 bytes and a multiple of 6 bytes"
            )));
        }

        let mut i: usize = 0;
        while i < payload.len() {
            let mut unit = SettingsPayloadUnit::default();
            SettingsPayloadUnit::from::<true>(&mut unit, &payload[i..i + setting_byte_size], 0);
            settings.update_with(unit);
            i += setting_byte_size;
        }
        Ok(settings.to_js(global_object))
    } else if !data_arg.is_empty_or_undefined_or_null() {
        Err(global_object.throw(format_args!("Expected buf to be a Buffer")))
    } else {
        Ok(settings.to_js(global_object))
    }
}

#[bun_jsc::host_fn]
pub fn js_assert_settings(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args_list = callframe.arguments_old::<1>();
    if args_list.len < 1 {
        return Err(global_object.throw(format_args!("Expected settings to be a object")));
    }

    if args_list.len > 0 && !args_list.ptr[0].is_empty_or_undefined_or_null() {
        let options = args_list.ptr[0];
        if !options.is_object() {
            return Err(global_object.throw(format_args!("Expected settings to be a object")));
        }

        if let Some(header_table_size) = options.get(global_object, "headerTableSize")? {
            if header_table_size.is_number() {
                let value = header_table_size.as_number();
                if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                    return global_object
                        .err_http2_invalid_setting_value_range_error(
                            "Expected headerTableSize to be a number between 0 and 2^32-1",
                        )
                        .throw();
                }
            } else if !header_table_size.is_empty_or_undefined_or_null() {
                return global_object
                    .err_http2_invalid_setting_value_range_error(
                        "Expected headerTableSize to be a number",
                    )
                    .throw();
            }
        }

        if let Some(enable_push) = options.get(global_object, "enablePush")? {
            if !enable_push.is_boolean() && !enable_push.is_undefined() {
                return global_object
                    .err_http2_invalid_setting_value("Expected enablePush to be a boolean")
                    .throw();
            }
        }

        if let Some(initial_window_size) = options.get(global_object, "initialWindowSize")? {
            if initial_window_size.is_number() {
                let value = initial_window_size.as_number();
                if value < 0.0 || value > MAX_WINDOW_SIZE_F64 {
                    return global_object
                        .err_http2_invalid_setting_value_range_error(
                            "Expected initialWindowSize to be a number between 0 and 2^32-1",
                        )
                        .throw();
                }
            } else if !initial_window_size.is_empty_or_undefined_or_null() {
                return global_object
                    .err_http2_invalid_setting_value_range_error(
                        "Expected initialWindowSize to be a number",
                    )
                    .throw();
            }
        }

        if let Some(max_frame_size) = options.get(global_object, "maxFrameSize")? {
            if max_frame_size.is_number() {
                let value = max_frame_size.as_number();
                if value < 16384.0 || value > MAX_FRAME_SIZE_F64 {
                    return global_object
                        .err_http2_invalid_setting_value_range_error(
                            "Expected maxFrameSize to be a number between 16,384 and 2^24-1",
                        )
                        .throw();
                }
            } else if !max_frame_size.is_empty_or_undefined_or_null() {
                return global_object
                    .err_http2_invalid_setting_value_range_error(
                        "Expected maxFrameSize to be a number",
                    )
                    .throw();
            }
        }

        if let Some(max_concurrent_streams) = options.get(global_object, "maxConcurrentStreams")? {
            if max_concurrent_streams.is_number() {
                let value = max_concurrent_streams.as_number();
                if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                    return global_object
                        .err_http2_invalid_setting_value_range_error(
                            "Expected maxConcurrentStreams to be a number between 0 and 2^32-1",
                        )
                        .throw();
                }
            } else if !max_concurrent_streams.is_empty_or_undefined_or_null() {
                return global_object
                    .err_http2_invalid_setting_value_range_error(
                        "Expected maxConcurrentStreams to be a number",
                    )
                    .throw();
            }
        }

        if let Some(max_header_list_size) = options.get(global_object, "maxHeaderListSize")? {
            if max_header_list_size.is_number() {
                let value = max_header_list_size.as_number();
                if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                    return global_object
                        .err_http2_invalid_setting_value_range_error(
                            "Expected maxHeaderListSize to be a number between 0 and 2^32-1",
                        )
                        .throw();
                }
            } else if !max_header_list_size.is_empty_or_undefined_or_null() {
                return global_object
                    .err_http2_invalid_setting_value_range_error(
                        "Expected maxHeaderListSize to be a number",
                    )
                    .throw();
            }
        }

        if let Some(max_header_size) = options.get(global_object, "maxHeaderSize")? {
            if max_header_size.is_number() {
                let value = max_header_size.as_number();
                if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                    return global_object
                        .err_http2_invalid_setting_value_range_error(
                            "Expected maxHeaderSize to be a number between 0 and 2^32-1",
                        )
                        .throw();
                }
            } else if !max_header_size.is_empty_or_undefined_or_null() {
                return global_object
                    .err_http2_invalid_setting_value_range_error(
                        "Expected maxHeaderSize to be a number",
                    )
                    .throw();
            }
        }
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
pub fn js_get_packed_settings(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let mut settings = FullSettingsPayload::default();
    let args_list = callframe.arguments_old::<1>();

    if args_list.len > 0 && !args_list.ptr[0].is_empty_or_undefined_or_null() {
        let options = args_list.ptr[0];

        if !options.is_object() {
            return Err(global_object.throw(format_args!("Expected settings to be a object")));
        }

        if let Some(header_table_size) = options.get(global_object, "headerTableSize")? {
            if header_table_size.is_number() {
                let v = header_table_size.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return Err(global_object.throw(format_args!(
                        "Expected headerTableSize to be a number between 0 and 2^32-1"
                    )));
                }
                settings.header_table_size = u32::try_from(v).expect("int cast");
            } else if !header_table_size.is_empty_or_undefined_or_null() {
                return Err(
                    global_object.throw(format_args!("Expected headerTableSize to be a number"))
                );
            }
        }

        if let Some(enable_push) = options.get(global_object, "enablePush")? {
            if enable_push.is_boolean() {
                settings.enable_push = if enable_push.as_boolean() { 1 } else { 0 };
            } else if !enable_push.is_empty_or_undefined_or_null() {
                return Err(
                    global_object.throw(format_args!("Expected enablePush to be a boolean"))
                );
            }
        }

        if let Some(initial_window_size) = options.get(global_object, "initialWindowSize")? {
            if initial_window_size.is_number() {
                let v = initial_window_size.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return Err(global_object.throw(format_args!(
                        "Expected initialWindowSize to be a number between 0 and 2^32-1"
                    )));
                }
                settings.initial_window_size = u32::try_from(v).expect("int cast");
            } else if !initial_window_size.is_empty_or_undefined_or_null() {
                return Err(
                    global_object.throw(format_args!("Expected initialWindowSize to be a number"))
                );
            }
        }

        if let Some(max_frame_size) = options.get(global_object, "maxFrameSize")? {
            if max_frame_size.is_number() {
                let v = max_frame_size.to_int32();
                if v as u32 > MAX_FRAME_SIZE || v < 16384 {
                    return Err(global_object.throw(format_args!(
                        "Expected maxFrameSize to be a number between 16,384 and 2^24-1"
                    )));
                }
                settings.max_frame_size = u32::try_from(v).expect("int cast");
            } else if !max_frame_size.is_empty_or_undefined_or_null() {
                return Err(
                    global_object.throw(format_args!("Expected maxFrameSize to be a number"))
                );
            }
        }

        if let Some(max_concurrent_streams) = options.get(global_object, "maxConcurrentStreams")? {
            if max_concurrent_streams.is_number() {
                let v = max_concurrent_streams.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return Err(global_object.throw(format_args!(
                        "Expected maxConcurrentStreams to be a number between 0 and 2^32-1"
                    )));
                }
                settings.max_concurrent_streams = u32::try_from(v).expect("int cast");
            } else if !max_concurrent_streams.is_empty_or_undefined_or_null() {
                return Err(global_object
                    .throw(format_args!("Expected maxConcurrentStreams to be a number")));
            }
        }

        if let Some(max_header_list_size) = options.get(global_object, "maxHeaderListSize")? {
            if max_header_list_size.is_number() {
                let v = max_header_list_size.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return Err(global_object.throw(format_args!(
                        "Expected maxHeaderListSize to be a number between 0 and 2^32-1"
                    )));
                }
                settings.max_header_list_size = u32::try_from(v).expect("int cast");
            } else if !max_header_list_size.is_empty_or_undefined_or_null() {
                return Err(
                    global_object.throw(format_args!("Expected maxHeaderListSize to be a number"))
                );
            }
        }

        if let Some(max_header_size) = options.get(global_object, "maxHeaderSize")? {
            if max_header_size.is_number() {
                let v = max_header_size.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return Err(global_object.throw(format_args!(
                        "Expected maxHeaderSize to be a number between 0 and 2^32-1"
                    )));
                }
                settings.max_header_list_size = u32::try_from(v).expect("int cast");
            } else if !max_header_size.is_empty_or_undefined_or_null() {
                return Err(
                    global_object.throw(format_args!("Expected maxHeaderSize to be a number"))
                );
            }
        }
    }

    // TODO(port): byteSwapAllFields — done inside .write(); here we need raw swapped bytes
    let mut buf = [0u8; FullSettingsPayload::BYTE_SIZE];
    let mut cursor = FixedBufferStream::new(&mut buf);
    let _ = settings.write(&mut cursor);
    let binary_type = BinaryType::Buffer;
    binary_type.to_js(&buf, global_object)
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

    pub fn call_event_handler(
        &self,
        event: JSH2FrameParser::Gc,
        this_value: JSValue,
        context: JSValue,
        data: &[JSValue],
    ) -> bool {
        let Some(callback) = event.get(this_value) else {
            return false;
        };
        self.vm
            .event_loop_ref()
            .run_callback(callback, &self.global(), context, data);
        true
    }

    pub fn call_write_callback(&self, callback: JSValue, data: &[JSValue]) -> bool {
        if !callback.is_callable() {
            return false;
        }
        self.vm
            .event_loop_ref()
            .run_callback(callback, &self.global(), JSValue::UNDEFINED, data);
        true
    }

    pub fn call_event_handler_with_result(
        &self,
        event: JSH2FrameParser::Gc,
        this_value: JSValue,
        data: &[JSValue],
    ) -> JSValue {
        let Some(callback) = event.get(this_value) else {
            return JSValue::ZERO;
        };
        self.vm.event_loop_ref().run_callback_with_result(
            callback,
            &self.global(),
            this_value,
            data,
        )
    }

    pub fn from_js(
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
            // TODO(port): Zig compares to .zero; codegen may return None — check both
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

pub use JSH2FrameParser::get_constructor as H2FrameParserConstructor;
/// snake_case alias for the codegen'd `$zig(h2_frame_parser.zig, H2FrameParserConstructor)`
/// thunk in `generated_js2native.rs` (the generator snake-cases the Zig export name).
pub use JSH2FrameParser::get_constructor as h2_frame_parser_constructor;

use bun_io::FixedBufferStream;

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser
// ──────────────────────────────────────────────────────────────────────────

const ENABLE_AUTO_CORK: bool = false; // ENABLE CORK OPTIMIZATION
const ENABLE_ALLOCATOR_POOL: bool = true; // ENABLE HIVE ALLOCATOR OPTIMIZATION
const MAX_BUFFER_SIZE: u32 = 32768;

/// `bun.HiveArray(H2FrameParser, 256).Fallback` — per-thread slab of 256
/// parser slots with heap fallback. Lazily boxed on first use (the inline
/// array is ~tens of KB and would otherwise sit in every thread's TLS).
type H2FrameParserHiveAllocator = HiveArrayFallback<H2FrameParser, 256>;

thread_local! {
    // Boxed so only a pointer lives in static TLS — these two buffers are 32 KB
    // combined and would otherwise dominate PT_TLS MemSiz on every thread
    // (see test/js/bun/binary/tls-segment-size). Lazily allocated on first
    // HTTP/2 access; threads that never touch h2 pay nothing.
    static CORK_BUFFER: RefCell<Box<[u8; 16386]>> = RefCell::new(Box::new([0u8; 16386]));
    static CORK_OFFSET: Cell<u16> = const { Cell::new(0) };
    static CORKED_H2: Cell<Option<*mut H2FrameParser>> = const { Cell::new(None) };
    static POOL: RefCell<Option<Box<H2FrameParserHiveAllocator>>> = const { RefCell::new(None) };
    static SHARED_REQUEST_BUFFER: RefCell<Box<[u8; 16384]>> = RefCell::new(Box::new([0u8; 16384]));
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut H2FrameParser` until Phase 1 lands —
// `&mut T` auto-derefs to `&T` so the impls below compile against either.
#[bun_jsc::JsClass]
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::deinit_raw)]
pub struct H2FrameParser {
    strong_this: JsCell<JsRef>,
    global_this: GlobalRef, // JSC_BORROW — read-only after construction
    // allocator field dropped — global mimalloc
    handlers: JsCell<Handlers>,
    native_socket: Cell<BunSocket>,
    local_settings: Cell<FullSettingsPayload>,
    // only available after receiving settings or ACK
    remote_settings: Cell<Option<FullSettingsPayload>>,
    // current frame being read
    current_frame: Cell<Option<FrameHeader>>,
    // remaining bytes to read for the current frame
    remaining_length: Cell<i32>,
    // buffer if more data is needed for the current frame
    read_buffer: JsCell<MutableString>,

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
    max_rejected_streams: Cell<u32>,
    max_outstanding_settings: Cell<u32>,
    outstanding_settings: Cell<u32>,
    rejected_streams: Cell<u32>,
    max_session_memory: Cell<u32>, // this limit is in MB
    queued_data_size: Cell<u64>,   // this is in bytes
    max_outstanding_pings: Cell<u64>,
    out_standing_pings: Cell<u64>,
    max_send_header_block_length: Cell<u32>,
    last_stream_id: Cell<u32>,
    is_server: Cell<bool>,
    preface_received_len: Cell<u8>,
    // we buffer requests until we get the first settings ACK
    write_buffer: JsCell<Vec<u8>>,
    write_buffer_offset: Cell<usize>,
    // TODO: this will be removed when I re-add header and data priorization
    outbound_queue_size: Cell<usize>,

    streams: JsCell<BunHashMap<u32, *mut Stream>>,

    hpack: JsCell<Option<lshpack::HpackHandle>>,

    has_nonnative_backpressure: Cell<bool>,
    ref_count: bun_ptr::RefCount<Self>, // intrusive — bun.ptr.RefCount(@This(), "ref_count", deinit, .{})

    auto_flusher: JsCell<AutoFlusher>,
    padding_strategy: Cell<PaddingStrategy>,
}

impl H2FrameParser {
    /// `RefCounted` destructor thunk: `deinit` takes `&self`, not `*mut Self`.
    ///
    /// Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
    /// whose generated trait `destroy` upholds the sole-owner contract
    /// (refcount hit zero; `this` is the sole owner of the `heap::alloc`
    /// allocation). `deinit` frees `this` via `heap::take`.
    #[inline]
    fn deinit_raw(this: *mut Self) {
        // SAFETY: refcount hit zero; sole owner.
        unsafe { (*this).deinit() };
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
        (self as *const Self).cast_mut()
    }

    pub fn ref_(&self) {
        // SAFETY: `self` is live; `RefCount::ref_` only reads/writes the
        // embedded `ref_count` Cell (interior-mutable), so `&self`→`*mut`
        // is sound for that single field access.
        unsafe { bun_ptr::RefCount::<Self>::ref_(self.as_ctx_ptr()) };
    }
    // R-2: `&self` — `RefCount` is `Cell`-backed and every other field is
    // `Cell`/`JsCell`, so `destructor()` (→ `deinit()`) writes only through
    // `UnsafeCell`-derived pointers; the `*mut` cast is signature-only.
    pub fn deref(&self) {
        // SAFETY: `self` is live; `deref` decrements the intrusive count and,
        // on zero, calls `destructor(this)` which frees via `heap::take`.
        // The caller must not touch `self` after this returns when count was 1.
        unsafe { bun_ptr::RefCount::<Self>::deref(self.as_ctx_ptr()) };
    }
}

/// The streams hashmap may mutate when growing we use this when we need to make sure its safe to iterate over it
///
/// Zig walks the raw bucket array by index so a rehash mid-loop can't
/// invalidate the iterator. `bun_collections::HashMap` is backed by
/// `std::collections::HashMap`, which exposes no bucket index and randomises
/// iteration order on every mutation, so the bucket trick can't be ported
/// faithfully. Instead we snapshot the stream IDs at `init` and re-look-up
/// each one on demand: streams removed mid-loop are skipped, streams added
/// mid-loop are not visited, and nothing is yielded twice. That's the
/// guarantee the call sites actually rely on (flush / emit-to-all / detach).
pub struct StreamResumableIterator {
    // PORT NOTE: Zig's `parser: *H2FrameParser` freely aliases. R-2: `streams`
    // is now `JsCell`-backed, so a shared backref suffices and the in-loop
    // body can keep its own `&H2FrameParser` without provenance gymnastics.
    // `ParentRef` encapsulates the back-pointer invariant (parser outlives the
    // iterator — every call site constructs the iterator from a live `&Self`
    // and drains it in the same scope) so `next()` derefs through safe `Deref`.
    parser: bun_ptr::ParentRef<H2FrameParser>,
    ids: Vec<u32>,
    index: usize,
}
impl StreamResumableIterator {
    pub fn init(parser: &H2FrameParser) -> Self {
        let ids = parser.streams.get().keys().copied().collect();
        Self {
            parser: bun_ptr::ParentRef::new(parser),
            ids,
            index: 0,
        }
    }
    pub fn next(&mut self) -> Option<*mut Stream> {
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
    RESERVED_LOCAL = 3,
    RESERVED_REMOTE = 4,
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
    close_after_drain: bool,
    end_after_headers: bool,
    is_waiting_more_headers: bool,
    padding: Option<u8>,
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

    // when we have backpressure we queue the data e round robin the Streams
    data_frame_queue: PendingQueue,
}

pub struct SignalRef {
    // LIFETIMES.tsv: SHARED — AbortSignal is intrusively refcounted across FFI/codegen.
    // `AbortSignal` is an opaque C++ type whose ref/unref go through
    // `WebCore__AbortSignal__ref/unref`; it does not (and cannot) implement
    // `bun_ptr::RefCounted`, so balance refs by hand in `attach_signal` / `Drop`
    // (mirrors Zig `*AbortSignal`). `BackRef` captures the backref invariant
    // (signal is `ref_()`'d in `attach_signal` and outlives this struct until
    // `Drop` calls `detach()`/`unref()`), so reads go through safe `Deref`.
    // TODO(port): wrap in a dedicated smart-pointer once AbortSignal grows one.
    signal: bun_ptr::BackRef<AbortSignal>,
    // LIFETIMES.tsv: SHARED — H2FrameParser carries an intrusive RefCount and is
    // recovered via `from_field_ptr!` from the auto-flusher. It uses a hand-rolled
    // `Cell<u32>` ref count (not `bun_ptr::RefCount<Self>`), so `IntrusiveRc`'s
    // `RefCounted` bound is unsatisfiable. `ParentRef` captures the backref
    // invariant (parser is `ref_()`'d in `attach_signal` and outlives the
    // `SignalRef` until `Drop` calls `deref()`), so reads go through safe
    // `Deref`; the explicit `ref_()/deref()` balancing stays (mirrors Zig
    // `*H2FrameParser`).
    parser: bun_ptr::ParentRef<H2FrameParser>,
    stream_id: u32,
}

impl SignalRef {
    pub fn is_aborted(&self) -> bool {
        // BackRef invariant: signal kept alive via .ref_() in attach_signal.
        self.signal.aborted()
    }

    pub fn abort_listener(this: *mut SignalRef, reason: JSValue) {
        bun_output::scoped_log!(H2FrameParser, "abortListener");
        reason.ensure_still_alive();
        // SAFETY: this is a stable heap allocation owned by Stream.signal
        let this = unsafe { &mut *this };
        // ParentRef backref — ref()'d in `attach_signal`, valid until detach/deinit.
        // R-2: shared deref — `abort_stream` takes `&self`.
        let parser = this.parser.get();
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
        // BackRef invariant: `signal` is the C++-refcounted AbortSignal we
        // ref_()'d in `attach_signal`; valid until this `detach` releases our
        // listener and unrefs. Copy the `BackRef` out first so the `&mut self`
        // taken by `from_mut` doesn't overlap the receiver borrow.
        let signal = self.signal;
        signal.detach(std::ptr::from_mut(self).cast::<c_void>());
        // ParentRef backref — parser outlives every SignalRef (ref()'d in
        // `attach_signal`); release that ref now via the inherent `deref()`.
        H2FrameParser::deref(self.parser.get());
        // bun.destroy(this) handled by Box drop
    }
}

#[derive(Default)]
struct PendingQueue {
    data: Vec<PendingFrame>,
    front: usize,
    len: usize,
}

impl PendingQueue {
    pub fn enqueue(&mut self, value: PendingFrame) {
        self.data.push(value);
        self.len += 1;
        bun_output::scoped_log!(H2FrameParser, "PendingQueue.enqueue {}", self.len);
    }

    pub fn peek(&mut self) -> Option<&mut PendingFrame> {
        if self.len == 0 {
            return None;
        }
        Some(&mut self.data[0])
    }

    pub fn peek_last(&mut self) -> Option<&mut PendingFrame> {
        if self.len == 0 {
            return None;
        }
        let last = self.data.len() - 1;
        Some(&mut self.data[last])
    }

    pub fn slice(&mut self) -> &mut [PendingFrame] {
        if self.len == 0 {
            return &mut [];
        }
        &mut self.data[self.front..self.front + self.len]
    }

    pub fn peek_front(&mut self) -> Option<&mut PendingFrame> {
        if self.len == 0 {
            return None;
        }
        Some(&mut self.data[self.front])
    }

    pub fn dequeue(&mut self) -> Option<PendingFrame> {
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

    pub fn is_empty(&self) -> bool {
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
    pub fn slice(&self) -> &[u8] {
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
        let Some(frame) = self.data_frame_queue.peek_front() else {
            return FlushState::NoAction;
        };
        // PORT NOTE: reshaped for borrowck — `frame` aliases self.data_frame_queue;
        // capture pointers and rely on stable Vec backing within this scope.
        let frame: *mut PendingFrame = frame;
        // SAFETY: frame is a stable element of self.data_frame_queue's Vec backing store; not moved while this borrow lives (no push/pop until after use)
        let frame = unsafe { &mut *frame };

        let mut is_flow_control_limited = false;
        let no_backpressure: bool = 'brk: {
            let mut writer = client.to_writer();

            if frame.len == 0 {
                // flush a zero payload frame
                let mut data_header = FrameHeader {
                    type_: FrameType::HTTP_FRAME_DATA as u8,
                    flags: if frame.end_stream && !self.wait_for_trailers {
                        DataFrameFlags::END_STREAM as u8
                    } else {
                        0
                    },
                    stream_identifier: self.id,
                    length: 0,
                };
                break 'brk data_header.write(&mut writer);
            } else {
                // Inline `frame.slice()` so the borrow is on `frame.buffer`
                // alone — `frame.offset` / `frame.end_stream` stay disjoint
                // and can be mutated/read below while the slice is live.
                let frame_slice: &[u8] = &frame.buffer[frame.offset as usize..frame.len as usize];
                let max_size = frame_slice
                    .len()
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
                    is_flow_control_limited = true;
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "dataFrame flow control limited {} {} {} {} {} {}",
                        frame_slice.len(),
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
                if max_size < frame_slice.len() {
                    is_flow_control_limited = true;
                    // we need to break the frame into smaller chunks
                    frame.offset += u32::try_from(max_size).expect("int cast");
                    let able_to_send = &frame_slice[0..max_size];
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

                    let mut flags: u8 = 0; // we ignore end_stream for now because we know we have more data to send
                    if padding != 0 {
                        flags |= DataFrameFlags::PADDED as u8;
                    }
                    let mut data_header = FrameHeader {
                        type_: FrameType::HTTP_FRAME_DATA as u8,
                        flags,
                        stream_identifier: self.id,
                        length: u32::try_from(payload_size).expect("int cast"),
                    };
                    let _ = data_header.write(&mut writer);
                    if padding != 0 {
                        break 'brk SHARED_REQUEST_BUFFER.with_borrow_mut(|buffer| {
                            // SAFETY: src/dst may overlap — use ptr::copy (memmove)
                            unsafe {
                                core::ptr::copy(
                                    able_to_send.as_ptr(),
                                    buffer.as_mut_ptr().add(1),
                                    able_to_send.len(),
                                );
                            }
                            buffer[0] = padding;
                            writer.write_all(&buffer[0..payload_size]).is_ok()
                        });
                    } else {
                        break 'brk writer.write_all(able_to_send).is_ok();
                    }
                } else {
                    // flush with some payload
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
                    let mut flags: u8 = if frame.end_stream && !self.wait_for_trailers {
                        DataFrameFlags::END_STREAM as u8
                    } else {
                        0
                    };
                    if padding != 0 {
                        flags |= DataFrameFlags::PADDED as u8;
                    }
                    let mut data_header = FrameHeader {
                        type_: FrameType::HTTP_FRAME_DATA as u8,
                        flags,
                        stream_identifier: self.id,
                        length: u32::try_from(payload_size).expect("int cast"),
                    };
                    let _ = data_header.write(&mut writer);
                    if padding != 0 {
                        break 'brk SHARED_REQUEST_BUFFER.with_borrow_mut(|buffer| {
                            // SAFETY: src/dst may overlap — ptr::copy is memmove; dst capacity covers payload_size
                            unsafe {
                                core::ptr::copy(
                                    frame_slice.as_ptr(),
                                    buffer.as_mut_ptr().add(1),
                                    frame_slice.len(),
                                );
                            }
                            buffer[0] = padding;
                            writer.write_all(&buffer[0..payload_size]).is_ok()
                        });
                    } else {
                        break 'brk writer.write_all(frame_slice).is_ok();
                    }
                }
            }
        };

        // defer block from Zig (only when !is_flow_control_limited)
        if !is_flow_control_limited {
            // only call the callback + free the frame if we write to the socket the full frame
            let mut _frame = self.data_frame_queue.dequeue().unwrap();
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

        // PORT NOTE: `dispatch_write_callback()` below re-enters JS, which can
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
            // every access — see PORT NOTE above).
            macro_rules! lf {
                () => {
                    unsafe { &mut *last_frame }
                };
            }
            if bytes.is_empty() {
                // just merge the end_stream
                lf!().end_stream = end_stream;
                // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                // this is fine is like a per-stream CORKING in a frame level
                if let Some(old_callback) = lf!().callback.get() {
                    // Escape `this` so a self-derived address is observable
                    // across the opaque JS call (belt-and-suspenders; either
                    // launder alone defeats the caching).
                    core::hint::black_box(this);
                    client.dispatch_write_callback(old_callback);
                    core::hint::black_box(last_frame);
                    lf!().callback.deinit();
                }
                lf!().callback = StrongOptional::create(callback, &global_this);
                return;
            }
            if lf!().len == 0 {
                // we have an empty frame with means we can just use this frame with a new buffer
                lf!().buffer = vec![0u8; MAX_PAYLOAD_SIZE_WITHOUT_FRAME];
            }
            let max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME as u32;
            let remaining = max_size - lf!().len;
            if remaining > 0 {
                // ok we can cork frames
                let consumed_len = (remaining as usize).min(bytes.len());
                let merge = &bytes[0..consumed_len];
                let len = lf!().len as usize;
                lf!().buffer[len..len + consumed_len].copy_from_slice(merge);
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
                    if let Some(old_callback) = lf!().callback.get() {
                        core::hint::black_box(this);
                        client.dispatch_write_callback(old_callback);
                        core::hint::black_box(last_frame);
                        lf!().callback.deinit();
                    }
                    lf!().callback = StrongOptional::create(callback, &global_this);
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

        let mut frame = PendingFrame {
            end_stream,
            len: u32::try_from(bytes.len()).expect("int cast"),
            offset: 0,
            // we need to clone this data to send it later
            buffer: if bytes.is_empty() {
                Vec::new()
            } else {
                vec![0u8; MAX_PAYLOAD_SIZE_WITHOUT_FRAME]
            },
            callback: if callback.is_callable() {
                StrongOptional::create(callback, &global_this)
            } else {
                StrongOptional::empty()
            },
        };
        if !bytes.is_empty() {
            frame.buffer[0..bytes.len()].copy_from_slice(bytes);
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
            close_after_drain: false,
            end_after_headers: false,
            is_waiting_more_headers: false,
            padding: None,
            padding_strategy,
            rst_code: 0,
            stream_dependency: 0,
            exclusive: false,
            weight: 36,
            window_size: initial_window_size as u64,
            used_window_size: 0,
            remote_window_size: remote_window_size as u64,
            remote_used_window_size: 0,
            signal: None,
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
            StreamState::IDLE
                | StreamState::RESERVED_LOCAL
                | StreamState::RESERVED_REMOTE
                | StreamState::OPEN
                | StreamState::HALF_CLOSED_LOCAL
        )
    }

    pub fn can_send_data(&self) -> bool {
        matches!(
            self.state,
            StreamState::IDLE
                | StreamState::RESERVED_LOCAL
                | StreamState::RESERVED_REMOTE
                | StreamState::OPEN
                | StreamState::HALF_CLOSED_REMOTE
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
        // `ref_()` bumps the C++ intrusive refcount and returns the same live
        // `self` pointer with FFI (wildcard) provenance — store *that* in the
        // `BackRef` so its validity is tied to the refcount, not to the
        // borrowed `&mut AbortSignal` parameter's lifetime.
        let refed = core::ptr::NonNull::new(signal.ref_()).expect("AbortSignal::ref_");
        // we need a stable pointer to know what signal points to what stream_id + parser
        let mut signal_ref = Box::new(SignalRef {
            signal: bun_ptr::BackRef::from(refed),
            parser: bun_ptr::ParentRef::new(parser),
            stream_id: self.id,
        });
        // `signal_ref` is heap-allocated and outlives the listener registration
        // (cleared via `detach` in `Drop for SignalRef`).
        signal.listen(&raw mut *signal_ref);
        // TODO: We should not need this ref counting here, since Parser owns Stream
        parser.ref_();
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
        self.detach_context();
        self.clean_queue::<FINALIZING>(client);
        if let Some(signal) = self.signal.take() {
            drop(signal);
        }
        // unsafe to ask GC to run if we are already inside GC
        if !FINALIZING {
            VirtualMachine::get().event_loop_mut().process_gc_timer();
        }
    }
}

// Route AbortSignal callbacks through the Rust trait — the Zig spec passes a
// fn pointer; `bun_jsc::abort_signal::listen` instead expects `*mut C: AbortListener`.
impl AbortListener for SignalRef {
    fn on_abort(&mut self, reason: JSValue) {
        SignalRef::abort_listener(std::ptr::from_mut::<SignalRef>(self), reason);
    }
}

type HeaderValue = lshpack::DecodeResult;

// PORT NOTE: `lshpack::HpackError` does not yet impl `From` for `bun_core::Error`
// (see TODO in lshpack.rs). Map variants 1:1 to interned error names so Zig
// callers that match on `error.UnableToDecode` etc. keep their semantics.
fn hpack_error_to_core(e: lshpack::HpackError) -> bun_core::Error {
    match e {
        lshpack::HpackError::UnableToDecode => bun_core::err!("UnableToDecode"),
        lshpack::HpackError::EmptyHeaderName => bun_core::err!("EmptyHeaderName"),
        lshpack::HpackError::UnableToEncode => bun_core::err!("UnableToEncode"),
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
    ) -> Result<usize, bun_core::Error> {
        // TODO(port): narrow error set
        let old_len = encoded_headers.len();
        let required = old_len + name.len() + value.len() + HPACK_ENTRY_OVERHEAD;
        // PORT NOTE: Zig wrote into `allocatedSlice()` past `.len` then bumped `.len` on
        // success. In Rust, materializing `&mut [u8]` over uninitialized capacity is UB and
        // hpack.encode() needs `&mut [u8]` (not `&mut [MaybeUninit<u8>]`), so zero-extend to
        // `required` first. On both Ok and Err we truncate so `len` never exposes scratch
        // bytes — the `?` early-return / corrupted-len hazard from the original port is gone.
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

    pub fn decode(&self, src_buffer: &[u8]) -> Result<HeaderValue, bun_core::Error> {
        self.hpack.with_mut(|hpack| {
            if let Some(hpack) = hpack.as_mut() {
                return hpack.decode(src_buffer).map_err(hpack_error_to_core);
            }
            Err(bun_core::err!("UnableToDecode"))
        })
    }

    pub fn encode(
        &self,
        dst_buffer: &mut [u8],
        dst_offset: usize,
        name: &[u8],
        value: &[u8],
        never_index: bool,
    ) -> Result<usize, bun_core::Error> {
        self.hpack.with_mut(|hpack| {
            if let Some(hpack) = hpack.as_mut() {
                // lets make sure the name is lowercase
                return hpack
                    .encode(name, value, never_index, dst_buffer, dst_offset)
                    .map_err(hpack_error_to_core);
            }
            Err(bun_core::err!("UnableToEncode"))
        })
    }

    /// Calculate the new window size for the connection and the stream
    /// https://datatracker.ietf.org/doc/html/rfc7540#section-6.9.1
    fn adjust_window_size(&self, stream: Option<&mut Stream>, payload_size: u32) {
        self.used_window_size.set(
            self.used_window_size
                .get()
                .saturating_add(payload_size as u64),
        );
        bun_output::scoped_log!(
            H2FrameParser,
            "adjustWindowSize {} {} {} {}",
            self.used_window_size.get(),
            self.window_size.get(),
            self.is_server.get(),
            payload_size
        );
        if self.used_window_size.get() > self.window_size.get() {
            // we are receiving more data than we are allowed to
            self.send_go_away(
                0,
                ErrorCode::FLOW_CONTROL_ERROR,
                b"Window size overflow",
                self.last_stream_id.get(),
                true,
            );
            self.used_window_size
                .set(self.used_window_size.get() - payload_size as u64);
        }

        if let Some(s) = stream {
            s.used_window_size += payload_size as u64;
            if s.used_window_size > s.window_size {
                // we are receiving more data than we are allowed to
                self.send_go_away(
                    s.id,
                    ErrorCode::FLOW_CONTROL_ERROR,
                    b"Window size overflow",
                    self.last_stream_id.get(),
                    true,
                );
                s.used_window_size -= payload_size as u64;
            }
        }
    }

    fn increment_window_size_if_needed(&self) {
        // PORT NOTE: reshaped for borrowck — collect actions then apply
        let mut updates: Vec<(u32, u64)> = Vec::new();
        for (_, item) in self.streams.get().iter() {
            // SAFETY: item is &*mut Stream from streams.iter(); the boxed Stream outlives the iteration
            let stream = unsafe { &mut **item };
            bun_output::scoped_log!(
                H2FrameParser,
                "incrementWindowSizeIfNeeded stream {} {} {} {}",
                stream.id,
                stream.used_window_size,
                stream.window_size,
                self.is_server.get()
            );
            if stream.used_window_size >= stream.window_size / 2 && stream.used_window_size > 0 {
                let consumed = stream.used_window_size;
                stream.used_window_size = 0;
                bun_output::scoped_log!(
                    H2FrameParser,
                    "incrementWindowSizeIfNeeded stream {} {} {}",
                    stream.id,
                    stream.window_size,
                    self.is_server.get()
                );
                updates.push((stream.id, consumed));
            }
        }
        for (id, consumed) in updates {
            self.send_window_update(id, UInt31WithReserved::init(consumed as u32, false));
        }
        bun_output::scoped_log!(
            H2FrameParser,
            "incrementWindowSizeIfNeeded connection {} {} {}",
            self.used_window_size.get(),
            self.window_size.get(),
            self.is_server.get()
        );
        if self.used_window_size.get() >= self.window_size.get() / 2
            && self.used_window_size.get() > 0
        {
            let consumed = self.used_window_size.get();
            self.used_window_size.set(0);
            self.send_window_update(0, UInt31WithReserved::init(consumed as u32, false));
        }
    }

    pub fn set_settings(&self, settings: FullSettingsPayload) -> bool {
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

        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + FullSettingsPayload::BYTE_SIZE];
        let mut stream = FixedBufferStream::new(&mut buffer);
        let mut settings_header = FrameHeader {
            type_: FrameType::HTTP_FRAME_SETTINGS as u8,
            flags: 0,
            stream_identifier: 0,
            length: FullSettingsPayload::BYTE_SIZE as u32,
        };
        let _ = settings_header.write(&mut stream);

        self.outstanding_settings
            .set(self.outstanding_settings.get() + 1);

        self.local_settings.set(settings);
        let _ = self.local_settings.get().write(&mut stream);
        let _ = self.write(&buffer);
        true
    }

    pub fn abort_stream(&self, stream: &mut Stream, abort_reason: JSValue) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_RST_STREAM id: {} code: CANCEL",
            stream.id
        );

        abort_reason.ensure_still_alive();
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 4];
        let mut writer_stream = FixedBufferStream::new(&mut buffer);

        let mut frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_RST_STREAM as u8,
            flags: 0,
            stream_identifier: stream.id,
            length: 4,
        };
        let _ = frame.write(&mut writer_stream);
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

    pub fn end_stream(&self, stream: &mut Stream, rst_code: ErrorCode) {
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

        let mut frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_RST_STREAM as u8,
            flags: 0,
            stream_identifier: stream.id,
            length: 4,
        };
        let _ = frame.write(&mut writer_stream);
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

    pub fn send_go_away(
        &self,
        stream_identifier: u32,
        rst_code: ErrorCode,
        debug_data: &[u8],
        last_stream_id: u32,
        emit_error: bool,
    ) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_GOAWAY {} code {} debug_data {} emitError {}",
            stream_identifier,
            rst_code.0,
            BStr::new(debug_data),
            emit_error
        );
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 8];
        let mut stream = FixedBufferStream::new(&mut buffer);

        let mut frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_GOAWAY as u8,
            flags: 0,
            stream_identifier,
            length: u32::try_from(8 + debug_data.len()).expect("int cast"),
        };
        let _ = frame.write(&mut stream);
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

    pub fn send_alt_svc(&self, stream_identifier: u32, origin_str: &[u8], alt: &[u8]) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_ALTSVC stream {} origin {} alt {}",
            stream_identifier,
            BStr::new(origin_str),
            BStr::new(alt)
        );

        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 2];
        let mut stream = FixedBufferStream::new(&mut buffer);

        let mut frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_ALTSVC as u8,
            flags: 0,
            stream_identifier,
            length: u32::try_from(origin_str.len() + alt.len() + 2).expect("int cast"),
        };
        let _ = frame.write(&mut stream);
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

    pub fn send_ping(&self, ack: bool, payload: &[u8]) {
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
        let mut frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_PING as u8,
            flags: if ack { PingFrameFlags::ACK as u8 } else { 0 },
            stream_identifier: 0,
            length: 8,
        };
        let _ = frame.write(&mut stream);
        let _ = stream.write_all(payload);
        let _ = self.write(&buffer);
    }

    pub fn send_preface_and_settings(&self) {
        bun_output::scoped_log!(H2FrameParser, "sendPrefaceAndSettings");
        // PREFACE + Settings Frame
        let mut preface_buffer =
            [0u8; 24 + FrameHeader::BYTE_SIZE + FullSettingsPayload::BYTE_SIZE];
        let mut preface_stream = FixedBufferStream::new(&mut preface_buffer);
        let _ = preface_stream.write_all(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
        let mut settings_header = FrameHeader {
            type_: FrameType::HTTP_FRAME_SETTINGS as u8,
            flags: 0,
            stream_identifier: 0,
            length: FullSettingsPayload::BYTE_SIZE as u32,
        };
        self.outstanding_settings
            .set(self.outstanding_settings.get() + 1);
        let _ = settings_header.write(&mut preface_stream);
        let _ = self.local_settings.get().write(&mut preface_stream);
        let _ = self.write(&preface_buffer);
    }

    pub fn send_settings_ack(&self) {
        bun_output::scoped_log!(H2FrameParser, "send HTTP_FRAME_SETTINGS ack true");
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE];
        let mut stream = FixedBufferStream::new(&mut buffer);
        let mut settings_header = FrameHeader {
            type_: FrameType::HTTP_FRAME_SETTINGS as u8,
            flags: SettingsFlags::ACK as u8,
            stream_identifier: 0,
            length: 0,
        };
        let _ = settings_header.write(&mut stream);
        let _ = self.write(&buffer);
    }

    pub fn send_window_update(&self, stream_identifier: u32, window_size: UInt31WithReserved) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_WINDOW_UPDATE stream {} size {}",
            stream_identifier,
            window_size.uint31()
        );
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 4];
        let mut stream = FixedBufferStream::new(&mut buffer);
        let mut settings_header = FrameHeader {
            type_: FrameType::HTTP_FRAME_WINDOW_UPDATE as u8,
            flags: 0,
            stream_identifier,
            length: 4,
        };
        let _ = settings_header.write(&mut stream);
        let _ = window_size.write(&mut stream);
        let _ = self.write(&buffer);
    }

    pub fn dispatch(&self, event: JSH2FrameParser::Gc, value: JSValue) {
        value.ensure_still_alive();
        let Some(this_value) = self.strong_this.get().try_get() else {
            return;
        };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else {
            return;
        };
        let _ = self.handlers.get().call_event_handler(
            event,
            this_value,
            ctx_value,
            &[ctx_value, value],
        );
    }

    pub fn call(&self, event: JSH2FrameParser::Gc, value: JSValue) -> JSValue {
        let Some(this_value) = self.strong_this.get().try_get() else {
            return JSValue::ZERO;
        };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else {
            return JSValue::ZERO;
        };
        value.ensure_still_alive();
        self.handlers
            .get()
            .call_event_handler_with_result(event, this_value, &[ctx_value, value])
    }

    pub fn dispatch_write_callback(&self, callback: JSValue) {
        let _ = self.handlers.get().call_write_callback(callback, &[]);
    }

    pub fn dispatch_with_extra(&self, event: JSH2FrameParser::Gc, value: JSValue, extra: JSValue) {
        let Some(this_value) = self.strong_this.get().try_get() else {
            return;
        };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else {
            return;
        };
        value.ensure_still_alive();
        extra.ensure_still_alive();
        let _ = self.handlers.get().call_event_handler(
            event,
            this_value,
            ctx_value,
            &[ctx_value, value, extra],
        );
    }

    pub fn dispatch_with_2_extra(
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
        let _ = self.handlers.get().call_event_handler(
            event,
            this_value,
            ctx_value,
            &[ctx_value, value, extra, extra2],
        );
    }

    pub fn dispatch_with_3_extra(
        &self,
        event: JSH2FrameParser::Gc,
        value: JSValue,
        extra: JSValue,
        extra2: JSValue,
        extra3: JSValue,
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
        extra3.ensure_still_alive();
        let _ = self.handlers.get().call_event_handler(
            event,
            this_value,
            ctx_value,
            &[ctx_value, value, extra, extra2, extra3],
        );
    }

    fn cork(&self) {
        if let Some(corked) = CORKED_H2.with(|c| c.get()) {
            if corked as usize == self.as_ctx_ptr() as usize {
                // already corked
                return;
            }
            // force uncork
            // SAFETY: CORKED_H2 holds a ref()'d *mut H2FrameParser; valid until matching deref() in uncork
            unsafe { (*corked.cast_const()).uncork() };
        }
        // cork
        CORKED_H2.with(|c| c.set(Some(self.as_ctx_ptr())));
        self.ref_();
        self.register_auto_flush();
        bun_output::scoped_log!(H2FrameParser, "cork {:p}", self);
        CORK_OFFSET.with(|c| c.set(0));
    }

    pub fn _generic_flush<S: NativeSocketWrite>(&self, mut socket: S) -> usize {
        let buffer_len = self.write_buffer.get().slice()[self.write_buffer_offset.get()..].len();
        if buffer_len > 0 {
            let result: i32 = socket.write_maybe_corked(
                &self.write_buffer.get().slice()[self.write_buffer_offset.get()..],
            );
            let written: u32 = if result < 0 {
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

    pub fn _generic_write<S: NativeSocketWrite>(&self, mut socket: S, bytes: &[u8]) -> bool {
        bun_output::scoped_log!(H2FrameParser, "_genericWrite {}", bytes.len());

        let global = self.global();
        let buffered_len = self.write_buffer.get().slice()[self.write_buffer_offset.get()..].len();
        if buffered_len > 0 {
            {
                let result: i32 = socket.write_maybe_corked(
                    &self.write_buffer.get().slice()[self.write_buffer_offset.get()..],
                );
                let written: u32 = if result < 0 {
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

    pub fn flush(&self) -> usize {
        bun_output::scoped_log!(H2FrameParser, "flush");
        // Zig: `this.ref(); defer this.deref();` — keep `self` alive across the
        // re-entrant JS calls below. ScopedRef stores a raw pointer so it does
        // not borrow `self`.
        // SAFETY: `self` is live; all mutation goes through `Cell`/`JsCell`
        // (UnsafeCell-backed), so the `*mut` cast is signature-only.
        let _keepalive = unsafe { bun_ptr::ScopedRef::new(self.as_ctx_ptr()) };

        self.uncork();
        let mut written = match self.native_socket.get() {
            BunSocket::TlsWriteonly(socket) | BunSocket::Tls(socket) => {
                self._generic_flush(socket.get())
            }
            BunSocket::TcpWriteonly(socket) | BunSocket::Tcp(socket) => {
                self._generic_flush(socket.get())
            }
            BunSocket::None => {
                // consider that backpressure is gone and flush data queue
                self.has_nonnative_backpressure.set(false);
                let bytes_len = self.write_buffer.get().slice().len();
                if bytes_len > 0 {
                    let global = self.handlers.get().global();
                    let output_value = self
                        .handlers
                        .get()
                        .binary_type
                        .to_js(self.write_buffer.get().slice(), &global)
                        .unwrap_or(JSValue::ZERO);
                    // TODO: properly propagate exception upwards
                    let result = self.call(JSH2FrameParser::Gc::onWrite, output_value);

                    // defer block
                    self.write_buffer_offset.set(0);
                    self.write_buffer.with_mut(|wb| {
                        wb.clear();
                        if wb.capacity() > MAX_BUFFER_SIZE as usize {
                            wb.shrink_to(MAX_BUFFER_SIZE as usize);
                        }
                    });

                    if result.is_boolean() && !result.to_boolean() {
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

    pub fn _write(&self, bytes: &[u8]) -> bool {
        self.ref_();
        let result = match self.native_socket.get() {
            BunSocket::TlsWriteonly(socket) | BunSocket::Tls(socket) => {
                self._generic_write(socket.get(), bytes)
            }
            BunSocket::TcpWriteonly(socket) | BunSocket::Tcp(socket) => {
                self._generic_write(socket.get(), bytes)
            }
            BunSocket::None => {
                let global = self.global();
                if self.has_nonnative_backpressure.get() {
                    // we should not invoke JS when we have backpressure is cheaper to keep it queued here
                    let _ = self.write_buffer.with_mut(|wb| wb.write(bytes));
                    global.vm().deprecated_report_extra_memory(bytes.len());
                    self.deref();
                    return false;
                }
                // fallback to onWrite non-native callback
                let output_value = self
                    .handlers
                    .get()
                    .binary_type
                    .to_js(bytes, &self.handlers.get().global())
                    .unwrap_or(JSValue::ZERO);
                // TODO: properly propagate exception upwards
                let result = self.call(JSH2FrameParser::Gc::onWrite, output_value);
                let code = if result.is_number() {
                    result.to_int32()
                } else {
                    -1
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
                self.deref();
                return r;
            }
        };
        self.deref();
        result
    }

    fn has_backpressure(&self) -> bool {
        self.write_buffer.get().len_u32() > 0 || self.has_nonnative_backpressure.get()
    }

    fn uncork(&self) {
        if let Some(corked_ptr) = CORKED_H2.with(|c| c.get()) {
            // SAFETY: CORKED_H2 holds a ref()'d *mut H2FrameParser, valid until the matching
            // deref() below. R-2: deref as shared (`&*const`) — every method below takes `&self`.
            let corked: &H2FrameParser = unsafe { &*corked_ptr.cast_const() };
            corked.unregister_auto_flush();
            bun_output::scoped_log!(H2FrameParser, "uncork {:p}", corked_ptr);

            let off = CORK_OFFSET.with(|c| c.get()) as usize;
            CORK_OFFSET.with(|c| c.set(0));
            CORKED_H2.with(|c| c.set(None));

            if off > 0 {
                CORK_BUFFER.with_borrow(|buf| {
                    let _ = corked._write(&buf[0..off]);
                });
            }
            corked.deref();
        }
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

    pub fn on_auto_flush(&self) -> bool {
        self.ref_();
        let _ = self.flush();
        self.deref();
        // we will unregister ourselves when the buffer is empty
        true
    }

    pub fn write(&self, bytes: &[u8]) -> bool {
        bun_output::scoped_log!(H2FrameParser, "write {}", bytes.len());
        if ENABLE_AUTO_CORK {
            self.cork();
            let off = CORK_OFFSET.with(|c| c.get()) as usize;
            let avail = 16386 - off;
            if bytes.len() > avail {
                // not worth corking
                if off != 0 {
                    // clean already corked data
                    self.uncork();
                }
                self._write(bytes)
            } else {
                // write at the cork buffer
                CORK_OFFSET.with(|c| c.set((off + bytes.len()) as u16));
                CORK_BUFFER.with_borrow_mut(|buf| {
                    buf[off..off + bytes.len()].copy_from_slice(bytes);
                });
                true
            }
        } else {
            self._write(bytes)
        }
    }
}

// PORT NOTE: raw-ptr slice — Zig's `[]const u8` payload may alias `this.readBuffer` across
// `readBuffer.reset()` (e.g. handleHeadersFrame resets then calls decodeHeaderBlock(payload)).
// A borrowed `&'a [u8]` tied to `&'a mut self` forces every caller into an aliasing
// `unsafe { &mut *self_ptr }` reborrow, which under Stacked Borrows invalidates the slice the
// moment the caller touches `self` again. Carrying a raw pointer keeps the Zig aliasing intent
// without materialising overlapping `&mut` borrows.
pub struct Payload {
    data_ptr: *const u8,
    data_len: usize,
    end: usize,
}

impl Payload {
    /// Re-borrow the payload bytes as `&[u8]`, tied to `&self`.
    ///
    /// # Safety (encapsulated)
    /// `data_ptr`/`data_len` describe a slice into either the caller-supplied `data` (alive for
    /// the handler body) or `H2FrameParser.read_buffer.list`'s backing allocation. Both outlive
    /// the local `Payload` returned by `handle_incomming_payload`: the caller's `data` lives for
    /// the entire handler body, and `read_buffer` is never grown/freed between obtaining the
    /// `Payload` and the last use of the returned slice. `read_buffer.reset()` is permitted:
    /// `data_ptr` is derived via `Vec::as_mut_ptr()` (raw-ptr method, no intermediate `&[u8]`
    /// borrow), which is documented to remain valid across non-reallocating mutation, so under
    /// Stacked Borrows the `Vec::clear()` inside `reset()` does not invalidate it and the bytes
    /// remain readable (matches the Zig ordering where several handlers reset before consuming
    /// `payload`). The returned borrow is tied to the local `Payload` (not `self: H2FrameParser`),
    /// so `&mut self` operations on the parser do not conflict with it under borrowck.
    #[inline]
    fn data(&self) -> &[u8] {
        // SAFETY: see doc comment above — `data_ptr` is valid for `data_len` bytes for the
        // full lifetime of this `Payload` local. `ffi::slice` tolerates the (null, 0) shape
        // used for empty payloads.
        unsafe { bun_core::ffi::slice(self.data_ptr, self.data_len) }
    }
}

/// Trait to abstract over TLSSocket / TCPSocket for `_generic_flush`/`_generic_write`.
pub trait NativeSocketWrite {
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
// H2FrameParser impl — frame handlers
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    // Default handling for payload is buffering it
    // for data frames we use another strategy
    pub fn handle_incomming_payload(&self, data: &[u8], stream_identifier: u32) -> Option<Payload> {
        let end: usize = (self.remaining_length.get() as usize).min(data.len());
        let payload = &data[0..end];
        self.remaining_length
            .set(self.remaining_length.get() - i32::try_from(end).expect("int cast"));
        if self.remaining_length.get() > 0 {
            // buffer more data
            let _ = self.read_buffer.with_mut(|rb| rb.append_slice(payload));
            self.global()
                .vm()
                .deprecated_report_extra_memory(payload.len());
            return None;
        } else if self.remaining_length.get() < 0 {
            self.send_go_away(
                stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"Invalid frame size",
                self.last_stream_id.get(),
                true,
            );
            return None;
        }

        self.current_frame.set(None);

        if !self.read_buffer.get().list.is_empty() {
            // return buffered data
            let _ = self.read_buffer.with_mut(|rb| rb.append_slice(payload));
            self.global()
                .vm()
                .deprecated_report_extra_memory(payload.len());

            // SAFETY contract for Payload::data: derive via Vec::as_mut_ptr() (raw-ptr method,
            // no intermediate &[u8]) so the provenance survives `read_buffer.reset()` —
            // Vec::clear() forms `&mut [u8]` internally, which under Stacked Borrows would pop a
            // SharedReadOnly tag obtained from `as_slice().as_ptr()`. Several handlers
            // (origin/altsvc/continuation/headers) read `payload` AFTER reset(), mirroring the
            // Zig ordering, so the pointer must outlive that mutation. R-2: `JsCell` is
            // `UnsafeCell`-backed; deriving the pointer via `with_mut` keeps SharedReadWrite
            // provenance through later `read_buffer` accesses.
            let (data_ptr, data_len) = self.read_buffer.with_mut(|rb| {
                let list = &mut rb.list;
                (list.as_mut_ptr().cast_const(), list.len())
            });
            return Some(Payload {
                data_ptr,
                data_len,
                end,
            });
        }

        Some(Payload {
            data_ptr: payload.as_ptr(),
            data_len: payload.len(),
            end,
        })
    }

    pub fn handle_window_update_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream: Option<*mut Stream>,
    ) -> usize {
        bun_output::scoped_log!(
            H2FrameParser,
            "handleWindowUpdateFrame {}",
            frame.stream_identifier
        );
        // must be always 4 bytes (https://datatracker.ietf.org/doc/html/rfc7540#section-6.9)
        if frame.length != 4 {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"Invalid dataframe frame size",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }

        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data();
            let window_size_increment = UInt31WithReserved::from_bytes(payload);
            let end = content.end;
            self.read_buffer.with_mut(|rb| rb.reset());
            if let Some(s) = stream {
                // SAFETY: s is *mut Stream from self.streams; valid while the map entry exists
                unsafe { (*s).remote_window_size += window_size_increment.uint31() as u64 };
            } else {
                self.remote_window_size
                    .set(self.remote_window_size.get() + window_size_increment.uint31() as u64);
            }
            bun_output::scoped_log!(
                H2FrameParser,
                "windowSizeIncrement stream {} value {}",
                frame.stream_identifier,
                window_size_increment.uint31()
            );
            // at this point we try to send more data because we received a window update
            let _ = self.flush();
            return end;
        }
        // needs more data
        data.len()
    }

    pub fn decode_header_block(
        &self,
        payload: &[u8],
        stream: &mut Stream,
        flags: u8,
    ) -> JsResult<Option<*mut Stream>> {
        bun_output::scoped_log!(
            H2FrameParser,
            "decodeHeaderBlock isSever: {}",
            self.is_server.get()
        );

        let mut offset: usize = 0;
        let global_object = self.handlers.get().global();
        if self.handlers.get().vm.is_shutting_down() {
            return Ok(None);
        }

        let stream_id = stream.id;
        let headers = JSValue::create_empty_array(&global_object, 0)?;
        headers.ensure_still_alive();

        let mut sensitive_headers: JSValue = JSValue::UNDEFINED;
        let mut count: usize = 0;
        // RFC 7540 Section 6.5.2: Track cumulative header list size
        let mut header_list_size: usize = 0;

        loop {
            let header = match self.decode(&payload[offset..]) {
                Ok(h) => h,
                Err(_) => break,
            };
            offset += header.next;
            bun_output::scoped_log!(
                H2FrameParser,
                "header {} {}",
                BStr::new(header.name),
                BStr::new(header.value)
            );
            if self.is_server.get() && header.name == b":status" {
                self.send_go_away(
                    stream_id,
                    ErrorCode::PROTOCOL_ERROR,
                    b"Server received :status header",
                    self.last_stream_id.get(),
                    true,
                );
                return Ok(self.streams.get().get(&stream_id).copied());
            }

            // RFC 7540 Section 6.5.2: Calculate header list size
            // Size = name length + value length + HPACK entry overhead per header
            header_list_size += header.name.len() + header.value.len() + HPACK_ENTRY_OVERHEAD;

            // Check against maxHeaderListSize setting
            if header_list_size > self.local_settings.get().max_header_list_size as usize {
                self.rejected_streams.set(self.rejected_streams.get() + 1);
                if self.max_rejected_streams.get() <= self.rejected_streams.get() {
                    self.send_go_away(
                        stream_id,
                        ErrorCode::ENHANCE_YOUR_CALM,
                        b"ENHANCE_YOUR_CALM",
                        self.last_stream_id.get(),
                        true,
                    );
                } else {
                    self.end_stream(stream, ErrorCode::ENHANCE_YOUR_CALM);
                }
                return Ok(self.streams.get().get(&stream_id).copied());
            }

            count += 1;
            if (self.max_header_list_pairs.get() as usize) < count {
                self.rejected_streams.set(self.rejected_streams.get() + 1);
                if self.max_rejected_streams.get() <= self.rejected_streams.get() {
                    self.send_go_away(
                        stream_id,
                        ErrorCode::ENHANCE_YOUR_CALM,
                        b"ENHANCE_YOUR_CALM",
                        self.last_stream_id.get(),
                        true,
                    );
                } else {
                    self.end_stream(stream, ErrorCode::ENHANCE_YOUR_CALM);
                }
                return Ok(self.streams.get().get(&stream_id).copied());
            }

            if let Some(js_header_name) =
                get_http2_common_string(&global_object, header.well_know as u32)
            {
                headers.push(&global_object, js_header_name)?;
                headers.push(
                    &global_object,
                    bun_jsc::bun_string_jsc::create_utf8_for_js(&global_object, header.value)?,
                )?;
                if header.never_index {
                    if sensitive_headers.is_undefined() {
                        sensitive_headers = JSValue::create_empty_array(&global_object, 0)?;
                        sensitive_headers.ensure_still_alive();
                    }
                    sensitive_headers.push(&global_object, js_header_name)?;
                }
            } else {
                let js_header_name =
                    bun_jsc::bun_string_jsc::create_utf8_for_js(&global_object, header.name)?;
                let js_header_value =
                    bun_jsc::bun_string_jsc::create_utf8_for_js(&global_object, header.value)?;

                if header.never_index {
                    if sensitive_headers.is_undefined() {
                        sensitive_headers = JSValue::create_empty_array(&global_object, 0)?;
                        sensitive_headers.ensure_still_alive();
                    }
                    sensitive_headers.push(&global_object, js_header_name)?;
                }

                headers.push(&global_object, js_header_name)?;
                headers.push(&global_object, js_header_value)?;

                js_header_name.ensure_still_alive();
                js_header_value.ensure_still_alive();
            }

            if offset >= payload.len() {
                break;
            }
        }

        self.dispatch_with_3_extra(
            JSH2FrameParser::Gc::onStreamHeaders,
            stream.get_identifier(),
            headers,
            sensitive_headers,
            JSValue::js_number(flags as f64),
        );
        Ok(self.streams.get().get(&stream_id).copied())
    }

    pub fn handle_data_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream_: Option<*mut Stream>,
    ) -> usize {
        bun_output::scoped_log!(
            H2FrameParser,
            "handleDataFrame {} data.len: {}",
            if self.is_server.get() {
                "server"
            } else {
                "client"
            },
            data.len()
        );
        self.read_buffer.with_mut(|rb| rb.reset());

        let Some(stream_ptr) = stream_ else {
            bun_output::scoped_log!(
                H2FrameParser,
                "received data frame on stream that does not exist"
            );
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Data frame on connection stream",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        };
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let mut stream = unsafe { &mut *stream_ptr };

        let settings = self
            .remote_settings
            .get()
            .unwrap_or(self.local_settings.get());

        let max_frame_size = settings.max_frame_size;
        if frame.length > max_frame_size {
            bun_output::scoped_log!(
                H2FrameParser,
                "received data frame with length: {} and max frame size: {}",
                frame.length,
                max_frame_size
            );
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"Invalid dataframe frame size",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }

        let end: usize = (self.remaining_length.get() as usize).min(data.len());
        let mut payload = &data[0..end];
        // window size considering the full frame.length received so far
        self.adjust_window_size(Some(stream), payload.len() as u32);
        // SAFETY: stream_ptr unchanged; re-borrow after intervening call (borrowck reshape)
        stream = unsafe { &mut *stream_ptr };
        let previous_remaining_length: isize = self.remaining_length.get() as isize;

        self.remaining_length
            .set(self.remaining_length.get() - i32::try_from(end).expect("int cast"));
        let mut padding: u8 = 0;
        let padded = frame.flags & DataFrameFlags::PADDED as u8 != 0;
        if padded {
            if frame.length < 1 {
                // PADDED flag set but no room for the Pad Length octet
                self.send_go_away(
                    frame.stream_identifier,
                    ErrorCode::FRAME_SIZE_ERROR,
                    b"Invalid data frame size",
                    self.last_stream_id.get(),
                    true,
                );
                return data.len();
            }
            if let Some(p) = stream.padding {
                padding = p;
            } else {
                if payload.is_empty() {
                    // await more data because we need to know the padding length
                    return data.len();
                }
                padding = payload[0];
                stream.padding = Some(payload[0]);
            }
            // RFC 7540 Section 6.1: If the length of the padding is the length of
            // the frame payload or greater, the recipient MUST treat this as a
            // connection error of type PROTOCOL_ERROR. Validate before computing
            // `data_region_end = frame.length - padding` below to avoid underflow.
            if padding as usize >= frame.length as usize {
                self.send_go_away(
                    frame.stream_identifier,
                    ErrorCode::PROTOCOL_ERROR,
                    b"Invalid data frame padding",
                    self.last_stream_id.get(),
                    true,
                );
                return data.len();
            }
        }
        if self.remaining_length.get() < 0 {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"Invalid data frame size",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }
        let mut emitted = false;

        let start_idx =
            (frame.length as usize) - usize::try_from(previous_remaining_length).expect("int cast");
        if start_idx < 1 && padded && !payload.is_empty() {
            // Skip the Pad Length octet. Keyed on the PADDED flag rather than
            // `padding > 0` because Pad Length = 0 is valid (RFC 7540 Section 6.1)
            // and must still be stripped.
            payload = &payload[1..];
        }

        if !payload.is_empty() {
            // amount of data received so far
            let received_size = frame.length as i32 - self.remaining_length.get();
            let data_region_end: usize = frame.length as usize - padding as usize;
            let data_region_start: usize = if padded { start_idx.max(1) } else { start_idx };
            let max_payload_size: usize = data_region_end.saturating_sub(data_region_start);
            payload = &payload[0..payload.len().min(max_payload_size)];
            bun_output::scoped_log!(
                H2FrameParser,
                "received_size: {} max_payload_size: {} padding: {} payload.len: {}",
                received_size,
                max_payload_size,
                padding,
                payload.len()
            );

            if !payload.is_empty() {
                // no padding, just emit the data
                let global = self.handlers.get().global();
                let chunk = self
                    .handlers
                    .get()
                    .binary_type
                    .to_js(payload, &global)
                    .unwrap_or(JSValue::ZERO);
                // TODO: properly propagate exception upwards
                self.dispatch_with_extra(
                    JSH2FrameParser::Gc::onStreamData,
                    stream.get_identifier(),
                    chunk,
                );
                emitted = true;
            }
        }
        if self.remaining_length.get() == 0 {
            self.current_frame.set(None);
            stream.padding = None;
            if emitted {
                stream = match self.streams.get().get(&frame.stream_identifier).copied() {
                    // SAFETY: s is *mut Stream from self.streams (heap::alloc); valid while the map entry exists
                    Some(s) => unsafe { &mut *s },
                    None => return end,
                };
            }
            if frame.flags & DataFrameFlags::END_STREAM as u8 != 0 {
                let identifier = stream.get_identifier();
                identifier.ensure_still_alive();

                if stream.state == StreamState::HALF_CLOSED_LOCAL {
                    stream.state = StreamState::CLOSED;
                    stream.free_resources::<false>(self);
                } else {
                    stream.state = StreamState::HALF_CLOSED_REMOTE;
                }
                self.dispatch_with_extra(
                    JSH2FrameParser::Gc::onStreamEnd,
                    identifier,
                    JSValue::js_number(stream.state as u8 as f64),
                );
            }
        }

        end
    }

    pub fn handle_go_away_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream_: Option<*mut Stream>,
    ) -> usize {
        bun_output::scoped_log!(
            H2FrameParser,
            "handleGoAwayFrame {} {}",
            frame.stream_identifier,
            BStr::new(data)
        );
        if stream_.is_some() {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"GoAway frame on stream",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }
        let settings = self
            .remote_settings
            .get()
            .unwrap_or(self.local_settings.get());

        if frame.length < 8 || frame.length > settings.max_frame_size {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"invalid GoAway frame size",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }

        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data();
            let error_code = u32_from_bytes(&payload[4..8]);
            let global = self.handlers.get().global();
            let chunk = self
                .handlers
                .get()
                .binary_type
                .to_js(&payload[8..], &global)
                .unwrap_or(JSValue::ZERO);
            // TODO: properly propagate exception upwards
            let end = content.end;
            self.read_buffer.with_mut(|rb| rb.reset());
            self.dispatch_with_2_extra(
                JSH2FrameParser::Gc::onGoAway,
                JSValue::js_number(error_code as f64),
                JSValue::js_number(self.last_stream_id.get() as f64),
                chunk,
            );
            return end;
        }
        data.len()
    }

    fn string_or_empty_to_js(&self, payload: &[u8]) -> JsResult<JSValue> {
        let global = self.handlers.get().global();
        if payload.is_empty() {
            return BunString::empty().to_js(&global);
        }
        bun_jsc::bun_string_jsc::create_utf8_for_js(&global, payload)
    }

    pub fn handle_origin_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        _: Option<*mut Stream>,
    ) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "handleOriginFrame {}", BStr::new(data));
        if self.is_server.get() {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"ORIGIN frame on server",
                self.last_stream_id.get(),
                true,
            );
            return Ok(data.len());
        }
        if frame.stream_identifier != 0 {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"ORIGIN frame on stream",
                self.last_stream_id.get(),
                true,
            );
            return Ok(data.len());
        }
        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let mut payload = content.data();
            let mut origin_value: JSValue = JSValue::UNDEFINED;
            let mut count: usize = 0;
            let end = content.end;
            self.read_buffer.with_mut(|rb| rb.reset());

            let global = self.handlers.get().global();
            while !payload.is_empty() {
                // TODO(port): fixedBufferStream over const slice for reading u16 BE
                if payload.len() < 2 {
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "error reading ORIGIN frame size: short read"
                    );
                    self.send_go_away(
                        frame.stream_identifier,
                        ErrorCode::FRAME_SIZE_ERROR,
                        b"invalid ORIGIN frame size",
                        self.last_stream_id.get(),
                        true,
                    );
                    return Ok(end);
                }
                let origin_length = u16::from_be_bytes([payload[0], payload[1]]) as usize;
                let mut origin_str = &payload[2..];
                if origin_str.len() < origin_length {
                    self.send_go_away(
                        frame.stream_identifier,
                        ErrorCode::FRAME_SIZE_ERROR,
                        b"invalid ORIGIN frame size",
                        self.last_stream_id.get(),
                        true,
                    );
                    return Ok(end);
                }
                origin_str = &origin_str[0..origin_length];
                if count == 0 {
                    origin_value = self.string_or_empty_to_js(origin_str)?;
                    origin_value.ensure_still_alive();
                } else if count == 1 {
                    // need to create an array
                    let array = JSValue::create_empty_array(&global, 0)?;
                    array.ensure_still_alive();
                    array.push(&global, origin_value)?;
                    array.push(&global, self.string_or_empty_to_js(origin_str)?)?;
                    origin_value = array;
                } else {
                    // we already have an array, just add the origin to it
                    origin_value.push(&global, self.string_or_empty_to_js(origin_str)?)?;
                }
                count += 1;
                payload = &payload[origin_length + 2..];
            }

            self.dispatch(JSH2FrameParser::Gc::onOrigin, origin_value);
            return Ok(end);
        }
        Ok(data.len())
    }

    pub fn handle_altsvc_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream_: Option<*mut Stream>,
    ) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "handleAltsvcFrame {}", BStr::new(data));
        if self.is_server.get() {
            // client should not send ALTSVC frame
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"ALTSVC frame on server",
                self.last_stream_id.get(),
                true,
            );
            return Ok(data.len());
        }
        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data();
            let end = content.end;
            self.read_buffer.with_mut(|rb| rb.reset());

            if payload.len() < 2 {
                self.send_go_away(
                    frame.stream_identifier,
                    ErrorCode::FRAME_SIZE_ERROR,
                    b"invalid ALTSVC frame size",
                    self.last_stream_id.get(),
                    true,
                );
                return Ok(end);
            }
            let origin_length = u16::from_be_bytes([payload[0], payload[1]]) as usize;
            let origin_and_value = &payload[2..];

            if origin_and_value.len() < origin_length {
                self.send_go_away(
                    frame.stream_identifier,
                    ErrorCode::FRAME_SIZE_ERROR,
                    b"invalid ALTSVC frame size",
                    self.last_stream_id.get(),
                    true,
                );
                return Ok(end);
            }
            if frame.stream_identifier != 0 && stream_.is_none() {
                // dont error but stream dont exist so we can ignore it
                return Ok(end);
            }

            self.dispatch_with_2_extra(
                JSH2FrameParser::Gc::onAltSvc,
                self.string_or_empty_to_js(&origin_and_value[0..origin_length])?,
                self.string_or_empty_to_js(&origin_and_value[origin_length..])?,
                JSValue::js_number(frame.stream_identifier as f64),
            );
            return Ok(end);
        }
        Ok(data.len())
    }

    pub fn handle_rst_stream_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream_: Option<*mut Stream>,
    ) -> usize {
        bun_output::scoped_log!(H2FrameParser, "handleRSTStreamFrame {}", BStr::new(data));
        let Some(stream_ptr) = stream_ else {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"RST_STREAM frame on connection stream",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        };
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let stream = unsafe { &mut *stream_ptr };

        if frame.length != 4 {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"invalid RST_STREAM frame size",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }

        if stream.is_waiting_more_headers {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Headers frame without continuation",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }

        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data();
            let rst_code = u32_from_bytes(payload);
            stream.rst_code = rst_code;
            let end = content.end;
            self.read_buffer.with_mut(|rb| rb.reset());
            stream.state = StreamState::CLOSED;
            let identifier = stream.get_identifier();
            identifier.ensure_still_alive();
            stream.free_resources::<false>(self);
            if rst_code == ErrorCode::NO_ERROR.0 {
                self.dispatch_with_extra(
                    JSH2FrameParser::Gc::onStreamEnd,
                    identifier,
                    JSValue::js_number(stream.state as u8 as f64),
                );
            } else {
                self.dispatch_with_extra(
                    JSH2FrameParser::Gc::onStreamError,
                    identifier,
                    JSValue::js_number(rst_code as f64),
                );
            }
            return end;
        }
        data.len()
    }

    pub fn handle_ping_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream_: Option<*mut Stream>,
    ) -> usize {
        if stream_.is_some() {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Ping frame on stream",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }

        if frame.length != 8 {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"Invalid ping frame size",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }

        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data();
            let is_not_ack = frame.flags & PingFrameFlags::ACK as u8 == 0;
            let end = content.end;
            // PORT NOTE: Zig resets readBuffer before send_ping(payload); reset() only clears len
            // so the bytes stay readable. Copy out anyway so send_ping/to_js below don't depend on
            // that subtlety once read_buffer is mutated further.
            let payload_owned = payload.to_vec();
            self.read_buffer.with_mut(|rb| rb.reset());

            // if is not ACK send response
            if is_not_ack {
                self.send_ping(true, &payload_owned);
            } else {
                self.out_standing_pings
                    .set(self.out_standing_pings.get().saturating_sub(1));
            }
            let global = self.handlers.get().global();
            let buffer = self
                .handlers
                .get()
                .binary_type
                .to_js(&payload_owned, &global)
                .unwrap_or(JSValue::ZERO);
            // TODO: properly propagate exception upwards
            self.dispatch_with_extra(
                JSH2FrameParser::Gc::onPing,
                buffer,
                JSValue::from(!is_not_ack),
            );
            return end;
        }
        data.len()
    }

    pub fn handle_priority_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream_: Option<*mut Stream>,
    ) -> usize {
        let Some(stream_ptr) = stream_ else {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Priority frame on connection stream",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        };
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let stream = unsafe { &mut *stream_ptr };

        if frame.length as usize != StreamPriority::BYTE_SIZE {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"invalid Priority frame size",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }

        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data();
            let end = content.end;

            let mut priority = StreamPriority::default();
            StreamPriority::from(&mut priority, payload);
            self.read_buffer.with_mut(|rb| rb.reset());

            let stream_identifier = UInt31WithReserved::from(priority.stream_identifier);
            if stream_identifier.uint31() == stream.id {
                self.send_go_away(
                    stream.id,
                    ErrorCode::PROTOCOL_ERROR,
                    b"Priority frame with self dependency",
                    self.last_stream_id.get(),
                    true,
                );
                return end;
            }
            stream.stream_dependency = stream_identifier.uint31();
            stream.exclusive = stream_identifier.reserved();
            stream.weight = priority.weight as u16;

            return end;
        }
        data.len()
    }

    /// RFC 7540 Section 6.10: Handle CONTINUATION frame (type=0x9).
    pub fn handle_continuation_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream_: Option<*mut Stream>,
    ) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "handleContinuationFrame");
        let Some(stream_ptr) = stream_ else {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Continuation on connection stream",
                self.last_stream_id.get(),
                true,
            );
            return Ok(data.len());
        };
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let mut stream = unsafe { &mut *stream_ptr };

        if !stream.is_waiting_more_headers {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Continuation without headers",
                self.last_stream_id.get(),
                true,
            );
            return Ok(data.len());
        }
        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data();
            let end = content.end;
            self.read_buffer.with_mut(|rb| rb.reset());
            stream.end_after_headers = frame.flags & HeadersFrameFlags::END_STREAM as u8 != 0;
            stream = match self.decode_header_block(payload, stream, frame.flags)? {
                // SAFETY: s is *mut Stream from self.streams (heap::alloc); valid while the map entry exists
                Some(s) => unsafe { &mut *s },
                None => return Ok(end),
            };
            if stream.end_after_headers {
                stream.is_waiting_more_headers = false;
                if frame.flags & HeadersFrameFlags::END_STREAM as u8 != 0 {
                    let identifier = stream.get_identifier();
                    identifier.ensure_still_alive();
                    if stream.state == StreamState::HALF_CLOSED_REMOTE {
                        // no more continuation headers we can call it closed
                        stream.state = StreamState::CLOSED;
                        stream.free_resources::<false>(self);
                    } else {
                        stream.state = StreamState::HALF_CLOSED_LOCAL;
                    }
                    self.dispatch_with_extra(
                        JSH2FrameParser::Gc::onStreamEnd,
                        identifier,
                        JSValue::js_number(stream.state as u8 as f64),
                    );
                }
            }
            return Ok(end);
        }

        // needs more data
        Ok(data.len())
    }

    pub fn handle_headers_frame(
        &self,
        frame: FrameHeader,
        data: &[u8],
        stream_: Option<*mut Stream>,
    ) -> JsResult<usize> {
        bun_output::scoped_log!(
            H2FrameParser,
            "handleHeadersFrame {}",
            if self.is_server.get() {
                "server"
            } else {
                "client"
            }
        );
        let Some(stream_ptr) = stream_ else {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Headers frame on connection stream",
                self.last_stream_id.get(),
                true,
            );
            return Ok(data.len());
        };
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let mut stream = unsafe { &mut *stream_ptr };

        let settings = self
            .remote_settings
            .get()
            .unwrap_or(self.local_settings.get());
        if frame.length > settings.max_frame_size {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::FRAME_SIZE_ERROR,
                b"invalid Headers frame size",
                self.last_stream_id.get(),
                true,
            );
            return Ok(data.len());
        }

        if stream.is_waiting_more_headers {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Headers frame without continuation",
                self.last_stream_id.get(),
                true,
            );
            return Ok(data.len());
        }

        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data();
            let mut offset: usize = 0;
            let mut padding: usize = 0;
            let end_ = content.end;
            self.read_buffer.with_mut(|rb| rb.reset());

            if frame.flags & HeadersFrameFlags::PADDED as u8 != 0 {
                if payload.len() < 1 {
                    self.send_go_away(
                        frame.stream_identifier,
                        ErrorCode::FRAME_SIZE_ERROR,
                        b"invalid Headers frame size",
                        self.last_stream_id.get(),
                        true,
                    );
                    return Ok(end_);
                }
                // padding length
                padding = payload[0] as usize;
                offset += 1;
            }
            if frame.flags & HeadersFrameFlags::PRIORITY as u8 != 0 {
                // skip priority (client dont need to care about it)
                offset += 5;
            }
            if offset > payload.len() {
                self.send_go_away(
                    frame.stream_identifier,
                    ErrorCode::FRAME_SIZE_ERROR,
                    b"invalid Headers frame size",
                    self.last_stream_id.get(),
                    true,
                );
                return Ok(end_);
            }
            if padding > payload.len() - offset {
                self.send_go_away(
                    frame.stream_identifier,
                    ErrorCode::PROTOCOL_ERROR,
                    b"invalid Headers frame padding",
                    self.last_stream_id.get(),
                    true,
                );
                return Ok(end_);
            }
            let end = payload.len() - padding;
            stream.end_after_headers = frame.flags & HeadersFrameFlags::END_STREAM as u8 != 0;
            stream = match self.decode_header_block(&payload[offset..end], stream, frame.flags)? {
                // SAFETY: s is *mut Stream from self.streams (heap::alloc); valid while the map entry exists
                Some(s) => unsafe { &mut *s },
                None => return Ok(end_),
            };
            stream.is_waiting_more_headers =
                frame.flags & HeadersFrameFlags::END_HEADERS as u8 == 0;
            if stream.end_after_headers {
                let identifier = stream.get_identifier();
                identifier.ensure_still_alive();

                if stream.is_waiting_more_headers {
                    stream.state = StreamState::HALF_CLOSED_REMOTE;
                } else {
                    // no more continuation headers we can call it closed
                    if stream.state == StreamState::HALF_CLOSED_LOCAL {
                        stream.state = StreamState::CLOSED;
                        stream.free_resources::<false>(self);
                    } else {
                        stream.state = StreamState::HALF_CLOSED_REMOTE;
                    }
                }
                self.dispatch_with_extra(
                    JSH2FrameParser::Gc::onStreamEnd,
                    identifier,
                    JSValue::js_number(stream.state as u8 as f64),
                );
            }
            return Ok(end_);
        }

        // needs more data
        Ok(data.len())
    }

    pub fn handle_settings_frame(&self, frame: FrameHeader, data: &[u8]) -> usize {
        let is_ack = frame.flags & SettingsFlags::ACK as u8 != 0;

        bun_output::scoped_log!(
            H2FrameParser,
            "handleSettingsFrame {} isACK {}",
            if self.is_server.get() {
                "server"
            } else {
                "client"
            },
            is_ack
        );
        if frame.stream_identifier != 0 {
            self.send_go_away(
                frame.stream_identifier,
                ErrorCode::PROTOCOL_ERROR,
                b"Settings frame on connection stream",
                self.last_stream_id.get(),
                true,
            );
            return data.len();
        }
        // defer if (!isACK) this.sendSettingsACK();
        let send_ack_on_exit = !is_ack;

        let setting_byte_size = SettingsPayloadUnit::BYTE_SIZE;
        if frame.length > 0 {
            if is_ack || frame.length as usize % setting_byte_size != 0 {
                bun_output::scoped_log!(H2FrameParser, "invalid settings frame size");
                self.send_go_away(
                    frame.stream_identifier,
                    ErrorCode::FRAME_SIZE_ERROR,
                    b"Invalid settings frame size",
                    self.last_stream_id.get(),
                    true,
                );
                if send_ack_on_exit {
                    self.send_settings_ack();
                }
                return data.len();
            }
        } else {
            if is_ack {
                // we received an ACK
                bun_output::scoped_log!(H2FrameParser, "settings frame ACK");

                // we can now write any request
                if self.outstanding_settings.get() > 0 {
                    self.outstanding_settings
                        .set(self.outstanding_settings.get() - 1);

                    // Per RFC 7540 Section 6.9.2: When INITIAL_WINDOW_SIZE changes, adjust
                    // all existing stream windows by the difference.
                    if self.outstanding_settings.get() == 0
                        && self.local_settings.get().initial_window_size as u64
                            != DEFAULT_WINDOW_SIZE
                    {
                        let old_size: i64 = DEFAULT_WINDOW_SIZE as i64;
                        let new_size: i64 = self.local_settings.get().initial_window_size as i64;
                        let delta = new_size - old_size;
                        for (_, item) in self.streams.get().iter() {
                            // SAFETY: item is &*mut Stream from streams.iter(); the boxed Stream outlives the iteration
                            let stream = unsafe { &mut **item };
                            if delta >= 0 {
                                stream.window_size = stream
                                    .window_size
                                    .saturating_add(u64::try_from(delta).expect("int cast"));
                            } else {
                                stream.window_size = stream
                                    .window_size
                                    .saturating_sub(u64::try_from(-delta).expect("int cast"));
                            }
                        }
                        bun_output::scoped_log!(
                            H2FrameParser,
                            "adjusted stream windows by delta {} (old: {}, new: {})",
                            delta,
                            old_size,
                            new_size
                        );
                    }
                }

                let global = self.handlers.get().global();
                self.dispatch(
                    JSH2FrameParser::Gc::onLocalSettings,
                    self.local_settings.get().to_js(&global),
                );
            } else {
                bun_output::scoped_log!(
                    H2FrameParser,
                    "empty settings has remoteSettings? {}",
                    self.remote_settings.get().is_some()
                );
                if self.remote_settings.get().is_none() {
                    // ok empty settings so default settings
                    let remote_settings = FullSettingsPayload::default();
                    self.remote_settings.set(Some(remote_settings));
                    let _iws = remote_settings.initial_window_size;
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "remoteSettings.initialWindowSize: {} {} {}",
                        _iws,
                        self.remote_used_window_size.get(),
                        self.remote_window_size.get()
                    );

                    if remote_settings.initial_window_size as u64 >= self.remote_window_size.get() {
                        for (_, item) in self.streams.get().iter() {
                            // SAFETY: item is &*mut Stream from streams.iter(); the boxed Stream outlives the iteration
                            let stream = unsafe { &mut **item };
                            if remote_settings.initial_window_size as u64
                                >= stream.remote_window_size
                            {
                                stream.remote_window_size =
                                    remote_settings.initial_window_size as u64;
                            }
                        }
                    }
                    let global = self.handlers.get().global();
                    self.dispatch(
                        JSH2FrameParser::Gc::onRemoteSettings,
                        remote_settings.to_js(&global),
                    );
                }
                // defer chain (reverse order)
                self.increment_window_size_if_needed();
                let _ = self.flush();
            }

            self.current_frame.set(None);
            if send_ack_on_exit {
                self.send_settings_ack();
            }
            return 0;
        }
        if let Some(content) = self.handle_incomming_payload(data, frame.stream_identifier) {
            let mut remote_settings: FullSettingsPayload =
                self.remote_settings.get().unwrap_or_default();
            let mut i: usize = 0;
            let payload = content.data();
            let end = content.end;
            while i < payload.len() {
                let mut unit = SettingsPayloadUnit::default();
                SettingsPayloadUnit::from::<true>(&mut unit, &payload[i..i + setting_byte_size], 0);
                if SettingsType(unit.type_) == SettingsType::SETTINGS_MAX_FRAME_SIZE
                    && (unit.value < 16384 || unit.value > MAX_FRAME_SIZE)
                {
                    self.read_buffer.with_mut(|rb| rb.reset());
                    self.send_go_away(
                        frame.stream_identifier,
                        ErrorCode::PROTOCOL_ERROR,
                        b"Invalid SETTINGS_MAX_FRAME_SIZE",
                        self.last_stream_id.get(),
                        true,
                    );
                    return end;
                }
                remote_settings.update_with(unit);
                let (_ut, _uv) = (unit.type_, unit.value);
                bun_output::scoped_log!(
                    H2FrameParser,
                    "remoteSettings: {} {} isServer: {}",
                    _ut,
                    _uv,
                    self.is_server.get()
                );
                i += setting_byte_size;
            }
            self.read_buffer.with_mut(|rb| rb.reset());
            self.remote_settings.set(Some(remote_settings));
            let _iws = remote_settings.initial_window_size;
            bun_output::scoped_log!(
                H2FrameParser,
                "remoteSettings.initialWindowSize: {} {} {}",
                _iws,
                self.remote_used_window_size.get(),
                self.remote_window_size.get()
            );
            if remote_settings.initial_window_size as u64 >= self.remote_window_size.get() {
                for (_, item) in self.streams.get().iter() {
                    // SAFETY: item is &*mut Stream from streams.iter(); the boxed Stream outlives the iteration
                    let stream = unsafe { &mut **item };
                    if remote_settings.initial_window_size as u64 >= stream.remote_window_size {
                        stream.remote_window_size = remote_settings.initial_window_size as u64;
                    }
                }
            }
            let global = self.handlers.get().global();
            self.dispatch(
                JSH2FrameParser::Gc::onRemoteSettings,
                remote_settings.to_js(&global),
            );
            // defer chain
            self.increment_window_size_if_needed();
            let _ = self.flush();
            if send_ack_on_exit {
                self.send_settings_ack();
            }
            return end;
        }
        // needs more data
        if send_ack_on_exit {
            self.send_settings_ack();
        }
        data.len()
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
        if let Err(err) = callback.call(
            &global,
            ctx_value,
            &[ctx_value, JSValue::js_number(stream_identifier as f64)],
        ) {
            global.report_active_exception_as_unhandled(err);
        }
        Some(stream)
    }

    fn read_bytes(&self, bytes: &[u8]) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "read {}", bytes.len());
        if self.is_server.get() && self.preface_received_len.get() < 24 {
            // Handle Server Preface
            let preface_missing: usize = 24 - self.preface_received_len.get() as usize;
            let preface_available = preface_missing.min(bytes.len());
            let expected = &b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"[self.preface_received_len.get()
                as usize
                ..preface_available + self.preface_received_len.get() as usize];
            if bytes[0..preface_available] != *expected {
                // invalid preface
                bun_output::scoped_log!(H2FrameParser, "invalid preface");
                self.send_go_away(
                    0,
                    ErrorCode::PROTOCOL_ERROR,
                    b"Invalid preface",
                    self.last_stream_id.get(),
                    true,
                );
                return Ok(preface_available);
            }
            self.preface_received_len.set(
                self.preface_received_len.get()
                    + u8::try_from(preface_available).expect("int cast"),
            );
            return Ok(preface_available);
        }
        if let Some(header) = self.current_frame.get() {
            bun_output::scoped_log!(
                H2FrameParser,
                "current frame {} {} {} {} {}",
                if self.is_server.get() {
                    "server"
                } else {
                    "client"
                },
                header.type_,
                header.length,
                header.flags,
                header.stream_identifier
            );

            let stream = self.handle_received_stream_id(header.stream_identifier);
            return self.dispatch_frame(header, bytes, stream, 0);
        }

        // nothing to do
        if bytes.is_empty() {
            return Ok(bytes.len());
        }

        let buffered_data = self.read_buffer.get().list.len();

        // we can have less than 9 bytes buffered
        if buffered_data > 0 {
            let total = buffered_data + bytes.len();
            if total < FrameHeader::BYTE_SIZE {
                // buffer more data
                let _ = self.read_buffer.with_mut(|rb| rb.append_slice(bytes));
                self.global()
                    .vm()
                    .deprecated_report_extra_memory(bytes.len());
                return Ok(bytes.len());
            }
            // Zig writes the buffered prefix into the packed struct, then the
            // tail at `offset = buffered_data`, then byte-swaps. Reassemble the
            // 9 wire bytes on the stack and decode in one shot — same result,
            // no shared scratch state.
            let needed = FrameHeader::BYTE_SIZE - buffered_data;
            let mut raw = [0u8; FrameHeader::BYTE_SIZE];
            raw[..buffered_data].copy_from_slice(&self.read_buffer.get().list[..buffered_data]);
            raw[buffered_data..].copy_from_slice(&bytes[..needed]);
            let mut header = FrameHeader::decode(&raw);
            // ignore the reserved bit
            let id = UInt31WithReserved::from(header.stream_identifier);
            header.stream_identifier = id.uint31();
            // reset for later use
            self.read_buffer.with_mut(|rb| rb.reset());

            self.current_frame.set(Some(header));
            self.remaining_length.set(header.length as i32);
            bun_output::scoped_log!(
                H2FrameParser,
                "new frame {} {} {} {}",
                header.type_,
                header.length,
                header.flags,
                header.stream_identifier
            );
            let stream = self.handle_received_stream_id(header.stream_identifier);

            return self.dispatch_frame(header, &bytes[needed..], stream, needed);
        }

        if bytes.len() < FrameHeader::BYTE_SIZE {
            // buffer more dheaderata
            let _ = self.read_buffer.with_mut(|rb| rb.append_slice(bytes));
            self.global()
                .vm()
                .deprecated_report_extra_memory(bytes.len());
            return Ok(bytes.len());
        }

        let header = FrameHeader::decode(
            bytes[..FrameHeader::BYTE_SIZE]
                .try_into()
                .expect("infallible: size matches"),
        );

        bun_output::scoped_log!(
            H2FrameParser,
            "new frame {} {} {} {} {}",
            if self.is_server.get() {
                "server"
            } else {
                "client"
            },
            header.type_,
            header.length,
            header.flags,
            header.stream_identifier
        );
        self.current_frame.set(Some(header));
        self.remaining_length.set(header.length as i32);
        let stream = self.handle_received_stream_id(header.stream_identifier);
        self.dispatch_frame(
            header,
            &bytes[FrameHeader::BYTE_SIZE..],
            stream,
            FrameHeader::BYTE_SIZE,
        )
    }

    // PORT NOTE: hoisted from three identical switch blocks in read_bytes for borrowck/DRY.
    // The `add` parameter is the number of bytes already consumed before `bytes` (0, `needed`, or BYTE_SIZE).
    fn dispatch_frame(
        &self,
        header: FrameHeader,
        bytes: &[u8],
        stream: Option<*mut Stream>,
        add: usize,
    ) -> JsResult<usize> {
        Ok(match header.type_ {
            x if x == FrameType::HTTP_FRAME_SETTINGS as u8 => {
                self.handle_settings_frame(header, bytes) + add
            }
            x if x == FrameType::HTTP_FRAME_WINDOW_UPDATE as u8 => {
                self.handle_window_update_frame(header, bytes, stream) + add
            }
            x if x == FrameType::HTTP_FRAME_HEADERS as u8 => {
                self.handle_headers_frame(header, bytes, stream)? + add
            }
            x if x == FrameType::HTTP_FRAME_DATA as u8 => {
                self.handle_data_frame(header, bytes, stream) + add
            }
            x if x == FrameType::HTTP_FRAME_CONTINUATION as u8 => {
                self.handle_continuation_frame(header, bytes, stream)? + add
            }
            x if x == FrameType::HTTP_FRAME_PRIORITY as u8 => {
                self.handle_priority_frame(header, bytes, stream) + add
            }
            x if x == FrameType::HTTP_FRAME_PING as u8 => {
                self.handle_ping_frame(header, bytes, stream) + add
            }
            x if x == FrameType::HTTP_FRAME_GOAWAY as u8 => {
                self.handle_go_away_frame(header, bytes, stream) + add
            }
            x if x == FrameType::HTTP_FRAME_RST_STREAM as u8 => {
                self.handle_rst_stream_frame(header, bytes, stream) + add
            }
            x if x == FrameType::HTTP_FRAME_ALTSVC as u8 => {
                self.handle_altsvc_frame(header, bytes, stream)? + add
            }
            x if x == FrameType::HTTP_FRAME_ORIGIN as u8 => {
                self.handle_origin_frame(header, bytes, stream)? + add
            }
            _ => {
                self.send_go_away(
                    header.stream_identifier,
                    ErrorCode::PROTOCOL_ERROR,
                    b"Unknown frame type",
                    self.last_stream_id.get(),
                    true,
                );
                bytes.len() + add
            }
        })
    }

    fn to_writer(&self) -> DirectWriterStruct {
        DirectWriterStruct {
            writer: bun_ptr::BackRef::new(self),
        }
    }
}

// PORT NOTE: holds a `BackRef<H2FrameParser>` so the borrow of the parser ends
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
            Err(bun_core::err!("SocketClosed"))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — JS host fns (part 1)
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    #[bun_jsc::host_fn(method)]
    pub fn set_encoding(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected encoding argument")));
        }
        let bt = match BinaryType::from_js_value(global_object, args_list.ptr[0])? {
            Some(bt) => bt,
            None => {
                let err = global_object.to_invalid_arguments(format_args!(
                    "Expected 'binaryType' to be 'arraybuffer', 'uint8array', 'buffer'"
                ));
                return Err(global_object.throw_value(err));
            }
        };
        this.handlers.with_mut(|h| h.binary_type = bt);
        Ok(JSValue::UNDEFINED)
    }

    pub fn load_settings_from_js_value(
        &self,
        global_object: &JSGlobalObject,
        options: JSValue,
    ) -> JsResult<()> {
        if options.is_empty_or_undefined_or_null() || !options.is_object() {
            return Err(global_object.throw(format_args!("Expected settings to be a object")));
        }

        // R-2: read-modify-write the `Cell<FullSettingsPayload>` via a local copy.
        let mut local_settings = self.local_settings.get();

        macro_rules! number_setting {
            ($key:literal, $field:ident, $min:expr, $max:expr, $err:literal) => {{
                if let Some(v) = options.get(global_object, $key)? {
                    if v.is_number() {
                        let value = v.as_number();
                        if value < ($min as f64) || value > $max {
                            return global_object
                                .err_http2_invalid_setting_value_range_error($err)
                                .throw();
                        }
                        local_settings.$field = value as u32;
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
            0,
            MAX_HEADER_TABLE_SIZE_F64,
            "Expected headerTableSize to be a number between 0 and 2^32-1"
        );

        if let Some(enable_push) = options.get(global_object, "enablePush")? {
            if enable_push.is_boolean() {
                local_settings.enable_push = if enable_push.as_boolean() { 1 } else { 0 };
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
            16384,
            MAX_FRAME_SIZE_F64,
            "Expected maxFrameSize to be a number between 16,384 and 2^24-1"
        );
        number_setting!(
            "maxConcurrentStreams",
            max_concurrent_streams,
            0,
            MAX_HEADER_TABLE_SIZE_F64,
            "Expected maxConcurrentStreams to be a number between 0 and 2^32-1"
        );
        number_setting!(
            "maxHeaderListSize",
            max_header_list_size,
            0,
            MAX_HEADER_TABLE_SIZE_F64,
            "Expected maxHeaderListSize to be a number between 0 and 2^32-1"
        );
        number_setting!(
            "maxHeaderSize",
            max_header_list_size,
            0,
            MAX_HEADER_TABLE_SIZE_F64,
            "Expected maxHeaderSize to be a number between 0 and 2^32-1"
        );

        self.local_settings.set(local_settings);

        // Validate customSettings
        if let Some(custom_settings) = options.get(global_object, "customSettings")? {
            if !custom_settings.is_undefined() {
                let Some(custom_settings_obj) = custom_settings.get_object() else {
                    return global_object
                        .err_http2_invalid_setting_value("Expected customSettings to be an object")
                        .throw();
                };

                let mut count: usize = 0;
                let mut iter = bun_jsc::JSPropertyIterator::init(
                    global_object,
                    custom_settings_obj,
                    bun_jsc::JSPropertyIteratorOptions {
                        skip_empty_name: false,
                        include_value: true,
                        ..Default::default()
                    },
                )?;

                while let Some(prop_name) = iter.next()? {
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
                    // Parse bytes directly (ASCII decimal) — Zig: std.fmt.parseInt(u32, slice, 10).
                    // Do not insert UTF-8 validation on external data per PORTING.md §Strings.
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
                    let setting_value = iter.value;
                    if setting_value.is_number() {
                        let value = setting_value.as_number();
                        if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                            return global_object
                                .err_http2_invalid_setting_value_range_error(
                                    "Invalid custom setting value",
                                )
                                .throw();
                        }
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
        Ok(())
    }

    #[bun_jsc::host_fn(method)]
    pub fn update_settings(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected settings argument")));
        }

        let options = args_list.ptr[0];

        this.load_settings_from_js_value(global_object, options)?;

        Ok(JSValue::from(this.set_settings(this.local_settings.get())))
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_local_window_size(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(
                global_object.throw_invalid_arguments(format_args!("Expected windowSize argument"))
            );
        }
        let window_size = args_list.ptr[0];
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
    pub fn get_current_state(
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
    pub fn goaway(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<3>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected errorCode argument")));
        }

        let error_code_arg = args_list.ptr[0];

        if !error_code_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected errorCode to be a number")));
        }
        let error_code = error_code_arg.to_int32();
        if error_code < 1 && error_code > 13 {
            return Err(global_object.throw(format_args!("invalid errorCode")));
        }

        let mut last_stream_id = this.last_stream_id.get();
        if args_list.len >= 2 {
            let last_stream_arg = args_list.ptr[1];
            if !last_stream_arg.is_empty_or_undefined_or_null() {
                if !last_stream_arg.is_number() {
                    return Err(
                        global_object.throw(format_args!("Expected lastStreamId to be a number"))
                    );
                }
                let id = last_stream_arg.to_int32();
                if id < 0 && id as u32 > MAX_STREAM_ID {
                    return Err(global_object.throw(format_args!(
                        "Expected lastStreamId to be a number between 1 and 2147483647"
                    )));
                }
                last_stream_id = u32::try_from(id).expect("int cast");
            }
            if args_list.len >= 3 {
                let opaque_data_arg = args_list.ptr[2];
                if !opaque_data_arg.is_empty_or_undefined_or_null() {
                    if let Some(array_buffer) = opaque_data_arg.as_array_buffer(global_object) {
                        let slice = array_buffer.byte_slice();
                        this.send_go_away(
                            0,
                            ErrorCode(error_code as u32),
                            slice,
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
    pub fn ping(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected payload argument")));
        }

        if this.out_standing_pings.get() >= this.max_outstanding_pings.get() {
            let exception = global_object.to_type_error(
                bun_jsc::ErrorCode::HTTP2_PING_CANCEL,
                format_args!("HTTP2 ping cancelled"),
            );
            return Err(global_object.throw_value(exception));
        }

        if let Some(array_buffer) = args_list.ptr[0].as_array_buffer(global_object) {
            let slice = array_buffer.slice();
            this.send_ping(false, slice);
            return Ok(JSValue::UNDEFINED);
        }

        Err(global_object.throw(format_args!("Expected payload to be a Buffer")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn origin(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let origin_arg = callframe.argument(0);
        if origin_arg.is_empty_or_undefined_or_null() {
            // empty origin frame
            let mut buffer = [0u8; FrameHeader::BYTE_SIZE];
            let mut stream = FixedBufferStream::new(&mut buffer);

            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_ORIGIN as u8,
                flags: 0,
                stream_identifier: 0,
                length: 0,
            };
            let _ = frame.write(&mut stream);
            let _ = this.write(&buffer);
            return Ok(JSValue::UNDEFINED);
        }

        if origin_arg.is_string() {
            let origin_string = origin_arg.to_slice(global_object)?;
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

            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_ORIGIN as u8,
                flags: 0,
                stream_identifier: 0,
                length: u32::try_from(slice.len() + 2).expect("int cast"),
            };
            let _ = frame.write(&mut stream);
            let _ = stream.write_all(&u16::try_from(slice.len()).expect("int cast").to_be_bytes());
            let _ = this.write(&buffer);
            if !slice.is_empty() {
                let _ = this.write(slice);
            }
        } else if origin_arg.is_array() {
            let mut buffer = vec![0u8; FrameHeader::BYTE_SIZE + 16384];
            // PERF(port): was stack array [FrameHeader.byteSize + 16384]u8 — heap to avoid 16K stack frame
            let mut stream = FixedBufferStream::new(&mut buffer);
            stream.seek_to(FrameHeader::BYTE_SIZE);
            let mut value_iter = origin_arg.array_iterator(global_object)?;

            while let Some(item) = value_iter.next()? {
                if !item.is_string() {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "Expected origin to be a string or an array of strings"
                    )));
                }
                let origin_string = item.to_slice(global_object)?;
                let slice = origin_string.slice();
                if stream
                    .write_all(&u16::try_from(slice.len()).expect("int cast").to_be_bytes())
                    .is_err()
                {
                    let exception = global_object.to_type_error(
                        bun_jsc::ErrorCode::HTTP2_ORIGIN_LENGTH,
                        format_args!("HTTP/2 ORIGIN frames are limited to 16382 bytes"),
                    );
                    return Err(global_object.throw_value(exception));
                }

                if stream.write_all(slice).is_err() {
                    let exception = global_object.to_type_error(
                        bun_jsc::ErrorCode::HTTP2_ORIGIN_LENGTH,
                        format_args!("HTTP/2 ORIGIN frames are limited to 16382 bytes"),
                    );
                    return Err(global_object.throw_value(exception));
                }
            }

            let total_length: u32 = u32::try_from(stream.pos).expect("int cast");
            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_ORIGIN as u8,
                flags: 0,
                stream_identifier: 0,
                length: total_length - FrameHeader::BYTE_SIZE as u32, // payload length
            };
            stream.reset();
            let _ = frame.write(&mut stream);
            let _ = this.write(&buffer[0..total_length as usize]);
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn altsvc(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut origin_slice: Option<bun_core::zig_string::Slice> = None;
        let mut value_slice: Option<bun_core::zig_string::Slice> = None;

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
            origin_slice = Some(origin_string.to_slice(global_object)?);
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
            value_slice = Some(value_string.to_slice(global_object)?);
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
    pub fn get_end_after_headers(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected stream argument")));
        }
        let stream_arg = args_list.ptr[0];

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
    pub fn is_stream_aborted(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected stream argument")));
        }
        let stream_arg = args_list.ptr[0];

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
    pub fn get_stream_state(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected stream argument")));
        }
        let stream_arg = args_list.ptr[0];

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
    pub fn set_stream_priority(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<2>();
        if args_list.len < 2 {
            return Err(global_object.throw(format_args!("Expected stream and options arguments")));
        }
        let stream_arg = args_list.ptr[0];
        let options = args_list.ptr[1];

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
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let stream = unsafe { &mut *stream_ptr };

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

            let mut priority = StreamPriority {
                stream_identifier: stream_identifier.to_uint32(),
                weight: stream.weight as u8,
            };
            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_PRIORITY as u8,
                flags: 0,
                stream_identifier: stream.id,
                length: StreamPriority::BYTE_SIZE as u32,
            };

            let mut writer = this.to_writer();
            let _ = frame.write(&mut writer);
            let _ = priority.write(&mut writer);
        }
        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn rst_stream(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(H2FrameParser, "rstStream");
        let args_list = callframe.arguments_old::<2>();
        if args_list.len < 2 {
            return Err(global_object.throw(format_args!("Expected stream and code arguments")));
        }
        let stream_arg = args_list.ptr[0];
        let error_arg = args_list.ptr[1];

        if !stream_arg.is_number() {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        }

        let Some(stream) = this.streams.get().get(&stream_id).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };
        if !error_arg.is_number() {
            return Err(global_object.throw(format_args!("Invalid ErrorCode")));
        }

        let error_code = error_arg.to_u32();

        // SAFETY: stream is a *mut Stream from self.streams; valid while the map entry exists
        this.end_stream(unsafe { &mut *stream }, ErrorCode(error_code));

        Ok(JSValue::TRUE)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — JS host fns (part 2)
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    // get memory usage in MB
    fn get_session_memory_usage(&self) -> usize {
        (self.write_buffer.get().len_u32() as usize + self.queued_data_size.get() as usize)
            / 1024
            / 1024
    }

    // get memory in bytes
    #[bun_jsc::host_fn(method)]
    pub fn get_buffer_size(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            (this.write_buffer.get().len_u32() as u64 + this.queued_data_size.get()) as f64,
        ))
    }

    fn send_data(&self, stream: &mut Stream, payload: &[u8], close: bool, callback: JSValue) {
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
        self.ref_();

        let can_close = close && !stream.wait_for_trailers;
        if payload.is_empty() {
            // empty payload we still need to send a frame
            let mut data_header = FrameHeader {
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
                let _ = data_header.write(&mut writer);
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
                    let mut flags: u8 = if end_stream {
                        DataFrameFlags::END_STREAM as u8
                    } else {
                        0
                    };
                    if padding != 0 {
                        flags |= DataFrameFlags::PADDED as u8;
                    }
                    let mut data_header = FrameHeader {
                        type_: FrameType::HTTP_FRAME_DATA as u8,
                        flags,
                        stream_identifier: stream_id,
                        length: u32::try_from(payload_size).expect("int cast"),
                    };
                    let mut writer = self.to_writer();
                    let _ = data_header.write(&mut writer);
                    if padding != 0 {
                        SHARED_REQUEST_BUFFER.with_borrow_mut(|buffer| {
                            // SAFETY: src/dst may overlap — ptr::copy is memmove; dst capacity covers payload_size
                            unsafe {
                                core::ptr::copy(
                                    slice.as_ptr(),
                                    buffer.as_mut_ptr().add(1),
                                    slice.len(),
                                );
                            }
                            buffer[0] = padding;
                            let _ = writer.write_all(&buffer[0..payload_size]);
                        });
                    } else {
                        let _ = writer.write_all(slice);
                    }
                }
            }
        }

        // defer block from Zig
        if !enqueued {
            self.dispatch_write_callback(callback);
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
                    self.dispatch_with_extra(
                        JSH2FrameParser::Gc::onStreamEnd,
                        identifier,
                        JSValue::js_number(stream.state as u8 as f64),
                    );
                }
            }
        }
        self.deref();
    }

    #[bun_jsc::host_fn(method)]
    pub fn no_trailers(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!(
                "Expected stream, headers and sensitiveHeaders arguments"
            )));
        }

        let stream_arg = args_list.ptr[0];

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
        this.send_data(stream, b"", true, JSValue::UNDEFINED);
        Ok(JSValue::UNDEFINED)
    }

    /// validate header name and convert to lowecase if needed
    fn to_valid_header_name<'a>(
        in_: &'a [u8],
        out: &'a mut [u8],
    ) -> Result<&'a [u8], bun_core::Error> {
        if in_.len() > 4096 {
            return Err(bun_core::err!("InvalidHeaderName"));
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
                            return Err(bun_core::err!("InvalidHeaderName"));
                        }
                        continue;
                    }
                    _ => return Err(bun_core::err!("InvalidHeaderName")),
                }
            }

            if any {
                out_slice[..in_slice.len()].copy_from_slice(in_slice);
            }
            break 'begin;
        }

        Ok(if any { &out[0..in_.len()] } else { in_ })
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_trailers(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<3>();
        if args_list.len < 3 {
            return Err(global_object.throw(format_args!(
                "Expected stream, headers and sensitiveHeaders arguments"
            )));
        }

        let stream_arg = args_list.ptr[0];
        let headers_arg = args_list.ptr[1];
        let sensitive_arg = args_list.ptr[2];

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
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let stream = unsafe { &mut *stream_ptr };

        let Some(headers_obj) = headers_arg.get_object() else {
            return Err(global_object.throw(format_args!("Expected headers to be an object")));
        };

        if !sensitive_arg.is_object() {
            return Err(
                global_object.throw(format_args!("Expected sensitiveHeaders to be an object"))
            );
        }

        // PERF(port): was BufferFallbackAllocator over shared_request_buffer — using plain Vec
        let mut encoded_headers: Vec<u8> = Vec::new();
        if encoded_headers.try_reserve(16384).is_err() {
            return Err(global_object.throw(format_args!("Failed to allocate header buffer")));
        }
        // max header name length for lshpack
        let mut name_buffer = [0u8; 4096];

        let mut iter = bun_jsc::JSPropertyIterator::init(
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
        while let Some(header_name) = iter.next()? {
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

            let js_value = iter.value;
            if js_value.is_undefined_or_null() {
                let exception = global_object.to_type_error(
                    bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE,
                    format_args!("Invalid value for header \"{}\"", BStr::new(name)),
                );
                return Err(global_object.throw_value(exception));
            }
            let validated_name =
                match Self::to_valid_header_name(name, &mut name_buffer[0..name.len()]) {
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
            let mut handle_encode =
                |this: &Self, value: &[u8], never_index: bool| -> JsResult<Option<JSValue>> {
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
                        Err(err) if err == bun_core::err!("OutOfMemory") => {
                            Err(global_object
                                .throw(format_args!("Failed to allocate header buffer")))
                        }
                        Err(_) => {
                            stream.state = StreamState::CLOSED;
                            let identifier = stream.get_identifier();
                            identifier.ensure_still_alive();
                            stream.free_resources::<false>(this);
                            stream.rst_code = ErrorCode::FRAME_SIZE_ERROR.0;
                            this.dispatch_with_2_extra(
                                JSH2FrameParser::Gc::onFrameError,
                                identifier,
                                JSValue::js_number(FrameType::HTTP_FRAME_HEADERS as u8 as f64),
                                JSValue::js_number(ErrorCode::FRAME_SIZE_ERROR.0 as f64),
                            );
                            this.dispatch_with_extra(
                                JSH2FrameParser::Gc::onStreamError,
                                identifier,
                                JSValue::js_number(stream.rst_code as f64),
                            );
                            Ok(Some(JSValue::UNDEFINED))
                        }
                    }
                };

            if js_value.js_type().is_array() {
                let mut value_iter = js_value.array_iterator(global_object)?;

                if let Some(idx) = single_value_headers_index_of(validated_name) {
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

                    let value_str = match item.to_js_string(global_object) {
                        Ok(s) => s,
                        Err(_) => {
                            global_object.clear_exception();
                            let exception = global_object.to_type_error(
                                bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE,
                                format_args!(
                                    "Invalid value for header \"{}\"",
                                    BStr::new(validated_name)
                                ),
                            );
                            return Err(global_object.throw_value(exception));
                        }
                    };

                    let never_index =
                        match sensitive_arg.get_truthy(global_object, validated_name)? {
                            Some(_) => true,
                            None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                        };

                    let value_slice = value_str.to_slice(global_object);
                    let value = value_slice.slice();

                    if let Some(ret) = handle_encode(this, value, never_index)? {
                        return Ok(ret);
                    }
                }
            } else {
                if let Some(idx) = single_value_headers_index_of(validated_name) {
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
                let value_str = match js_value.to_js_string(global_object) {
                    Ok(s) => s,
                    Err(_) => {
                        global_object.clear_exception();
                        let exception = global_object.to_type_error(
                            bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE,
                            format_args!(
                                "Invalid value for header \"{}\"",
                                BStr::new(validated_name)
                            ),
                        );
                        return Err(global_object.throw_value(exception));
                    }
                };

                let never_index = match sensitive_arg.get_truthy(global_object, validated_name)? {
                    Some(_) => true,
                    None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                };

                let value_slice = value_str.to_slice(global_object);
                let value = value_slice.slice();
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
            .unwrap_or(this.local_settings.get())
            .max_frame_size as usize;

        bun_output::scoped_log!(H2FrameParser, "trailers encoded_size {}", encoded_size);

        let mut writer = this.to_writer();

        if encoded_size <= actual_max_frame_size {
            // Single HEADERS frame - header block fits in one frame
            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags: base_flags | HeadersFrameFlags::END_HEADERS as u8,
                stream_identifier: stream.id,
                length: u32::try_from(encoded_size).expect("int cast"),
            };
            let _ = frame.write(&mut writer);
            let _ = writer.write_all(encoded_data);
        } else {
            bun_output::scoped_log!(
                H2FrameParser,
                "Using CONTINUATION frames for trailers: encoded_size={} max_frame_size={}",
                encoded_size,
                actual_max_frame_size
            );

            let first_chunk_size = actual_max_frame_size;

            let mut headers_frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags: base_flags, // END_STREAM but NOT END_HEADERS
                stream_identifier: stream.id,
                length: u32::try_from(first_chunk_size).expect("int cast"),
            };
            let _ = headers_frame.write(&mut writer);
            let _ = writer.write_all(&encoded_data[0..first_chunk_size]);

            let mut offset: usize = first_chunk_size;
            while offset < encoded_size {
                let remaining = encoded_size - offset;
                let chunk_size = remaining.min(actual_max_frame_size);
                let is_last = offset + chunk_size >= encoded_size;

                let mut cont_frame = FrameHeader {
                    type_: FrameType::HTTP_FRAME_CONTINUATION as u8,
                    flags: if is_last {
                        HeadersFrameFlags::END_HEADERS as u8
                    } else {
                        0
                    },
                    stream_identifier: stream.id,
                    length: u32::try_from(chunk_size).expect("int cast"),
                };
                let _ = cont_frame.write(&mut writer);
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
    pub fn write_stream(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_undef::<5>();
        let [stream_arg, data_arg, encoding_arg, close_arg, callback_arg] = args.ptr;

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
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let stream = unsafe { &mut *stream_ptr };
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

        this.send_data(stream, buffer.slice(), close, callback_arg);

        Ok(JSValue::TRUE)
    }

    fn get_next_stream_id(&self) -> u32 {
        let mut stream_id: u32 = self.last_stream_id.get();
        if self.is_server.get() {
            if stream_id % 2 == 0 {
                stream_id += 2;
            } else {
                stream_id += 1;
            }
        } else {
            if stream_id % 2 == 0 {
                stream_id += 1;
            } else if stream_id == 0 {
                stream_id = 1;
            } else {
                stream_id += 2;
            }
        }
        stream_id
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_next_stream_id(
        this: &Self,
        _global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments();
        debug_assert!(args_list.len() >= 1);
        let stream_id_arg = args_list[0];
        debug_assert!(stream_id_arg.is_number());
        let mut last_stream_id = stream_id_arg.to_u32();
        if this.is_server.get() {
            if last_stream_id % 2 == 0 {
                last_stream_id -= 2;
            } else {
                last_stream_id -= 1;
            }
        } else {
            if last_stream_id % 2 == 0 {
                last_stream_id -= 1;
            } else if last_stream_id == 1 {
                last_stream_id = 0;
            } else {
                last_stream_id -= 2;
            }
        }
        this.last_stream_id.set(last_stream_id);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn has_native_read(
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
    pub fn get_next_stream(
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

    #[bun_jsc::host_fn(method)]
    pub fn get_stream_context(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected stream_id argument")));
        }

        let stream_id_arg = args_list.ptr[0];
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
    pub fn set_stream_context(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<2>();
        if args_list.len < 2 {
            return Err(
                global_object.throw(format_args!("Expected stream_id and context arguments"))
            );
        }

        let stream_id_arg = args_list.ptr[0];
        if !stream_id_arg.is_number() {
            return Err(global_object.throw(format_args!("Expected stream_id to be a number")));
        }
        let Some(stream) = this.streams.get().get(&stream_id_arg.to_u32()).copied() else {
            return Err(global_object.throw(format_args!("Invalid stream id")));
        };
        let context_arg = args_list.ptr[1];
        if !context_arg.is_object() {
            return Err(global_object.throw(format_args!("Expected context to be an object")));
        }

        // SAFETY: stream is *mut Stream from self.streams; valid while the map entry exists
        unsafe { (*stream).set_context(context_arg, global_object) };
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn for_each_stream(
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
    pub fn emit_abort_to_all_streams(
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
    pub fn emit_error_to_all_streams(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected error argument")));
        }

        // R-2: StreamResumableIterator stores a `ParentRef`; `streams` is `JsCell`-backed,
        // so the loop body can keep using `this` (`&Self`) directly.
        let mut it = StreamResumableIterator::init(this);
        while let Some(stream_ptr) = it.next() {
            // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for
            // the lifetime of the entry. Separate heap allocation from `this`, so no aliasing.
            let stream = unsafe { &mut *stream_ptr };
            if stream.state != StreamState::CLOSED {
                stream.state = StreamState::CLOSED;
                stream.rst_code = args_list.ptr[0].to_u32();
                let identifier = stream.get_identifier();
                identifier.ensure_still_alive();
                stream.free_resources::<false>(this);
                this.dispatch_with_extra(
                    JSH2FrameParser::Gc::onStreamError,
                    identifier,
                    args_list.ptr[0],
                );
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn flush_from_js(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::js_number(this.flush() as f64))
    }

    #[bun_jsc::host_fn(method)]
    pub fn request(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(H2FrameParser, "request");

        let args_list = callframe.arguments_old::<5>();
        if args_list.len < 4 {
            return Err(global_object.throw(format_args!(
                "Expected stream_id, stream_ctx, headers and sensitiveHeaders arguments"
            )));
        }

        let stream_id_arg = args_list.ptr[0];
        let stream_ctx_arg = args_list.ptr[1];
        let headers_arg = args_list.ptr[2];
        let sensitive_arg = args_list.ptr[3];

        let Some(headers_obj) = headers_arg.get_object() else {
            return Err(global_object.throw(format_args!("Expected headers to be an object")));
        };

        if !sensitive_arg.is_object() {
            return Err(
                global_object.throw(format_args!("Expected sensitiveHeaders to be an object"))
            );
        }
        // PERF(port): was BufferFallbackAllocator over shared_request_buffer — using plain Vec
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

        for ignore_pseudo_headers in 0..2usize {
            // PORT NOTE: `bun_jsc::JSPropertyIterator` (runtime-options variant) lacks `.reset()`;
            // re-initialize per pass instead — same observable property walk as the Zig two-pass loop.
            let mut iter = bun_jsc::JSPropertyIterator::init(
                global_object,
                headers_obj,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                    ..Default::default()
                },
            )?;

            while let Some(header_name) = iter.next()? {
                if header_name.length() == 0 {
                    continue;
                }

                let name_slice = header_name.to_utf8();
                let name = name_slice.slice();

                let validated_name =
                    match Self::to_valid_header_name(name, &mut name_buffer[0..name.len()]) {
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
                            if !global_object.has_exception() {
                                return Err(global_object.err(JscErrorCode::HTTP2_INVALID_PSEUDOHEADER, format_args!("\"{}\" is an invalid pseudoheader or is used incorrectly", BStr::new(name))).throw());
                            }
                            return Ok(JSValue::ZERO);
                        }
                    } else {
                        if !is_valid_request_pseudo_header(validated_name) {
                            if !global_object.has_exception() {
                                return Err(global_object.err(JscErrorCode::HTTP2_INVALID_PSEUDOHEADER, format_args!("\"{}\" is an invalid pseudoheader or is used incorrectly", BStr::new(name))).throw());
                            }
                            return Ok(JSValue::ZERO);
                        }
                    }
                } else if ignore_pseudo_headers == 0 {
                    continue;
                }

                let js_value = iter.value;
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

                    if let Some(idx) = single_value_headers_index_of(validated_name) {
                        if value_iter.len > 1 || single_value_headers[idx] {
                            if !global_object.has_exception() {
                                let exception = global_object.to_type_error(
                                    bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE,
                                    format_args!(
                                        "Header field \"{}\" must only have a single value",
                                        BStr::new(validated_name)
                                    ),
                                );
                                return Err(global_object.throw_value(exception));
                            }
                            return Ok(JSValue::ZERO);
                        }
                        single_value_headers[idx] = true;
                    }

                    while let Some(item) = value_iter.next()? {
                        if item.is_empty_or_undefined_or_null() {
                            if !global_object.has_exception() {
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
                            return Ok(JSValue::ZERO);
                        }

                        let value_str = match item.to_js_string(global_object) {
                            Ok(s) => s,
                            Err(_) => {
                                global_object.clear_exception();
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
                        };

                        let never_index =
                            match sensitive_arg.get_truthy(global_object, validated_name)? {
                                Some(_) => true,
                                None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                            };

                        let value_slice = value_str.to_slice(global_object);
                        let value = value_slice.slice();
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
                            if err == bun_core::err!("OutOfMemory") {
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
                            stream.state = StreamState::CLOSED;
                            stream.rst_code = ErrorCode::COMPRESSION_ERROR.0;
                            this.dispatch_with_extra(
                                JSH2FrameParser::Gc::onStreamError,
                                stream.get_identifier(),
                                JSValue::js_number(stream.rst_code as f64),
                            );
                            return Ok(JSValue::UNDEFINED);
                        }
                    }
                } else if !js_value.is_empty_or_undefined_or_null() {
                    bun_output::scoped_log!(H2FrameParser, "single header {}", BStr::new(name));
                    if let Some(idx) = single_value_headers_index_of(validated_name) {
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
                    let value_str = match js_value.to_js_string(global_object) {
                        Ok(s) => s,
                        Err(_) => {
                            global_object.clear_exception();
                            return Err(global_object
                                .err(
                                    JscErrorCode::HTTP2_INVALID_HEADER_VALUE,
                                    format_args!(
                                        "Invalid value for header \"{}\"",
                                        BStr::new(name)
                                    ),
                                )
                                .throw());
                        }
                    };

                    let never_index =
                        match sensitive_arg.get_truthy(global_object, validated_name)? {
                            Some(_) => true,
                            None => sensitive_arg.get_truthy(global_object, name)?.is_some(),
                        };

                    let value_slice = value_str.to_slice(global_object);
                    let value = value_slice.slice();
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
                        if err == bun_core::err!("OutOfMemory") {
                            return Err(global_object
                                .throw(format_args!("Failed to allocate header buffer")));
                        }
                        let Some(stream) = this.handle_received_stream_id(stream_id) else {
                            return Ok(JSValue::js_number(-1.0));
                        };
                        // SAFETY: stream is a *mut Stream from self.streams (heap::alloc); valid while the map entry exists
                        let stream = unsafe { &mut *stream };
                        stream.state = StreamState::CLOSED;
                        if !stream_ctx_arg.is_empty_or_undefined_or_null()
                            && stream_ctx_arg.is_object()
                        {
                            stream.set_context(stream_ctx_arg, global_object);
                        }
                        stream.rst_code = ErrorCode::COMPRESSION_ERROR.0;
                        this.dispatch_with_extra(
                            JSH2FrameParser::Gc::onStreamError,
                            stream.get_identifier(),
                            JSValue::js_number(stream.rst_code as f64),
                        );
                        return Ok(JSValue::js_number(stream_id as f64));
                    }
                }
            }
        }
        let encoded_size = encoded_headers.len();

        let Some(stream_ptr) = this.handle_received_stream_id(stream_id) else {
            return Ok(JSValue::js_number(-1.0));
        };
        // SAFETY: stream_ptr is a *mut Stream stored in self.streams (heap::alloc); valid for the lifetime of the entry, exclusive access reshaped for borrowck
        let stream = unsafe { &mut *stream_ptr };
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
        if args_list.len > 4 && !args_list.ptr[4].is_empty_or_undefined_or_null() {
            let options = args_list.ptr[4];
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
                        let wrapped = Bun__wrapAbortError(global_object, signal_.abort_reason());
                        this.abort_stream(stream, wrapped);
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
        if this.get_session_memory_usage() > this.max_session_memory.get() as usize {
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
            .unwrap_or(this.local_settings.get())
            .max_frame_size as usize;
        let priority_overhead: usize = if has_priority {
            StreamPriority::BYTE_SIZE
        } else {
            0
        };
        let available_payload = actual_max_frame_size - priority_overhead;
        let padding: u8 = if encoded_size > available_payload {
            0
        } else {
            stream.get_padding(encoded_size, available_payload)
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
            }

            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags,
                stream_identifier: stream.id,
                length: u32::try_from(payload_size).expect("int cast"),
            };
            let _ = frame.write(&mut writer);

            // Write priority data if present
            if has_priority {
                let stream_identifier =
                    UInt31WithReserved::init(u32::try_from(parent).expect("int cast"), exclusive);
                let mut priority_data = StreamPriority {
                    stream_identifier: stream_identifier.to_uint32(),
                    weight: u8::try_from(weight).expect("int cast"),
                };
                let _ = priority_data.write(&mut writer);
            }

            // Handle padding
            if padding != 0 {
                if encoded_headers
                    .try_reserve(encoded_size + padding_overhead - encoded_headers.len())
                    .is_err()
                {
                    return Err(
                        global_object.throw(format_args!("Failed to allocate padding buffer"))
                    );
                }
                // Zero-fill the padding region (RFC 7540 §6.2: padding octets MUST be zero) and
                // ensure the slice we hand to writer covers only initialized bytes.
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

            let mut headers_frame = FrameHeader {
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
            let _ = headers_frame.write(&mut writer);

            if has_priority {
                let stream_identifier =
                    UInt31WithReserved::init(u32::try_from(parent).expect("int cast"), exclusive);
                let mut priority_data = StreamPriority {
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

                let mut cont_frame = FrameHeader {
                    type_: FrameType::HTTP_FRAME_CONTINUATION as u8,
                    flags: if is_last {
                        HeadersFrameFlags::END_HEADERS as u8
                    } else {
                        0
                    },
                    stream_identifier: stream.id,
                    length: u32::try_from(chunk_size).expect("int cast"),
                };
                let _ = cont_frame.write(&mut writer);
                let _ = writer.write_all(&encoded_headers[offset..offset + chunk_size]);

                offset += chunk_size;
            }
        }

        if end_stream {
            stream.end_after_headers = true;
            stream.state = StreamState::HALF_CLOSED_LOCAL;

            if wait_for_trailers {
                this.dispatch(JSH2FrameParser::Gc::onWantTrailers, stream.get_identifier());
                return Ok(JSValue::js_number(stream_id as f64));
            }
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
    pub fn read(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected 1 argument")));
        }
        let buffer = args_list.ptr[0];
        buffer.ensure_still_alive();
        // Zig: `defer this.incrementWindowSizeIfNeeded()`. Wrap the body in a
        // closure so `?` short-circuits to the `result` binding instead of out
        // of the function, and the window-size update still runs on the error
        // path.
        let result = (|| {
            if let Some(array_buffer) = buffer.as_array_buffer(global_object) {
                let mut bytes = array_buffer.byte_slice();
                // read all the bytes
                while !bytes.is_empty() {
                    let result = this.read_bytes(bytes)?;
                    bytes = &bytes[result..];
                }
                Ok(JSValue::UNDEFINED)
            } else {
                Err(global_object
                    .throw(format_args!("Expected data to be a Buffer or ArrayBuffer")))
            }
        })();
        this.increment_window_size_if_needed();
        result
    }

    pub fn on_native_read(&self, data: &[u8]) -> JsResult<()> {
        bun_output::scoped_log!(H2FrameParser, "onNativeRead");
        self.ref_();
        let mut bytes = data;
        let result: JsResult<()> = (|| {
            while !bytes.is_empty() {
                let result = self.read_bytes(bytes)?;
                bytes = &bytes[result..];
            }
            Ok(())
        })();
        self.increment_window_size_if_needed();
        self.deref();
        result
    }

    pub fn on_native_writable(&self) {
        let _ = self.flush();
    }

    pub fn on_native_close(&self) {
        bun_output::scoped_log!(H2FrameParser, "onNativeClose");
        self.detach_native_socket();
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_native_socket_from_js(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected socket argument")));
        }

        let socket_js = args_list.ptr[0];
        this.detach_native_socket();
        if let Some(socket) = TLSSocket::from_js(socket_js) {
            bun_output::scoped_log!(H2FrameParser, "TLSSocket attached");
            this.native_socket
                .set(this.attach_to_native_socket::<true>(socket));
            // if we started with non native and go to native we now control the backpressure internally
            this.has_nonnative_backpressure.set(false);
            let _ = this.flush();
        } else if let Some(socket) = TCPSocket::from_js(socket_js) {
            bun_output::scoped_log!(H2FrameParser, "TCPSocket attached");
            this.native_socket
                .set(this.attach_to_native_socket::<false>(socket));
            // if we started with non native and go to native we now control the backpressure internally
            this.has_nonnative_backpressure.set(false);
            let _ = this.flush();
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Zig: `if (socket.attachNativeCallback(.{ .h2 = this })) … else { socket.ref(); writeonly }`.
    ///
    /// `attach_native_callback` stores an `IntrusiveRc<H2FrameParser>` (the
    /// `init_ref` bumps `ref_count`, mirroring Zig's `h2.ref()` inside
    /// `attachNativeCallback`); the matching `deref` happens in
    /// `NewSocket::detach_native_callback`. When the socket already has a
    /// native callback attached we fall back to write-only mode and take a
    /// manual `ref()` on the socket itself, balanced by `detach_native_socket`.
    fn attach_to_native_socket<const SSL: bool>(
        &self,
        socket: *mut crate::socket::NewSocket<SSL>,
    ) -> BunSocket {
        // SAFETY: `self` is a live heap allocation (HiveArray slot or boxed); `init_ref`
        // increments the intrusive refcount (Cell-backed) and wraps the pointer. The
        // `*mut` spelling is signature-only — `IntrusiveRc` only ever derefs as shared
        // (`on_native_*` callbacks take `&self`).
        let h2 = unsafe { IntrusiveRc::init_ref(self.as_ctx_ptr()) };
        // BACKREF: `socket` is the live `m_ctx` borrowed from the JS wrapper rooted by the
        // caller's `socket_js`; it strictly outlives the returned `BunSocket` via the
        // attach/detach refcount protocol (see `BunSocket` docs). `NonNull::new` panics on
        // null, matching Zig's `*TLSSocket` (never-null) field type.
        let socket_nn = NonNull::new(socket).expect("NewSocket m_ctx");
        let socket_ref = bun_ptr::BackRef::from(socket_nn);
        if socket_ref.attach_native_callback(NativeCallbacks::H2(h2)) {
            if SSL {
                BunSocket::Tls(bun_ptr::BackRef::from(socket_nn.cast::<TLSSocket>()))
            } else {
                BunSocket::Tcp(bun_ptr::BackRef::from(socket_nn.cast::<TCPSocket>()))
            }
        } else {
            socket_ref.ref_();
            if SSL {
                BunSocket::TlsWriteonly(bun_ptr::BackRef::from(socket_nn.cast::<TLSSocket>()))
            } else {
                BunSocket::TcpWriteonly(bun_ptr::BackRef::from(socket_nn.cast::<TCPSocket>()))
            }
        }
    }

    pub fn detach_native_socket(&self) {
        let native_socket = self.native_socket.replace(BunSocket::None);

        match native_socket {
            // BackRef invariant: socket kept alive by attach_native_callback; this is the matching detach.
            BunSocket::Tcp(socket) => socket.detach_native_callback(),
            BunSocket::Tls(socket) => socket.detach_native_callback(),
            // BackRef invariant: Writeonly socket was ref()'d on attach; this is the
            // matching deref. UFCS so method resolution doesn't pick `<BackRef as Deref>::deref`.
            BunSocket::TcpWriteonly(socket) => TCPSocket::deref(socket.get()),
            BunSocket::TlsWriteonly(socket) => TLSSocket::deref(socket.get()),
            BunSocket::None => {}
        }
    }

    pub fn constructor(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<*mut H2FrameParser> {
        let args_list = callframe.arguments_old::<1>();
        if args_list.len < 1 {
            return Err(global_object.throw(format_args!("Expected 1 argument")));
        }

        let options = args_list.ptr[0];
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
            handlers: JsCell::new(handlers),
            global_this: GlobalRef::from(global_object),
            strong_this: JsCell::new(JsRef::empty()),
            native_socket: Cell::new(BunSocket::None),
            local_settings: Cell::new(FullSettingsPayload::default()),
            remote_settings: Cell::new(None),
            current_frame: Cell::new(None),
            remaining_length: Cell::new(0),
            read_buffer: JsCell::new(MutableString::default()),
            window_size: Cell::new(DEFAULT_WINDOW_SIZE),
            used_window_size: Cell::new(0),
            remote_window_size: Cell::new(DEFAULT_WINDOW_SIZE),
            remote_used_window_size: Cell::new(0),
            max_header_list_pairs: Cell::new(128),
            max_rejected_streams: Cell::new(100),
            max_outstanding_settings: Cell::new(10),
            outstanding_settings: Cell::new(0),
            rejected_streams: Cell::new(0),
            max_session_memory: Cell::new(10),
            queued_data_size: Cell::new(0),
            max_outstanding_pings: Cell::new(10),
            out_standing_pings: Cell::new(0),
            max_send_header_block_length: Cell::new(0),
            last_stream_id: Cell::new(0),
            is_server: Cell::new(false),
            preface_received_len: Cell::new(0),
            write_buffer: JsCell::new(Vec::<u8>::default()),
            write_buffer_offset: Cell::new(0),
            outbound_queue_size: Cell::new(0),
            streams: JsCell::new(BunHashMap::default()),
            hpack: JsCell::new(None),
            has_nonnative_backpressure: Cell::new(false),
            auto_flusher: JsCell::new(AutoFlusher::default()),
            padding_strategy: Cell::new(PaddingStrategy::None),
        };
        let this: *mut H2FrameParser = if ENABLE_ALLOCATOR_POOL {
            POOL.with_borrow_mut(|pool| {
                let pool = pool.get_or_insert_with(|| Box::new(H2FrameParserHiveAllocator::init()));
                let slot = pool.try_get();
                // SAFETY: `slot` is a freshly-claimed, uninitialised `*mut H2FrameParser`
                // (HiveArray slot or fallback `Box<MaybeUninit<_>>`); `write` moves
                // `init` in without dropping prior contents.
                unsafe { slot.write(init) };
                slot
            })
        } else {
            bun_core::heap::into_raw(Box::new(init))
        };
        // Zig: `errdefer this.deinit()`. The remaining `?` sites below may throw a JS
        // exception; the guard returns the slot to the pool / frees the Box on that
        // path. Defused on success.
        let guard = scopeguard::guard(this, |this| {
            // SAFETY: `this` is the freshly-allocated parser above; on the error path
            // it has refcount 1 and no other owners, so `deinit` is the sole release.
            unsafe { (*this).deinit() };
        });
        // SAFETY: `this` was just allocated above; unique ownership, non-null.
        // R-2: deref as shared — every method below takes `&self`.
        let this_ref = unsafe { &*this };

        // check if socket is provided, and if it is a valid native socket
        if let Some(socket_js) = options.get(global_object, "native")? {
            if let Some(socket) = TLSSocket::from_js(socket_js) {
                bun_output::scoped_log!(H2FrameParser, "TLSSocket attached");
                this_ref
                    .native_socket
                    .set(this_ref.attach_to_native_socket::<true>(socket));
                let _ = this_ref.flush();
            } else if let Some(socket) = TCPSocket::from_js(socket_js) {
                bun_output::scoped_log!(H2FrameParser, "TCPSocket attached");
                this_ref
                    .native_socket
                    .set(this_ref.attach_to_native_socket::<false>(socket));
                let _ = this_ref.flush();
            }
        }
        if let Some(settings_js) = options.get(global_object, "settings")? {
            if !settings_js.is_empty_or_undefined_or_null() {
                bun_output::scoped_log!(H2FrameParser, "settings received in the constructor");
                this_ref.load_settings_from_js_value(global_object, settings_js)?;

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
                            .set((max_memory.to_uint64_no_truncate() as u32).max(1));
                    }
                }
                if let Some(max_header_list_pairs) =
                    settings_js.get(global_object, "maxHeaderListPairs")?
                {
                    if max_header_list_pairs.is_number() {
                        this_ref
                            .max_header_list_pairs
                            .set((max_header_list_pairs.to_uint64_no_truncate() as u32).max(4));
                    }
                }
                if let Some(max_rejected_streams) =
                    settings_js.get(global_object, "maxSessionRejectedStreams")?
                {
                    if max_rejected_streams.is_number() {
                        this_ref
                            .max_rejected_streams
                            .set(max_rejected_streams.to_uint64_no_truncate() as u32);
                    }
                }
                if let Some(max_outstanding_settings) =
                    settings_js.get(global_object, "maxOutstandingSettings")?
                {
                    if max_outstanding_settings.is_number() {
                        this_ref
                            .max_outstanding_settings
                            .set((max_outstanding_settings.to_uint64_no_truncate() as u32).max(1));
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

        // PORT NOTE: `HPACK::init` returns a C-allocated wrapper that must be
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
    pub fn detach_from_js(
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
    pub fn detach(&self) {
        self.uncork();
        self.unregister_auto_flush();
        self.detach_native_socket();

        // Zig: `this.readBuffer.deinit()` — frees the allocation. `reset()` would only
        // clear `len`; detach() is reachable from JS without a following `deinit`, so the
        // capacity must be released here. Drop-and-replace = free.
        self.read_buffer.set(MutableString::default());
        self.write_buffer.with_mut(|wb| wb.clear_and_free());
        self.write_buffer_offset.set(0);

        // `HpackHandle::drop` → `lshpack_wrapper_deinit` (cleanup + free).
        self.hpack.set(None);
    }

    fn deinit(&self) {
        bun_output::scoped_log!(H2FrameParser, "deinit");

        self.detach();
        // PORT NOTE: JsRef::deinit() dropped — overwrite with empty(); Drop releases the Strong slot.
        self.strong_this.set(JsRef::empty());
        // PORT NOTE: take the map out first so `self` is free for
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

        // defer: pool.put(this) / bun.destroy(this)
        // Zig has no destructors, so `pool.put` just reclaims storage. Rust still
        // owes Drop on the remaining fields (`handlers`, `auto_flusher`, the now-
        // empty `streams`/`read_buffer`/`write_buffer`/`strong_this`, …);
        // `HiveArrayFallback::put` runs `drop_in_place` before recycling the slot,
        // and `heap::destroy` drops via `Box<T>`, so both branches drop exactly once.
        // R-2: refcount==0, sole owner — `as_ctx_ptr()` is sound for the
        // teardown writes (`put` / `destroy` write only via `drop_in_place`,
        // which on `Cell`/`JsCell` fields goes through `UnsafeCell`).
        let this = self.as_ctx_ptr();
        if ENABLE_ALLOCATOR_POOL {
            POOL.with_borrow_mut(|pool| {
                // SAFETY: `this` is a live, fully-initialised allocation we exclusively
                // own (refcount hit zero / errdefer path); `put` drops it in place and
                // recycles the storage.
                unsafe {
                    pool.as_mut()
                        .expect("H2FrameParser deinit before constructor initialised pool")
                        .put(this)
                }
            });
        } else {
            // SAFETY: `this` was `heap::alloc`'d in `constructor`; reconstruct the
            // `Box<Self>` so Drop runs and the allocation is freed.
            unsafe { bun_core::heap::destroy(this) };
        }
    }

    pub fn finalize(self: Box<Self>) {
        bun_output::scoped_log!(H2FrameParser, "finalize");
        // PORT NOTE: JsRef::deinit() dropped — overwrite with empty(); Drop releases the Strong slot.
        bun_ptr::finalize_js_box(self, |this| this.strong_this.set(JsRef::empty()));
    }
}

// ported from: src/runtime/api/bun/h2_frame_parser.zig
