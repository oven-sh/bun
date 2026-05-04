//! HTTP/2 frame parser — ported from h2_frame_parser.zig
#![allow(non_camel_case_types, non_upper_case_globals, clippy::too_many_arguments)]

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::marker::PhantomData;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, Strong, VirtualMachine};
use bun_jsc::codegen::{JSH2FrameParser, JSTCPSocket, JSTLSSocket};
use bun_jsc::webcore::{AbortSignal, AutoFlusher};
use bun_jsc::ArrayBuffer::BinaryType;
use bun_jsc::node::{Encoding, StringOrBuffer};
use bun_str::{strings, String as BunString, ZigString};
use bun_collections::{BabyList as ByteList, HashMap as BunHashMap, HiveArray};
use bun_core::MutableString;
use bun_http::lshpack;
use bun_runtime::api::socket::{TCPSocket, TLSSocket};
use bstr::BStr;
use phf::phf_map;

bun_output::declare_scope!(H2FrameParser, visible);
bun_output::declare_scope!(UInt31WithReserved, visible);

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const MAX_PAYLOAD_SIZE_WITHOUT_FRAME: usize = 16384 - FrameHeader::BYTE_SIZE - 1;

#[derive(Default)]
enum BunSocket {
    #[default]
    None,
    // TODO(port): lifetime — LIFETIMES.tsv classifies tls/tcp as BORROW_PARAM (&'a mut)
    // but they're stored in a struct field with mismatched lifetimes; using raw ptr
    // because attach/detach are managed by attachNativeCallback/detachNativeCallback.
    Tls(*mut TLSSocket),
    TlsWriteonly(*mut TLSSocket), // SHARED — socket.ref()/deref() in attach/detach
    Tcp(*mut TCPSocket),
    TcpWriteonly(*mut TCPSocket), // SHARED — socket.ref()/deref() in attach/detach
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn JSC__JSGlobalObject__getHTTP2CommonString(
        global_object: *const JSGlobalObject,
        hpack_index: u32,
    ) -> JSValue;
    fn Bun__wrapAbortError(global_object: *const JSGlobalObject, cause: JSValue) -> JSValue;
}

pub fn get_http2_common_string(global_object: &JSGlobalObject, hpack_index: u32) -> Option<JSValue> {
    if hpack_index == 255 {
        return None;
    }
    // SAFETY: FFI to C++ with valid global object pointer
    let value = unsafe { JSC__JSGlobalObject__getHTTP2CommonString(global_object, hpack_index) };
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
enum PaddingStrategy {
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
struct ErrorCode(u32);
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
    u32::from_be_bytes(src[0..4].try_into().unwrap())
}

// ──────────────────────────────────────────────────────────────────────────
// Packed wire structs
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Clone, Copy, Default)]
struct UInt31WithReserved(u32);

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
        writer.write(&value.to_ne_bytes()).unwrap_or(0) != 0
    }
}

// packed struct(u40): streamIdentifier: u32, weight: u8
#[repr(C, packed)]
#[derive(Clone, Copy, Default)]
struct StreamPriority {
    stream_identifier: u32,
    weight: u8,
}
impl StreamPriority {
    pub const BYTE_SIZE: usize = 5;
    #[inline]
    fn write(&self, writer: &mut impl WireWriter) -> bool {
        let mut swap = *self;
        swap.stream_identifier = swap.stream_identifier.swap_bytes();
        // SAFETY: #[repr(C, packed)] POD, BYTE_SIZE bytes
        let bytes = unsafe {
            core::slice::from_raw_parts(&swap as *const _ as *const u8, Self::BYTE_SIZE)
        };
        writer.write(bytes).unwrap_or(0) != 0
    }
    #[inline]
    fn from(dst: &mut StreamPriority, src: &[u8]) {
        // SAFETY: src.len() == BYTE_SIZE asserted by caller
        unsafe {
            core::ptr::copy_nonoverlapping(
                src.as_ptr(),
                dst as *mut _ as *mut u8,
                Self::BYTE_SIZE,
            );
        }
        dst.stream_identifier = dst.stream_identifier.swap_bytes();
    }
}

// packed struct(u72): length: u24, type: u8, flags: u8, streamIdentifier: u32
// TODO(port): u24 — represented as u32 here; wire encoding handled in write()/from()
#[derive(Clone, Copy)]
struct FrameHeader {
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
        writer.write(&buf).unwrap_or(0) != 0
    }
    #[inline]
    fn from<const END: bool>(dst: &mut FrameHeader, src: &[u8], offset: usize) {
        // TODO(port): Zig copies raw bytes into packed struct then byteSwapAllFields at END.
        // We accumulate into a 9-byte scratch buffer instead since FrameHeader is not #[repr(packed)].
        // Phase B: verify wire layout matches Zig packed struct(u72) exactly.
        thread_local! {
            static SCRATCH: RefCell<[u8; FrameHeader::BYTE_SIZE]> =
                const { RefCell::new([0u8; FrameHeader::BYTE_SIZE]) };
        }
        SCRATCH.with_borrow_mut(|b| {
            b[offset..offset + src.len()].copy_from_slice(src);
            if END {
                dst.length = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
                dst.type_ = b[3];
                dst.flags = b[4];
                dst.stream_identifier = u32::from_be_bytes([b[5], b[6], b[7], b[8]]);
            }
        });
    }
}

// packed struct(u48): type: u16, value: u32
#[repr(C, packed)]
#[derive(Clone, Copy)]
struct SettingsPayloadUnit {
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
                (dst as *mut _ as *mut u8).add(offset),
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
struct FullSettingsPayload {
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
        result.put(global_object, ZigString::static_("headerTableSize"), JSValue::js_number(self.header_table_size));
        result.put(global_object, ZigString::static_("enablePush"), JSValue::from(self.enable_push > 0));
        result.put(global_object, ZigString::static_("maxConcurrentStreams"), JSValue::js_number(self.max_concurrent_streams));
        result.put(global_object, ZigString::static_("initialWindowSize"), JSValue::js_number(self.initial_window_size));
        result.put(global_object, ZigString::static_("maxFrameSize"), JSValue::js_number(self.max_frame_size));
        result.put(global_object, ZigString::static_("maxHeaderListSize"), JSValue::js_number(self.max_header_list_size));
        result.put(global_object, ZigString::static_("maxHeaderSize"), JSValue::js_number(self.max_header_list_size));
        result.put(global_object, ZigString::static_("enableConnectProtocol"), JSValue::from(self.enable_connect_protocol > 0));
        result
    }

    pub fn update_with(&mut self, option: SettingsPayloadUnit) {
        match SettingsType(option.type_) {
            SettingsType::SETTINGS_HEADER_TABLE_SIZE => self.header_table_size = option.value,
            SettingsType::SETTINGS_ENABLE_PUSH => self.enable_push = option.value,
            SettingsType::SETTINGS_MAX_CONCURRENT_STREAMS => self.max_concurrent_streams = option.value,
            SettingsType::SETTINGS_INITIAL_WINDOW_SIZE => self.initial_window_size = option.value,
            SettingsType::SETTINGS_MAX_FRAME_SIZE => self.max_frame_size = option.value,
            SettingsType::SETTINGS_MAX_HEADER_LIST_SIZE => self.max_header_list_size = option.value,
            SettingsType::SETTINGS_ENABLE_CONNECT_PROTOCOL => self.enable_connect_protocol = option.value,
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
        // SAFETY: #[repr(C, packed)] POD
        let bytes = unsafe {
            core::slice::from_raw_parts(&swap as *const _ as *const u8, Self::BYTE_SIZE)
        };
        writer.write(bytes).unwrap_or(0) != 0
    }
}

/// Minimal writer trait used for `(comptime Writer: type, writer: Writer)` params.
/// All call sites use either a fixed-buffer cursor or `DirectWriterStruct`.
trait WireWriter {
    fn write(&mut self, data: &[u8]) -> Result<usize, bun_core::Error>;
    fn write_int_u16_be(&mut self, v: u16) -> Result<(), bun_core::Error> {
        self.write(&v.to_be_bytes()).map(|_| ())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Static header maps
// ──────────────────────────────────────────────────────────────────────────

static VALID_RESPONSE_PSEUDO_HEADERS: phf::Map<&'static [u8], ()> = phf_map! {
    b":status" => (),
};

static VALID_REQUEST_PSEUDO_HEADERS: phf::Map<&'static [u8], ()> = phf_map! {
    b":method" => (),
    b":authority" => (),
    b":scheme" => (),
    b":path" => (),
    b":protocol" => (),
};

static SINGLE_VALUE_HEADERS: phf::Map<&'static [u8], ()> = phf_map! {
    b":status" => (),
    b":method" => (),
    b":authority" => (),
    b":scheme" => (),
    b":path" => (),
    b":protocol" => (),
    b"access-control-allow-credentials" => (),
    b"access-control-max-age" => (),
    b"access-control-request-method" => (),
    b"age" => (),
    b"authorization" => (),
    b"content-encoding" => (),
    b"content-language" => (),
    b"content-length" => (),
    b"content-location" => (),
    b"content-md5" => (),
    b"content-range" => (),
    b"content-type" => (),
    b"date" => (),
    b"dnt" => (),
    b"etag" => (),
    b"expires" => (),
    b"from" => (),
    b"host" => (),
    b"if-match" => (),
    b"if-modified-since" => (),
    b"if-none-match" => (),
    b"if-range" => (),
    b"if-unmodified-since" => (),
    b"last-modified" => (),
    b"location" => (),
    b"max-forwards" => (),
    b"proxy-authorization" => (),
    b"range" => (),
    b"referer" => (),
    b"retry-after" => (),
    b"tk" => (),
    b"upgrade-insecure-requests" => (),
    b"user-agent" => (),
    b"x-content-type-options" => (),
};
const SINGLE_VALUE_HEADERS_LEN: usize = 40;

// TODO(port): phf custom hasher — Zig ComptimeStringMap exposes indexOf(); phf::Map does not.
// Provide a small linear lookup over the key list for index_of() semantics.
fn single_value_headers_index_of(name: &[u8]) -> Option<usize> {
    // PERF(port): was ComptimeStringMap.indexOf — profile in Phase B
    SINGLE_VALUE_HEADERS
        .entries()
        .position(|(k, _)| *k == name)
}

// ──────────────────────────────────────────────────────────────────────────
// Standalone host functions
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn]
pub fn js_get_unpacked_settings(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let mut settings = FullSettingsPayload::default();

    let args_list = callframe.arguments_old(1);
    if args_list.len() < 1 {
        return Ok(settings.to_js(global_object));
    }

    let data_arg = args_list.ptr[0];

    if let Some(array_buffer) = data_arg.as_array_buffer(global_object) {
        let payload = array_buffer.byte_slice();
        let setting_byte_size = SettingsPayloadUnit::BYTE_SIZE;
        if payload.len() < setting_byte_size || payload.len() % setting_byte_size != 0 {
            return global_object.throw("Expected buf to be a Buffer of at least 6 bytes and a multiple of 6 bytes");
        }

        let mut i: usize = 0;
        while i < payload.len() {
            // SAFETY: zeroed is a valid SettingsPayloadUnit (POD)
            let mut unit: SettingsPayloadUnit = unsafe { core::mem::zeroed() };
            SettingsPayloadUnit::from::<true>(&mut unit, &payload[i..i + setting_byte_size], 0);
            settings.update_with(unit);
            i += setting_byte_size;
        }
        Ok(settings.to_js(global_object))
    } else if !data_arg.is_empty_or_undefined_or_null() {
        global_object.throw("Expected buf to be a Buffer")
    } else {
        Ok(settings.to_js(global_object))
    }
}

#[bun_jsc::host_fn]
pub fn js_assert_settings(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let args_list = callframe.arguments_old(1);
    if args_list.len() < 1 {
        return global_object.throw("Expected settings to be a object");
    }

    if args_list.len() > 0 && !args_list.ptr[0].is_empty_or_undefined_or_null() {
        let options = args_list.ptr[0];
        if !options.is_object() {
            return global_object.throw("Expected settings to be a object");
        }

        if let Some(header_table_size) = options.get(global_object, "headerTableSize")? {
            if header_table_size.is_number() {
                let value = header_table_size.as_number();
                if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                    return global_object.err_http2_invalid_setting_value_range_error("Expected headerTableSize to be a number between 0 and 2^32-1").throw();
                }
            } else if !header_table_size.is_empty_or_undefined_or_null() {
                return global_object.err_http2_invalid_setting_value_range_error("Expected headerTableSize to be a number").throw();
            }
        }

        if let Some(enable_push) = options.get(global_object, "enablePush")? {
            if !enable_push.is_boolean() && !enable_push.is_undefined() {
                return global_object.err_http2_invalid_setting_value("Expected enablePush to be a boolean").throw();
            }
        }

        if let Some(initial_window_size) = options.get(global_object, "initialWindowSize")? {
            if initial_window_size.is_number() {
                let value = initial_window_size.as_number();
                if value < 0.0 || value > MAX_WINDOW_SIZE_F64 {
                    return global_object.err_http2_invalid_setting_value_range_error("Expected initialWindowSize to be a number between 0 and 2^32-1").throw();
                }
            } else if !initial_window_size.is_empty_or_undefined_or_null() {
                return global_object.err_http2_invalid_setting_value_range_error("Expected initialWindowSize to be a number").throw();
            }
        }

        if let Some(max_frame_size) = options.get(global_object, "maxFrameSize")? {
            if max_frame_size.is_number() {
                let value = max_frame_size.as_number();
                if value < 16384.0 || value > MAX_FRAME_SIZE_F64 {
                    return global_object.err_http2_invalid_setting_value_range_error("Expected maxFrameSize to be a number between 16,384 and 2^24-1").throw();
                }
            } else if !max_frame_size.is_empty_or_undefined_or_null() {
                return global_object.err_http2_invalid_setting_value_range_error("Expected maxFrameSize to be a number").throw();
            }
        }

        if let Some(max_concurrent_streams) = options.get(global_object, "maxConcurrentStreams")? {
            if max_concurrent_streams.is_number() {
                let value = max_concurrent_streams.as_number();
                if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                    return global_object.err_http2_invalid_setting_value_range_error("Expected maxConcurrentStreams to be a number between 0 and 2^32-1").throw();
                }
            } else if !max_concurrent_streams.is_empty_or_undefined_or_null() {
                return global_object.err_http2_invalid_setting_value_range_error("Expected maxConcurrentStreams to be a number").throw();
            }
        }

        if let Some(max_header_list_size) = options.get(global_object, "maxHeaderListSize")? {
            if max_header_list_size.is_number() {
                let value = max_header_list_size.as_number();
                if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                    return global_object.err_http2_invalid_setting_value_range_error("Expected maxHeaderListSize to be a number between 0 and 2^32-1").throw();
                }
            } else if !max_header_list_size.is_empty_or_undefined_or_null() {
                return global_object.err_http2_invalid_setting_value_range_error("Expected maxHeaderListSize to be a number").throw();
            }
        }

        if let Some(max_header_size) = options.get(global_object, "maxHeaderSize")? {
            if max_header_size.is_number() {
                let value = max_header_size.as_number();
                if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                    return global_object.err_http2_invalid_setting_value_range_error("Expected maxHeaderSize to be a number between 0 and 2^32-1").throw();
                }
            } else if !max_header_size.is_empty_or_undefined_or_null() {
                return global_object.err_http2_invalid_setting_value_range_error("Expected maxHeaderSize to be a number").throw();
            }
        }
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
pub fn js_get_packed_settings(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let mut settings = FullSettingsPayload::default();
    let args_list = callframe.arguments_old(1);

    if args_list.len() > 0 && !args_list.ptr[0].is_empty_or_undefined_or_null() {
        let options = args_list.ptr[0];

        if !options.is_object() {
            return global_object.throw("Expected settings to be a object");
        }

        if let Some(header_table_size) = options.get(global_object, "headerTableSize")? {
            if header_table_size.is_number() {
                let v = header_table_size.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return global_object.throw("Expected headerTableSize to be a number between 0 and 2^32-1");
                }
                settings.header_table_size = u32::try_from(v).unwrap();
            } else if !header_table_size.is_empty_or_undefined_or_null() {
                return global_object.throw("Expected headerTableSize to be a number");
            }
        }

        if let Some(enable_push) = options.get(global_object, "enablePush")? {
            if enable_push.is_boolean() {
                settings.enable_push = if enable_push.as_boolean() { 1 } else { 0 };
            } else if !enable_push.is_empty_or_undefined_or_null() {
                return global_object.throw("Expected enablePush to be a boolean");
            }
        }

        if let Some(initial_window_size) = options.get(global_object, "initialWindowSize")? {
            if initial_window_size.is_number() {
                let v = initial_window_size.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return global_object.throw("Expected initialWindowSize to be a number between 0 and 2^32-1");
                }
                settings.initial_window_size = u32::try_from(v).unwrap();
            } else if !initial_window_size.is_empty_or_undefined_or_null() {
                return global_object.throw("Expected initialWindowSize to be a number");
            }
        }

        if let Some(max_frame_size) = options.get(global_object, "maxFrameSize")? {
            if max_frame_size.is_number() {
                let v = max_frame_size.to_int32();
                if v as u32 > MAX_FRAME_SIZE || v < 16384 {
                    return global_object.throw("Expected maxFrameSize to be a number between 16,384 and 2^24-1");
                }
                settings.max_frame_size = u32::try_from(v).unwrap();
            } else if !max_frame_size.is_empty_or_undefined_or_null() {
                return global_object.throw("Expected maxFrameSize to be a number");
            }
        }

        if let Some(max_concurrent_streams) = options.get(global_object, "maxConcurrentStreams")? {
            if max_concurrent_streams.is_number() {
                let v = max_concurrent_streams.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return global_object.throw("Expected maxConcurrentStreams to be a number between 0 and 2^32-1");
                }
                settings.max_concurrent_streams = u32::try_from(v).unwrap();
            } else if !max_concurrent_streams.is_empty_or_undefined_or_null() {
                return global_object.throw("Expected maxConcurrentStreams to be a number");
            }
        }

        if let Some(max_header_list_size) = options.get(global_object, "maxHeaderListSize")? {
            if max_header_list_size.is_number() {
                let v = max_header_list_size.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return global_object.throw("Expected maxHeaderListSize to be a number between 0 and 2^32-1");
                }
                settings.max_header_list_size = u32::try_from(v).unwrap();
            } else if !max_header_list_size.is_empty_or_undefined_or_null() {
                return global_object.throw("Expected maxHeaderListSize to be a number");
            }
        }

        if let Some(max_header_size) = options.get(global_object, "maxHeaderSize")? {
            if max_header_size.is_number() {
                let v = max_header_size.to_int32();
                if v as u32 > MAX_HEADER_TABLE_SIZE || v < 0 {
                    return global_object.throw("Expected maxHeaderSize to be a number between 0 and 2^32-1");
                }
                settings.max_header_list_size = u32::try_from(v).unwrap();
            } else if !max_header_size.is_empty_or_undefined_or_null() {
                return global_object.throw("Expected maxHeaderSize to be a number");
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
    global_object: *const JSGlobalObject, // JSC_BORROW
}

impl Handlers {
    pub fn call_event_handler(
        &self,
        event: JSH2FrameParser::Gc,
        this_value: JSValue,
        context: JSValue,
        data: &[JSValue],
    ) -> bool {
        let Some(callback) = event.get(this_value) else { return false };
        // SAFETY: global_object outlives Handlers (JSC_BORROW)
        let global = unsafe { &*self.global_object };
        self.vm.event_loop().run_callback(callback, global, context, data);
        true
    }

    pub fn call_write_callback(&self, callback: JSValue, data: &[JSValue]) -> bool {
        if !callback.is_callable() {
            return false;
        }
        let global = unsafe { &*self.global_object };
        self.vm.event_loop().run_callback(callback, global, JSValue::UNDEFINED, data);
        true
    }

    pub fn call_event_handler_with_result(
        &self,
        event: JSH2FrameParser::Gc,
        this_value: JSValue,
        data: &[JSValue],
    ) -> JSValue {
        let Some(callback) = event.get(this_value) else { return JSValue::ZERO };
        let global = unsafe { &*self.global_object };
        self.vm.event_loop().run_callback_with_result(callback, global, this_value, data)
    }

    pub fn from_js(
        global_object: &JSGlobalObject,
        opts: JSValue,
        this_value: JSValue,
    ) -> JsResult<Handlers> {
        let mut handlers = Handlers {
            binary_type: BinaryType::Buffer,
            vm: global_object.bun_vm(),
            global_object: global_object as *const _,
        };

        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return global_object.throw_invalid_arguments("Expected \"handlers\" to be an object");
        }

        macro_rules! handler_pair {
            ($field:ident, $key:literal) => {{
                if let Some(callback_value) = opts.get_truthy(global_object, $key)? {
                    if !callback_value.is_cell() || !callback_value.is_callable() {
                        return global_object.throw_invalid_arguments(
                            format_args!("Expected \"{}\" callback to be a function", $key),
                        );
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
                return global_object.throw_invalid_arguments("Expected \"error\" callback to be a function");
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
            return global_object.throw_invalid_arguments("Expected at least \"write\" callback");
        }

        if let Some(binary_type_value) = opts.get_truthy(global_object, "binaryType")? {
            if !binary_type_value.is_string() {
                return global_object.throw_invalid_arguments("Expected \"binaryType\" to be a string");
            }
            handlers.binary_type = match BinaryType::from_js_value(global_object, binary_type_value)? {
                Some(bt) => bt,
                None => {
                    return global_object.throw_invalid_arguments(
                        "Expected 'binaryType' to be 'ArrayBuffer', 'Uint8Array', or 'Buffer'",
                    );
                }
            };
        }

        Ok(handlers)
    }
}

pub use JSH2FrameParser::get_constructor as H2FrameParserConstructor;

// ──────────────────────────────────────────────────────────────────────────
// FixedBufferStream — replacement for std.io.fixedBufferStream
// ──────────────────────────────────────────────────────────────────────────

struct FixedBufferStream<'a> {
    buffer: &'a mut [u8],
    pos: usize,
}
impl<'a> FixedBufferStream<'a> {
    fn new(buffer: &'a mut [u8]) -> Self {
        Self { buffer, pos: 0 }
    }
    fn seek_to(&mut self, p: usize) {
        self.pos = p;
    }
    fn get_pos(&self) -> usize {
        self.pos
    }
    fn reset(&mut self) {
        self.pos = 0;
    }
    fn read_int_u16_be(&mut self) -> Result<u16, bun_core::Error> {
        if self.pos + 2 > self.buffer.len() {
            return Err(bun_core::err!("EndOfStream"));
        }
        let v = u16::from_be_bytes([self.buffer[self.pos], self.buffer[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }
}
impl<'a> WireWriter for FixedBufferStream<'a> {
    fn write(&mut self, data: &[u8]) -> Result<usize, bun_core::Error> {
        let avail = self.buffer.len() - self.pos;
        if data.len() > avail {
            return Err(bun_core::err!("NoSpaceLeft"));
        }
        self.buffer[self.pos..self.pos + data.len()].copy_from_slice(data);
        self.pos += data.len();
        Ok(data.len())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser
// ──────────────────────────────────────────────────────────────────────────

const ENABLE_AUTO_CORK: bool = false; // ENABLE CORK OPTIMIZATION
const ENABLE_ALLOCATOR_POOL: bool = true; // ENABLE HIVE ALLOCATOR OPTIMIZATION
const MAX_BUFFER_SIZE: u32 = 32768;

thread_local! {
    static CORK_BUFFER: RefCell<[u8; 16386]> = const { RefCell::new([0u8; 16386]) };
    static CORK_OFFSET: Cell<u16> = const { Cell::new(0) };
    static CORKED_H2: Cell<Option<*mut H2FrameParser>> = const { Cell::new(None) };
    // PERF(port): was HiveArray(H2FrameParser, 256).Fallback — profile in Phase B
    static POOL: RefCell<Option<Box<HiveArray<H2FrameParser, 256>>>> = const { RefCell::new(None) };
    static SHARED_REQUEST_BUFFER: RefCell<[u8; 16384]> = const { RefCell::new([0u8; 16384]) };
}

#[bun_jsc::JsClass]
pub struct H2FrameParser {
    strong_this: JsRef,
    global_this: *const JSGlobalObject, // JSC_BORROW
    // allocator field dropped — global mimalloc
    handlers: Handlers,
    native_socket: BunSocket,
    local_settings: FullSettingsPayload,
    // only available after receiving settings or ACK
    remote_settings: Option<FullSettingsPayload>,
    // current frame being read
    current_frame: Option<FrameHeader>,
    // remaining bytes to read for the current frame
    remaining_length: i32,
    // buffer if more data is needed for the current frame
    read_buffer: MutableString,

    // local Window limits the download of data
    // current window size for the connection
    window_size: u64,
    // used window size for the connection
    used_window_size: u64,

    // remote Window limits the upload of data
    // remote window size for the connection
    remote_window_size: u64,
    // remote used window size for the connection
    remote_used_window_size: u64,

    max_header_list_pairs: u32,
    max_rejected_streams: u32,
    max_outstanding_settings: u32,
    outstanding_settings: u32,
    rejected_streams: u32,
    max_session_memory: u32, // this limit is in MB
    queued_data_size: u64,   // this is in bytes
    max_outstanding_pings: u64,
    out_standing_pings: u64,
    max_send_header_block_length: u32,
    last_stream_id: u32,
    is_server: bool,
    preface_received_len: u8,
    // we buffer requests until we get the first settings ACK
    write_buffer: ByteList<u8>,
    write_buffer_offset: usize,
    // TODO: this will be removed when I re-add header and data priorization
    outbound_queue_size: usize,

    streams: BunHashMap<u32, *mut Stream>,

    hpack: Option<Box<lshpack::HPACK>>,

    has_nonnative_backpressure: bool,
    ref_count: Cell<u32>, // intrusive RefCount

    auto_flusher: AutoFlusher,
    padding_strategy: PaddingStrategy,
}

// IntrusiveRc — bun.ptr.RefCount(@This(), "ref_count", deinit, .{})
impl H2FrameParser {
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: ref_count hit zero; mirrors Zig RefCount.deinit dispatch
            unsafe { (*(self as *const Self as *mut Self)).deinit() };
        }
    }
}

/// The streams hashmap may mutate when growing we use this when we need to make sure its safe to iterate over it
pub struct StreamResumableIterator<'a> {
    parser: &'a mut H2FrameParser,
    index: u32,
}
impl<'a> StreamResumableIterator<'a> {
    pub fn init(parser: &'a mut H2FrameParser) -> Self {
        Self { index: 0, parser }
    }
    pub fn next(&mut self) -> Option<*mut Stream> {
        // TODO(port): Zig HashMap.iterator() exposes raw bucket index; bun_collections::HashMap
        // must expose a resumable bucket-index iterator. Stub here.
        let mut it = self.parser.streams.iterator();
        if it.index() > it.capacity() || self.index > it.capacity() {
            return None;
        }
        // resume the iterator from the same index if possible
        it.set_index(self.index);
        while let Some(item) = it.next() {
            self.index = it.index();
            return Some(*item.value_ptr());
        }
        self.index = it.index();
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
    js_context: Strong, // jsc.Strong.Optional
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
    // LIFETIMES.tsv: SHARED Rc<AbortSignal> — but AbortSignal is intrusively
    // refcounted across FFI; keep raw ptr + manual ref/detach.
    signal: *mut AbortSignal,
    // LIFETIMES.tsv: SHARED Rc<H2FrameParser> — intrusive refcount; raw ptr.
    parser: *mut H2FrameParser,
    stream_id: u32,
}

impl SignalRef {
    pub fn is_aborted(&self) -> bool {
        // SAFETY: signal is kept alive via .ref() in attach_signal
        unsafe { (*self.signal).aborted() }
    }

    pub fn abort_listener(this: *mut SignalRef, reason: JSValue) {
        bun_output::scoped_log!(H2FrameParser, "abortListener");
        reason.ensure_still_alive();
        // SAFETY: this is a stable heap allocation owned by Stream.signal
        let this = unsafe { &mut *this };
        let parser = unsafe { &mut *this.parser };
        let Some(stream) = parser.streams.get(&this.stream_id).copied() else { return };
        let stream = unsafe { &mut *stream };
        if stream.state != StreamState::CLOSED {
            // SAFETY: FFI call with valid global object
            let wrapped = unsafe { Bun__wrapAbortError(parser.global_this, reason) };
            parser.abort_stream(stream, wrapped);
        }
    }
}

impl Drop for SignalRef {
    fn drop(&mut self) {
        // SAFETY: signal/parser are valid until detach
        unsafe {
            (*self.signal).detach(self as *mut _ as *mut c_void);
            (*self.parser).deref();
        }
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
    end_stream: bool,        // end_stream flag
    len: u32,                // actually payload size
    offset: u32,             // offset into the buffer (if partial flush due to flow control)
    buffer: Vec<u8>,         // allocated buffer if len > 0
    callback: Strong,        // JSCallback for done
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

    pub fn flush_queue(&mut self, client: &mut H2FrameParser, written: &mut usize) -> FlushState {
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
                let frame_slice = frame.slice();
                let max_size = frame_slice
                    .len()
                    .min((self.remote_window_size.saturating_sub(self.remote_used_window_size)) as usize)
                    .min((client.remote_window_size.saturating_sub(client.remote_used_window_size)) as usize)
                    .min(MAX_PAYLOAD_SIZE_WITHOUT_FRAME);
                if max_size == 0 {
                    is_flow_control_limited = true;
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "dataFrame flow control limited {} {} {} {} {} {}",
                        frame_slice.len(),
                        self.remote_window_size,
                        self.remote_used_window_size,
                        client.remote_window_size,
                        client.remote_used_window_size,
                        max_size
                    );
                    // we are flow control limited lets return backpressure if is limited in the connection so we short circuit the flush
                    return if client.remote_window_size == client.remote_used_window_size {
                        FlushState::Backpressure
                    } else {
                        FlushState::NoAction
                    };
                }
                if max_size < frame_slice.len() {
                    is_flow_control_limited = true;
                    // we need to break the frame into smaller chunks
                    frame.offset += u32::try_from(max_size).unwrap();
                    let able_to_send = &frame_slice[0..max_size];
                    client.queued_data_size -= able_to_send.len() as u64;
                    *written += able_to_send.len();

                    let padding = self.get_padding(able_to_send.len(), max_size - 1);
                    let payload_size = able_to_send.len() + if padding != 0 { padding as usize + 1 } else { 0 };
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "padding: {} size: {} max_size: {} payload_size: {}",
                        padding, able_to_send.len(), max_size, payload_size
                    );
                    self.remote_used_window_size += payload_size as u64;
                    client.remote_used_window_size += payload_size as u64;

                    let mut flags: u8 = 0; // we ignore end_stream for now because we know we have more data to send
                    if padding != 0 {
                        flags |= DataFrameFlags::PADDED as u8;
                    }
                    let mut data_header = FrameHeader {
                        type_: FrameType::HTTP_FRAME_DATA as u8,
                        flags,
                        stream_identifier: self.id,
                        length: u32::try_from(payload_size).unwrap(),
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
                            writer.write(&buffer[0..payload_size]).unwrap_or(0) != 0
                        });
                    } else {
                        break 'brk writer.write(able_to_send).unwrap_or(0) != 0;
                    }
                } else {
                    // flush with some payload
                    client.queued_data_size -= frame_slice.len() as u64;
                    *written += frame_slice.len();

                    let padding = self.get_padding(frame_slice.len(), max_size - 1);
                    let payload_size = frame_slice.len() + if padding != 0 { padding as usize + 1 } else { 0 };
                    bun_output::scoped_log!(
                        H2FrameParser,
                        "padding: {} size: {} max_size: {} payload_size: {}",
                        padding, frame_slice.len(), max_size, payload_size
                    );
                    self.remote_used_window_size += payload_size as u64;
                    client.remote_used_window_size += payload_size as u64;
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
                        length: u32::try_from(payload_size).unwrap(),
                    };
                    let _ = data_header.write(&mut writer);
                    if padding != 0 {
                        break 'brk SHARED_REQUEST_BUFFER.with_borrow_mut(|buffer| {
                            unsafe {
                                core::ptr::copy(
                                    frame_slice.as_ptr(),
                                    buffer.as_mut_ptr().add(1),
                                    frame_slice.len(),
                                );
                            }
                            buffer[0] = padding;
                            writer.write(&buffer[0..payload_size]).unwrap_or(0) != 0
                        });
                    } else {
                        break 'brk writer.write(frame_slice).unwrap_or(0) != 0;
                    }
                }
            }
        };

        // defer block from Zig (only when !is_flow_control_limited)
        if !is_flow_control_limited {
            // only call the callback + free the frame if we write to the socket the full frame
            let mut _frame = self.data_frame_queue.dequeue().unwrap();
            client.outbound_queue_size -= 1;

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
                            JSValue::js_number(self.state as u8),
                        );
                    }
                }
            }
            drop(_frame);
        }

        if no_backpressure { FlushState::Flushed } else { FlushState::Backpressure }
    }

    pub fn queue_frame(
        &mut self,
        client: &mut H2FrameParser,
        bytes: &[u8],
        callback: JSValue,
        end_stream: bool,
    ) {
        let global_this = unsafe { &*client.global_this };

        if let Some(last_frame) = self.data_frame_queue.peek_last() {
            if bytes.is_empty() {
                // just merge the end_stream
                last_frame.end_stream = end_stream;
                // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                // this is fine is like a per-stream CORKING in a frame level
                if let Some(old_callback) = last_frame.callback.get() {
                    client.dispatch_write_callback(old_callback);
                    last_frame.callback.deinit();
                }
                last_frame.callback = Strong::create(callback, global_this);
                return;
            }
            if last_frame.len == 0 {
                // we have an empty frame with means we can just use this frame with a new buffer
                last_frame.buffer = vec![0u8; MAX_PAYLOAD_SIZE_WITHOUT_FRAME];
            }
            let max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME as u32;
            let remaining = max_size - last_frame.len;
            if remaining > 0 {
                // ok we can cork frames
                let consumed_len = (remaining as usize).min(bytes.len());
                let merge = &bytes[0..consumed_len];
                last_frame.buffer[last_frame.len as usize..last_frame.len as usize + consumed_len]
                    .copy_from_slice(merge);
                last_frame.len += u32::try_from(consumed_len).unwrap();
                bun_output::scoped_log!(H2FrameParser, "dataFrame merged {}", consumed_len);

                client.queued_data_size += consumed_len as u64;
                // lets fallthrough if we still have some data
                let more_data = &bytes[consumed_len..];
                if more_data.is_empty() {
                    last_frame.end_stream = end_stream;
                    // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                    // this is fine is like a per-stream CORKING in a frame level
                    if let Some(old_callback) = last_frame.callback.get() {
                        client.dispatch_write_callback(old_callback);
                        last_frame.callback.deinit();
                    }
                    last_frame.callback = Strong::create(callback, global_this);
                    return;
                }
                // we keep the old callback because the new will be part of another frame
                return self.queue_frame(client, more_data, callback, end_stream);
            }
        }
        bun_output::scoped_log!(
            H2FrameParser,
            "{} queued {} {}",
            if client.is_server { "server" } else { "client" },
            bytes.len(),
            end_stream
        );

        let mut frame = PendingFrame {
            end_stream,
            len: u32::try_from(bytes.len()).unwrap(),
            offset: 0,
            // we need to clone this data to send it later
            buffer: if bytes.is_empty() {
                Vec::new()
            } else {
                vec![0u8; MAX_PAYLOAD_SIZE_WITHOUT_FRAME]
            },
            callback: if callback.is_callable() {
                Strong::create(callback, global_this)
            } else {
                Strong::empty()
            },
        };
        if !bytes.is_empty() {
            frame.buffer[0..bytes.len()].copy_from_slice(bytes);
            global_this.vm().deprecated_report_extra_memory(bytes.len());
        }
        bun_output::scoped_log!(H2FrameParser, "dataFrame enqueued {}", frame.len);
        self.data_frame_queue.enqueue(frame);
        client.outbound_queue_size += 1;
        client.queued_data_size += bytes.len() as u64;
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
            js_context: Strong::empty(),
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
        let old = core::mem::replace(&mut self.js_context, Strong::create(value, global_object));
        drop(old);
    }

    pub fn get_identifier(&self) -> JSValue {
        self.js_context.get().unwrap_or_else(|| JSValue::js_number(self.id))
    }

    pub fn attach_signal(&mut self, parser: &mut H2FrameParser, signal: &mut AbortSignal) {
        // we need a stable pointer to know what signal points to what stream_id + parser
        let mut signal_ref = Box::new(SignalRef {
            signal: signal as *mut _,
            parser: parser as *mut _,
            stream_id: self.id,
        });
        // SAFETY: signal_ref is heap-allocated; listen stores the raw ptr for callback
        signal_ref.signal = signal.ref_().listen(
            &mut *signal_ref as *mut SignalRef as *mut c_void,
            SignalRef::abort_listener,
        );
        // TODO: We should not need this ref counting here, since Parser owns Stream
        parser.ref_();
        self.signal = Some(signal_ref);
    }

    pub fn detach_context(&mut self) {
        self.js_context.deinit();
    }

    fn clean_queue<const FINALIZING: bool>(&mut self, client: &mut H2FrameParser) {
        bun_output::scoped_log!(
            H2FrameParser,
            "cleanQueue len: {} front: {} outboundQueueSize: {}",
            self.data_frame_queue.len,
            self.data_frame_queue.front,
            client.outbound_queue_size
        );

        let mut queue = core::mem::take(&mut self.data_frame_queue);
        while let Some(item) = queue.dequeue() {
            let frame = item;
            let len = frame.slice().len();
            bun_output::scoped_log!(H2FrameParser, "dataFrame dropped {}", len);
            client.queued_data_size -= len as u64;
            if !FINALIZING {
                if let Some(callback_value) = frame.callback.get() {
                    client.dispatch_write_callback(callback_value);
                }
            }
            drop(frame);
            client.outbound_queue_size -= 1;
        }
        // queue dropped here
    }

    /// this can be called multiple times
    pub fn free_resources<const FINALIZING: bool>(&mut self, client: &mut H2FrameParser) {
        self.detach_context();
        self.clean_queue::<FINALIZING>(client);
        if let Some(signal) = self.signal.take() {
            drop(signal);
        }
        // unsafe to ask GC to run if we are already inside GC
        if !FINALIZING {
            VirtualMachine::get().event_loop().process_gc_timer();
        }
    }
}

type HeaderValue = lshpack::DecodeResult;

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — core methods
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    /// Encodes a single header into the ArrayList, growing if needed.
    /// Returns the number of bytes written, or error on failure.
    ///
    /// Capacity estimation: name.len + value.len + HPACK_ENTRY_OVERHEAD
    fn encode_header_into_list(
        &mut self,
        encoded_headers: &mut Vec<u8>,
        name: &[u8],
        value: &[u8],
        never_index: bool,
    ) -> Result<usize, bun_core::Error> {
        // TODO(port): narrow error set
        let required = encoded_headers.len() + name.len() + value.len() + HPACK_ENTRY_OVERHEAD;
        encoded_headers.reserve(required.saturating_sub(encoded_headers.len()));
        // PORT NOTE: Zig used allocatedSlice() to write past .len then bump .len; emulate by
        // resizing temporarily. Phase B: expose spare_capacity_mut on encode().
        let old_len = encoded_headers.len();
        // SAFETY: we ensure capacity >= required above; encode() writes only within capacity
        unsafe { encoded_headers.set_len(encoded_headers.capacity()) };
        let bytes_written = self.encode(encoded_headers.as_mut_slice(), old_len, name, value, never_index)?;
        unsafe { encoded_headers.set_len(old_len + bytes_written) };
        Ok(bytes_written)
    }

    pub fn decode(&mut self, src_buffer: &[u8]) -> Result<HeaderValue, bun_core::Error> {
        if let Some(hpack) = self.hpack.as_mut() {
            return hpack.decode(src_buffer);
        }
        Err(bun_core::err!("UnableToDecode"))
    }

    pub fn encode(
        &mut self,
        dst_buffer: &mut [u8],
        dst_offset: usize,
        name: &[u8],
        value: &[u8],
        never_index: bool,
    ) -> Result<usize, bun_core::Error> {
        if let Some(hpack) = self.hpack.as_mut() {
            // lets make sure the name is lowercase
            return hpack.encode(name, value, never_index, dst_buffer, dst_offset);
        }
        Err(bun_core::err!("UnableToEncode"))
    }

    /// Calculate the new window size for the connection and the stream
    /// https://datatracker.ietf.org/doc/html/rfc7540#section-6.9.1
    fn adjust_window_size(&mut self, stream: Option<&mut Stream>, payload_size: u32) {
        self.used_window_size = self.used_window_size.saturating_add(payload_size as u64);
        bun_output::scoped_log!(
            H2FrameParser,
            "adjustWindowSize {} {} {} {}",
            self.used_window_size, self.window_size, self.is_server, payload_size
        );
        if self.used_window_size > self.window_size {
            // we are receiving more data than we are allowed to
            self.send_go_away(0, ErrorCode::FLOW_CONTROL_ERROR, b"Window size overflow", self.last_stream_id, true);
            self.used_window_size -= payload_size as u64;
        }

        if let Some(s) = stream {
            s.used_window_size += payload_size as u64;
            if s.used_window_size > s.window_size {
                // we are receiving more data than we are allowed to
                self.send_go_away(s.id, ErrorCode::FLOW_CONTROL_ERROR, b"Window size overflow", self.last_stream_id, true);
                s.used_window_size -= payload_size as u64;
            }
        }
    }

    fn increment_window_size_if_needed(&mut self) {
        // PORT NOTE: reshaped for borrowck — collect actions then apply
        let mut updates: Vec<(u32, u64)> = Vec::new();
        for (_, item) in self.streams.iter() {
            let stream = unsafe { &mut **item };
            bun_output::scoped_log!(
                H2FrameParser,
                "incrementWindowSizeIfNeeded stream {} {} {} {}",
                stream.id, stream.used_window_size, stream.window_size, self.is_server
            );
            if stream.used_window_size >= stream.window_size / 2 && stream.used_window_size > 0 {
                let consumed = stream.used_window_size;
                stream.used_window_size = 0;
                bun_output::scoped_log!(
                    H2FrameParser,
                    "incrementWindowSizeIfNeeded stream {} {} {}",
                    stream.id, stream.window_size, self.is_server
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
            self.used_window_size, self.window_size, self.is_server
        );
        if self.used_window_size >= self.window_size / 2 && self.used_window_size > 0 {
            let consumed = self.used_window_size;
            self.used_window_size = 0;
            self.send_window_update(0, UInt31WithReserved::init(consumed as u32, false));
        }
    }

    pub fn set_settings(&mut self, settings: FullSettingsPayload) -> bool {
        bun_output::scoped_log!(H2FrameParser, "HTTP_FRAME_SETTINGS ack false");

        if self.outstanding_settings >= self.max_outstanding_settings {
            self.send_go_away(0, ErrorCode::MAX_PENDING_SETTINGS_ACK, b"Maximum number of pending settings acknowledgements", self.last_stream_id, true);
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

        self.outstanding_settings += 1;

        self.local_settings = settings;
        let _ = self.local_settings.write(&mut stream);
        let _ = self.write(&buffer);
        true
    }

    pub fn abort_stream(&mut self, stream: &mut Stream, abort_reason: JSValue) {
        bun_output::scoped_log!(H2FrameParser, "HTTP_FRAME_RST_STREAM id: {} code: CANCEL", stream.id);

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
        let _ = writer_stream.write(&value.to_ne_bytes());
        let old_state = stream.state;
        stream.state = StreamState::CLOSED;
        let identifier = stream.get_identifier();
        identifier.ensure_still_alive();
        stream.free_resources::<false>(self);
        self.dispatch_with_2_extra(JSH2FrameParser::Gc::onAborted, identifier, abort_reason, JSValue::js_number(old_state as u8));
        let _ = self.write(&buffer);
    }

    pub fn end_stream(&mut self, stream: &mut Stream, rst_code: ErrorCode) {
        bun_output::scoped_log!(H2FrameParser, "HTTP_FRAME_RST_STREAM id: {} code: {}", stream.id, rst_code.0);
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
        let _ = writer_stream.write(&value.to_ne_bytes());

        stream.state = StreamState::CLOSED;
        let identifier = stream.get_identifier();
        identifier.ensure_still_alive();
        stream.free_resources::<false>(self);
        if rst_code == ErrorCode::NO_ERROR {
            self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, JSValue::js_number(stream.state as u8));
        } else {
            self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, identifier, JSValue::js_number(rst_code.0));
        }

        let _ = self.write(&buffer);
    }

    pub fn send_go_away(
        &mut self,
        stream_identifier: u32,
        rst_code: ErrorCode,
        debug_data: &[u8],
        last_stream_id: u32,
        emit_error: bool,
    ) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_GOAWAY {} code {} debug_data {} emitError {}",
            stream_identifier, rst_code.0, BStr::new(debug_data), emit_error
        );
        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 8];
        let mut stream = FixedBufferStream::new(&mut buffer);

        let mut frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_GOAWAY as u8,
            flags: 0,
            stream_identifier,
            length: u32::try_from(8 + debug_data.len()).unwrap(),
        };
        let _ = frame.write(&mut stream);
        let last_id = UInt31WithReserved::init(last_stream_id, false);
        let _ = last_id.write(&mut stream);
        let mut value: u32 = rst_code.0;
        value = value.swap_bytes();
        let _ = stream.write(&value.to_ne_bytes());

        let _ = self.write(&buffer);
        if !debug_data.is_empty() {
            let _ = self.write(debug_data);
        }
        let global = unsafe { &*self.handlers.global_object };
        let chunk = match self.handlers.binary_type.to_js(debug_data, global) {
            Ok(v) => v,
            Err(err) => {
                self.dispatch(JSH2FrameParser::Gc::onError, unsafe { &*self.global_this }.take_exception(err));
                return;
            }
        };

        if emit_error {
            if rst_code != ErrorCode::NO_ERROR {
                self.dispatch_with_2_extra(
                    JSH2FrameParser::Gc::onError,
                    JSValue::js_number(rst_code.0),
                    JSValue::js_number(self.last_stream_id),
                    chunk,
                );
            }
            self.dispatch_with_extra(JSH2FrameParser::Gc::onEnd, JSValue::js_number(self.last_stream_id), chunk);
        }
    }

    pub fn send_alt_svc(&mut self, stream_identifier: u32, origin_str: &[u8], alt: &[u8]) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_ALTSVC stream {} origin {} alt {}",
            stream_identifier, BStr::new(origin_str), BStr::new(alt)
        );

        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 2];
        let mut stream = FixedBufferStream::new(&mut buffer);

        let mut frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_ALTSVC as u8,
            flags: 0,
            stream_identifier,
            length: u32::try_from(origin_str.len() + alt.len() + 2).unwrap(),
        };
        let _ = frame.write(&mut stream);
        let _ = stream.write_int_u16_be(u16::try_from(origin_str.len()).unwrap());
        let _ = self.write(&buffer);
        if !origin_str.is_empty() {
            let _ = self.write(origin_str);
        }
        if !alt.is_empty() {
            let _ = self.write(alt);
        }
    }

    pub fn send_ping(&mut self, ack: bool, payload: &[u8]) {
        bun_output::scoped_log!(H2FrameParser, "HTTP_FRAME_PING ack {} payload {}", ack, BStr::new(payload));

        let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 8];
        let mut stream = FixedBufferStream::new(&mut buffer);
        if !ack {
            self.out_standing_pings += 1;
        }
        let mut frame = FrameHeader {
            type_: FrameType::HTTP_FRAME_PING as u8,
            flags: if ack { PingFrameFlags::ACK as u8 } else { 0 },
            stream_identifier: 0,
            length: 8,
        };
        let _ = frame.write(&mut stream);
        let _ = stream.write(payload);
        let _ = self.write(&buffer);
    }

    pub fn send_preface_and_settings(&mut self) {
        bun_output::scoped_log!(H2FrameParser, "sendPrefaceAndSettings");
        // PREFACE + Settings Frame
        let mut preface_buffer = [0u8; 24 + FrameHeader::BYTE_SIZE + FullSettingsPayload::BYTE_SIZE];
        let mut preface_stream = FixedBufferStream::new(&mut preface_buffer);
        let _ = preface_stream.write(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
        let mut settings_header = FrameHeader {
            type_: FrameType::HTTP_FRAME_SETTINGS as u8,
            flags: 0,
            stream_identifier: 0,
            length: FullSettingsPayload::BYTE_SIZE as u32,
        };
        self.outstanding_settings += 1;
        let _ = settings_header.write(&mut preface_stream);
        let _ = self.local_settings.write(&mut preface_stream);
        let _ = self.write(&preface_buffer);
    }

    pub fn send_settings_ack(&mut self) {
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

    pub fn send_window_update(&mut self, stream_identifier: u32, window_size: UInt31WithReserved) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_WINDOW_UPDATE stream {} size {}",
            stream_identifier, window_size.uint31()
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

    pub fn dispatch(&mut self, event: JSH2FrameParser::Gc, value: JSValue) {
        value.ensure_still_alive();
        let Some(this_value) = self.strong_this.try_get() else { return };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else { return };
        let _ = self.handlers.call_event_handler(event, this_value, ctx_value, &[ctx_value, value]);
    }

    pub fn call(&mut self, event: JSH2FrameParser::Gc, value: JSValue) -> JSValue {
        let Some(this_value) = self.strong_this.try_get() else { return JSValue::ZERO };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else { return JSValue::ZERO };
        value.ensure_still_alive();
        self.handlers.call_event_handler_with_result(event, this_value, &[ctx_value, value])
    }

    pub fn dispatch_write_callback(&mut self, callback: JSValue) {
        let _ = self.handlers.call_write_callback(callback, &[]);
    }

    pub fn dispatch_with_extra(&mut self, event: JSH2FrameParser::Gc, value: JSValue, extra: JSValue) {
        let Some(this_value) = self.strong_this.try_get() else { return };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else { return };
        value.ensure_still_alive();
        extra.ensure_still_alive();
        let _ = self.handlers.call_event_handler(event, this_value, ctx_value, &[ctx_value, value, extra]);
    }

    pub fn dispatch_with_2_extra(&mut self, event: JSH2FrameParser::Gc, value: JSValue, extra: JSValue, extra2: JSValue) {
        let Some(this_value) = self.strong_this.try_get() else { return };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else { return };
        value.ensure_still_alive();
        extra.ensure_still_alive();
        extra2.ensure_still_alive();
        let _ = self.handlers.call_event_handler(event, this_value, ctx_value, &[ctx_value, value, extra, extra2]);
    }

    pub fn dispatch_with_3_extra(
        &mut self,
        event: JSH2FrameParser::Gc,
        value: JSValue,
        extra: JSValue,
        extra2: JSValue,
        extra3: JSValue,
    ) {
        let Some(this_value) = self.strong_this.try_get() else { return };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else { return };
        value.ensure_still_alive();
        extra.ensure_still_alive();
        extra2.ensure_still_alive();
        extra3.ensure_still_alive();
        let _ = self.handlers.call_event_handler(event, this_value, ctx_value, &[ctx_value, value, extra, extra2, extra3]);
    }

    fn cork(&mut self) {
        if let Some(corked) = CORKED_H2.with(|c| c.get()) {
            if corked as usize == self as *mut _ as usize {
                // already corked
                return;
            }
            // force uncork
            unsafe { (*corked).uncork() };
        }
        // cork
        CORKED_H2.with(|c| c.set(Some(self as *mut _)));
        self.ref_();
        self.register_auto_flush();
        bun_output::scoped_log!(H2FrameParser, "cork {:p}", self);
        CORK_OFFSET.with(|c| c.set(0));
    }

    pub fn _generic_flush<S: NativeSocketWrite>(&mut self, socket: S) -> usize {
        let buffer_len = {
            let buffer = &self.write_buffer.slice()[self.write_buffer_offset..];
            buffer.len()
        };
        if buffer_len > 0 {
            let buffer = &self.write_buffer.slice()[self.write_buffer_offset..];
            let result: i32 = socket.write_maybe_corked(buffer);
            let written: u32 = if result < 0 { 0 } else { u32::try_from(result).unwrap() };

            if (written as usize) < buffer_len {
                self.write_buffer_offset += written as usize;
                bun_output::scoped_log!(H2FrameParser, "_genericFlush {}", written);
                return written as usize;
            }

            // all the buffer was written! reset things
            self.write_buffer_offset = 0;
            self.write_buffer.len = 0;
            // lets keep size under control
            if self.write_buffer.cap > MAX_BUFFER_SIZE {
                self.write_buffer.len = MAX_BUFFER_SIZE;
                self.write_buffer.shrink_and_free(MAX_BUFFER_SIZE);
                self.write_buffer.clear_retaining_capacity();
            }
            bun_output::scoped_log!(H2FrameParser, "_genericFlush {}", buffer_len);
        } else {
            bun_output::scoped_log!(H2FrameParser, "_genericFlush 0");
        }
        buffer_len
    }

    pub fn _generic_write<S: NativeSocketWrite>(&mut self, socket: S, bytes: &[u8]) -> bool {
        bun_output::scoped_log!(H2FrameParser, "_genericWrite {}", bytes.len());

        let global = unsafe { &*self.global_this };
        let buffered_len = self.write_buffer.slice()[self.write_buffer_offset..].len();
        if buffered_len > 0 {
            {
                let buffer = &self.write_buffer.slice()[self.write_buffer_offset..];
                let result: i32 = socket.write_maybe_corked(buffer);
                let written: u32 = if result < 0 { 0 } else { u32::try_from(result).unwrap() };
                if (written as usize) < buffered_len {
                    self.write_buffer_offset += written as usize;

                    // we still have more to buffer and even more now
                    let _ = self.write_buffer.write(bytes);
                    global.vm().deprecated_report_extra_memory(bytes.len());

                    bun_output::scoped_log!(H2FrameParser, "_genericWrite flushed {} and buffered more {}", written, bytes.len());
                    return false;
                }
            }
            // all the buffer was written!
            self.write_buffer_offset = 0;
            self.write_buffer.len = 0;
            {
                let result: i32 = socket.write_maybe_corked(bytes);
                let written: u32 = if result < 0 { 0 } else { u32::try_from(result).unwrap() };
                if (written as usize) < bytes.len() {
                    let pending = &bytes[written as usize..];
                    // ops not all data was sent, lets buffer again
                    let _ = self.write_buffer.write(pending);
                    global.vm().deprecated_report_extra_memory(pending.len());

                    bun_output::scoped_log!(H2FrameParser, "_genericWrite buffered more {}", pending.len());
                    return false;
                }
            }
            // lets keep size under control
            if self.write_buffer.cap > MAX_BUFFER_SIZE {
                self.write_buffer.len = MAX_BUFFER_SIZE;
                self.write_buffer.shrink_and_free(MAX_BUFFER_SIZE);
                self.write_buffer.clear_retaining_capacity();
            }
            return true;
        }
        let result: i32 = socket.write_maybe_corked(bytes);
        let written: u32 = if result < 0 { 0 } else { u32::try_from(result).unwrap() };
        if (written as usize) < bytes.len() {
            let pending = &bytes[written as usize..];
            // ops not all data was sent, lets buffer again
            let _ = self.write_buffer.write(pending);
            global.vm().deprecated_report_extra_memory(pending.len());
            return false;
        }
        true
    }

    /// be sure that we dont have any backpressure/data queued on writerBuffer before calling this
    fn flush_stream_queue(&mut self) -> usize {
        bun_output::scoped_log!(H2FrameParser, "flushStreamQueue {}", self.outbound_queue_size);
        let mut written: usize = 0;
        let mut something_was_flushed = true;

        // try to send as much as we can until we reach backpressure or until we can't flush anymore
        while self.outbound_queue_size > 0 && something_was_flushed {
            // PORT NOTE: reshaped for borrowck — StreamResumableIterator borrows self mutably
            let self_ptr = self as *mut Self;
            let mut it = StreamResumableIterator::init(unsafe { &mut *self_ptr });
            something_was_flushed = false;
            while let Some(stream) = it.next() {
                let stream = unsafe { &mut *stream };
                // reach backpressure
                let result = stream.flush_queue(unsafe { &mut *self_ptr }, &mut written);
                match result {
                    FlushState::Flushed => something_was_flushed = true,
                    FlushState::NoAction => continue, // we can continue
                    FlushState::Backpressure => return written, // backpressure we need to return
                }
            }
        }
        written
    }

    pub fn flush(&mut self) -> usize {
        bun_output::scoped_log!(H2FrameParser, "flush");
        self.ref_();
        let _g = scopeguard::guard((), |_| self.deref());
        // TODO(port): scopeguard borrows self; use raw deref pattern in Phase B
        let _ = scopeguard::ScopeGuard::into_inner(_g);

        self.uncork();
        let mut written = match self.native_socket {
            BunSocket::TlsWriteonly(socket) | BunSocket::Tls(socket) => {
                self._generic_flush(unsafe { &mut *socket })
            }
            BunSocket::TcpWriteonly(socket) | BunSocket::Tcp(socket) => {
                self._generic_flush(unsafe { &mut *socket })
            }
            BunSocket::None => {
                // consider that backpressure is gone and flush data queue
                self.has_nonnative_backpressure = false;
                let bytes_len = self.write_buffer.slice().len();
                if bytes_len > 0 {
                    let global = unsafe { &*self.handlers.global_object };
                    let output_value = self.handlers.binary_type.to_js(self.write_buffer.slice(), global).unwrap_or(JSValue::ZERO);
                    // TODO: properly propagate exception upwards
                    let result = self.call(JSH2FrameParser::Gc::onWrite, output_value);

                    // defer block
                    self.write_buffer_offset = 0;
                    self.write_buffer.len = 0;
                    if self.write_buffer.cap > MAX_BUFFER_SIZE {
                        self.write_buffer.len = MAX_BUFFER_SIZE;
                        self.write_buffer.shrink_and_free(MAX_BUFFER_SIZE);
                        self.write_buffer.clear_retaining_capacity();
                    }

                    if result.is_boolean() && !result.to_boolean() {
                        self.has_nonnative_backpressure = true;
                        self.deref();
                        return bytes_len;
                    }
                }

                let r = self.flush_stream_queue();
                self.deref();
                return r;
            }
        };
        // if no backpressure flush data queue
        if !self.has_backpressure() {
            written += self.flush_stream_queue();
        }
        self.deref();
        written
    }

    pub fn _write(&mut self, bytes: &[u8]) -> bool {
        self.ref_();
        let result = match self.native_socket {
            BunSocket::TlsWriteonly(socket) | BunSocket::Tls(socket) => {
                self._generic_write(unsafe { &mut *socket }, bytes)
            }
            BunSocket::TcpWriteonly(socket) | BunSocket::Tcp(socket) => {
                self._generic_write(unsafe { &mut *socket }, bytes)
            }
            BunSocket::None => {
                let global = unsafe { &*self.global_this };
                if self.has_nonnative_backpressure {
                    // we should not invoke JS when we have backpressure is cheaper to keep it queued here
                    let _ = self.write_buffer.write(bytes);
                    global.vm().deprecated_report_extra_memory(bytes.len());
                    self.deref();
                    return false;
                }
                // fallback to onWrite non-native callback
                let output_value = self.handlers.binary_type.to_js(bytes, unsafe { &*self.handlers.global_object }).unwrap_or(JSValue::ZERO);
                // TODO: properly propagate exception upwards
                let result = self.call(JSH2FrameParser::Gc::onWrite, output_value);
                let code = if result.is_number() { result.to::<i32>() } else { -1 };
                let r = match code {
                    -1 => {
                        // dropped
                        let _ = self.write_buffer.write(bytes);
                        global.vm().deprecated_report_extra_memory(bytes.len());
                        self.has_nonnative_backpressure = true;
                        false
                    }
                    0 => {
                        // queued
                        self.has_nonnative_backpressure = true;
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
        self.write_buffer.len > 0 || self.has_nonnative_backpressure
    }

    fn uncork(&mut self) {
        if let Some(corked) = CORKED_H2.with(|c| c.get()) {
            let corked = unsafe { &mut *corked };
            corked.unregister_auto_flush();
            bun_output::scoped_log!(H2FrameParser, "uncork {:p}", corked);

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

    fn register_auto_flush(&mut self) {
        if self.auto_flusher.registered {
            return;
        }
        self.ref_();
        AutoFlusher::register_deferred_microtask_with_type_unchecked::<H2FrameParser>(
            self,
            unsafe { &*self.global_this }.bun_vm(),
        );
    }

    fn unregister_auto_flush(&mut self) {
        if !self.auto_flusher.registered {
            return;
        }
        AutoFlusher::unregister_deferred_microtask_with_type_unchecked::<H2FrameParser>(
            self,
            unsafe { &*self.global_this }.bun_vm(),
        );
        self.deref();
    }

    pub fn on_auto_flush(&mut self) -> bool {
        self.ref_();
        let _ = self.flush();
        self.deref();
        // we will unregister ourselves when the buffer is empty
        true
    }

    pub fn write(&mut self, bytes: &[u8]) -> bool {
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

struct Payload<'a> {
    data: &'a [u8],
    end: usize,
}

/// Trait to abstract over TLSSocket / TCPSocket for `_generic_flush`/`_generic_write`.
pub trait NativeSocketWrite {
    fn write_maybe_corked(&self, buf: &[u8]) -> i32;
}
impl NativeSocketWrite for &mut TLSSocket {
    fn write_maybe_corked(&self, buf: &[u8]) -> i32 {
        // TODO(port): forward to TLSSocket.writeMaybeCorked
        TLSSocket::write_maybe_corked(self, buf)
    }
}
impl NativeSocketWrite for &mut TCPSocket {
    fn write_maybe_corked(&self, buf: &[u8]) -> i32 {
        TCPSocket::write_maybe_corked(self, buf)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — frame handlers
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    // Default handling for payload is buffering it
    // for data frames we use another strategy
    pub fn handle_incomming_payload<'a>(&'a mut self, data: &'a [u8], stream_identifier: u32) -> Option<Payload<'a>> {
        let end: usize = (self.remaining_length as usize).min(data.len());
        let payload = &data[0..end];
        self.remaining_length -= i32::try_from(end).unwrap();
        if self.remaining_length > 0 {
            // buffer more data
            let _ = self.read_buffer.append_slice(payload);
            unsafe { &*self.global_this }.vm().deprecated_report_extra_memory(payload.len());
            return None;
        } else if self.remaining_length < 0 {
            self.send_go_away(stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"Invalid frame size", self.last_stream_id, true);
            return None;
        }

        self.current_frame = None;

        if !self.read_buffer.list.is_empty() {
            // return buffered data
            let _ = self.read_buffer.append_slice(payload);
            unsafe { &*self.global_this }.vm().deprecated_report_extra_memory(payload.len());

            return Some(Payload {
                data: self.read_buffer.list.as_slice(),
                end,
            });
        }

        Some(Payload { data: payload, end })
    }

    pub fn handle_window_update_frame(&mut self, frame: FrameHeader, data: &[u8], stream: Option<*mut Stream>) -> usize {
        bun_output::scoped_log!(H2FrameParser, "handleWindowUpdateFrame {}", frame.stream_identifier);
        // must be always 4 bytes (https://datatracker.ietf.org/doc/html/rfc7540#section-6.9)
        if frame.length != 4 {
            self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"Invalid dataframe frame size", self.last_stream_id, true);
            return data.len();
        }

        // PORT NOTE: reshaped for borrowck — handle_incomming_payload borrows self
        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data;
            let window_size_increment = UInt31WithReserved::from_bytes(payload);
            let end = content.end;
            self.read_buffer.reset();
            if let Some(s) = stream {
                unsafe { (*s).remote_window_size += window_size_increment.uint31() as u64 };
            } else {
                self.remote_window_size += window_size_increment.uint31() as u64;
            }
            bun_output::scoped_log!(H2FrameParser, "windowSizeIncrement stream {} value {}", frame.stream_identifier, window_size_increment.uint31());
            // at this point we try to send more data because we received a window update
            let _ = self.flush();
            return end;
        }
        // needs more data
        data.len()
    }

    pub fn decode_header_block(&mut self, payload: &[u8], stream: &mut Stream, flags: u8) -> JsResult<Option<*mut Stream>> {
        bun_output::scoped_log!(H2FrameParser, "decodeHeaderBlock isSever: {}", self.is_server);

        let mut offset: usize = 0;
        let global_object = unsafe { &*self.handlers.global_object };
        if self.handlers.vm.is_shutting_down() {
            return Ok(None);
        }

        let stream_id = stream.id;
        let headers = JSValue::create_empty_array(global_object, 0)?;
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
            bun_output::scoped_log!(H2FrameParser, "header {} {}", BStr::new(header.name), BStr::new(header.value));
            if self.is_server && header.name == b":status" {
                self.send_go_away(stream_id, ErrorCode::PROTOCOL_ERROR, b"Server received :status header", self.last_stream_id, true);
                return Ok(self.streams.get(&stream_id).copied());
            }

            // RFC 7540 Section 6.5.2: Calculate header list size
            // Size = name length + value length + HPACK entry overhead per header
            header_list_size += header.name.len() + header.value.len() + HPACK_ENTRY_OVERHEAD;

            // Check against maxHeaderListSize setting
            if header_list_size > self.local_settings.max_header_list_size as usize {
                self.rejected_streams += 1;
                if self.max_rejected_streams <= self.rejected_streams {
                    self.send_go_away(stream_id, ErrorCode::ENHANCE_YOUR_CALM, b"ENHANCE_YOUR_CALM", self.last_stream_id, true);
                } else {
                    self.end_stream(stream, ErrorCode::ENHANCE_YOUR_CALM);
                }
                return Ok(self.streams.get(&stream_id).copied());
            }

            count += 1;
            if (self.max_header_list_pairs as usize) < count {
                self.rejected_streams += 1;
                if self.max_rejected_streams <= self.rejected_streams {
                    self.send_go_away(stream_id, ErrorCode::ENHANCE_YOUR_CALM, b"ENHANCE_YOUR_CALM", self.last_stream_id, true);
                } else {
                    self.end_stream(stream, ErrorCode::ENHANCE_YOUR_CALM);
                }
                return Ok(self.streams.get(&stream_id).copied());
            }

            if let Some(js_header_name) = get_http2_common_string(global_object, header.well_know) {
                headers.push(global_object, js_header_name)?;
                headers.push(global_object, BunString::create_utf8_for_js(global_object, header.value)?)?;
                if header.never_index {
                    if sensitive_headers.is_undefined() {
                        sensitive_headers = JSValue::create_empty_array(global_object, 0)?;
                        sensitive_headers.ensure_still_alive();
                    }
                    sensitive_headers.push(global_object, js_header_name)?;
                }
            } else {
                let js_header_name = BunString::create_utf8_for_js(global_object, header.name)?;
                let js_header_value = BunString::create_utf8_for_js(global_object, header.value)?;

                if header.never_index {
                    if sensitive_headers.is_undefined() {
                        sensitive_headers = JSValue::create_empty_array(global_object, 0)?;
                        sensitive_headers.ensure_still_alive();
                    }
                    sensitive_headers.push(global_object, js_header_name)?;
                }

                headers.push(global_object, js_header_name)?;
                headers.push(global_object, js_header_value)?;

                js_header_name.ensure_still_alive();
                js_header_value.ensure_still_alive();
            }

            if offset >= payload.len() {
                break;
            }
        }

        self.dispatch_with_3_extra(JSH2FrameParser::Gc::onStreamHeaders, stream.get_identifier(), headers, sensitive_headers, JSValue::js_number(flags));
        Ok(self.streams.get(&stream_id).copied())
    }

    pub fn handle_data_frame(&mut self, frame: FrameHeader, data: &[u8], stream_: Option<*mut Stream>) -> usize {
        bun_output::scoped_log!(H2FrameParser, "handleDataFrame {} data.len: {}", if self.is_server { "server" } else { "client" }, data.len());
        self.read_buffer.reset();

        let Some(stream_ptr) = stream_ else {
            bun_output::scoped_log!(H2FrameParser, "received data frame on stream that does not exist");
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Data frame on connection stream", self.last_stream_id, true);
            return data.len();
        };
        let mut stream = unsafe { &mut *stream_ptr };

        let settings = self.remote_settings.unwrap_or(self.local_settings);

        if frame.length > settings.max_frame_size {
            bun_output::scoped_log!(H2FrameParser, "received data frame with length: {} and max frame size: {}", frame.length, settings.max_frame_size);
            self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"Invalid dataframe frame size", self.last_stream_id, true);
            return data.len();
        }

        let end: usize = (self.remaining_length as usize).min(data.len());
        let mut payload = &data[0..end];
        // window size considering the full frame.length received so far
        self.adjust_window_size(Some(stream), payload.len() as u32);
        // PORT NOTE: re-borrow stream after adjust_window_size took &mut
        stream = unsafe { &mut *stream_ptr };
        let previous_remaining_length: isize = self.remaining_length as isize;

        self.remaining_length -= i32::try_from(end).unwrap();
        let mut padding: u8 = 0;
        let padded = frame.flags & DataFrameFlags::PADDED as u8 != 0;
        if padded {
            if frame.length < 1 {
                // PADDED flag set but no room for the Pad Length octet
                self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"Invalid data frame size", self.last_stream_id, true);
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
                self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Invalid data frame padding", self.last_stream_id, true);
                return data.len();
            }
        }
        if self.remaining_length < 0 {
            self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"Invalid data frame size", self.last_stream_id, true);
            return data.len();
        }
        let mut emitted = false;

        let start_idx = frame.length as usize - previous_remaining_length as usize;
        if start_idx < 1 && padded && !payload.is_empty() {
            // Skip the Pad Length octet. Keyed on the PADDED flag rather than
            // `padding > 0` because Pad Length = 0 is valid (RFC 7540 Section 6.1)
            // and must still be stripped.
            payload = &payload[1..];
        }

        if !payload.is_empty() {
            // amount of data received so far
            let received_size = frame.length as i32 - self.remaining_length;
            let data_region_end: usize = frame.length as usize - padding as usize;
            let data_region_start: usize = if padded { start_idx.max(1) } else { start_idx };
            let max_payload_size: usize = data_region_end.saturating_sub(data_region_start);
            payload = &payload[0..payload.len().min(max_payload_size)];
            bun_output::scoped_log!(
                H2FrameParser,
                "received_size: {} max_payload_size: {} padding: {} payload.len: {}",
                received_size, max_payload_size, padding, payload.len()
            );

            if !payload.is_empty() {
                // no padding, just emit the data
                let global = unsafe { &*self.handlers.global_object };
                let chunk = self.handlers.binary_type.to_js(payload, global).unwrap_or(JSValue::ZERO);
                // TODO: properly propagate exception upwards
                self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamData, stream.get_identifier(), chunk);
                emitted = true;
            }
        }
        if self.remaining_length == 0 {
            self.current_frame = None;
            stream.padding = None;
            if emitted {
                stream = match self.streams.get(&frame.stream_identifier).copied() {
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
                self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, JSValue::js_number(stream.state as u8));
            }
        }

        end
    }

    pub fn handle_go_away_frame(&mut self, frame: FrameHeader, data: &[u8], stream_: Option<*mut Stream>) -> usize {
        bun_output::scoped_log!(H2FrameParser, "handleGoAwayFrame {} {}", frame.stream_identifier, BStr::new(data));
        if stream_.is_some() {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"GoAway frame on stream", self.last_stream_id, true);
            return data.len();
        }
        let settings = self.remote_settings.unwrap_or(self.local_settings);

        if frame.length < 8 || frame.length > settings.max_frame_size {
            self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid GoAway frame size", self.last_stream_id, true);
            return data.len();
        }

        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data;
            let error_code = u32_from_bytes(&payload[4..8]);
            let global = unsafe { &*self.handlers.global_object };
            let chunk = self.handlers.binary_type.to_js(&payload[8..], global).unwrap_or(JSValue::ZERO);
            // TODO: properly propagate exception upwards
            let end = content.end;
            self.read_buffer.reset();
            self.dispatch_with_2_extra(JSH2FrameParser::Gc::onGoAway, JSValue::js_number(error_code), JSValue::js_number(self.last_stream_id), chunk);
            return end;
        }
        data.len()
    }

    fn string_or_empty_to_js(&self, payload: &[u8]) -> JsResult<JSValue> {
        let global = unsafe { &*self.handlers.global_object };
        if payload.is_empty() {
            return Ok(BunString::empty().to_js(global));
        }
        BunString::create_utf8_for_js(global, payload)
    }

    pub fn handle_origin_frame(&mut self, frame: FrameHeader, data: &[u8], _: Option<*mut Stream>) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "handleOriginFrame {}", BStr::new(data));
        if self.is_server {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"ORIGIN frame on server", self.last_stream_id, true);
            return Ok(data.len());
        }
        if frame.stream_identifier != 0 {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"ORIGIN frame on stream", self.last_stream_id, true);
            return Ok(data.len());
        }
        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let mut payload = content.data;
            let mut origin_value: JSValue = JSValue::UNDEFINED;
            let mut count: usize = 0;
            let end = content.end;
            self.read_buffer.reset();

            let global = unsafe { &*self.handlers.global_object };
            while !payload.is_empty() {
                // TODO(port): fixedBufferStream over const slice for reading u16 BE
                if payload.len() < 2 {
                    bun_output::scoped_log!(H2FrameParser, "error reading ORIGIN frame size: short read");
                    self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid ORIGIN frame size", self.last_stream_id, true);
                    return Ok(end);
                }
                let origin_length = u16::from_be_bytes([payload[0], payload[1]]) as usize;
                let mut origin_str = &payload[2..];
                if origin_str.len() < origin_length {
                    self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid ORIGIN frame size", self.last_stream_id, true);
                    return Ok(end);
                }
                origin_str = &origin_str[0..origin_length];
                if count == 0 {
                    origin_value = self.string_or_empty_to_js(origin_str)?;
                    origin_value.ensure_still_alive();
                } else if count == 1 {
                    // need to create an array
                    let array = JSValue::create_empty_array(global, 0)?;
                    array.ensure_still_alive();
                    array.push(global, origin_value)?;
                    array.push(global, self.string_or_empty_to_js(origin_str)?)?;
                    origin_value = array;
                } else {
                    // we already have an array, just add the origin to it
                    origin_value.push(global, self.string_or_empty_to_js(origin_str)?)?;
                }
                count += 1;
                payload = &payload[origin_length + 2..];
            }

            self.dispatch(JSH2FrameParser::Gc::onOrigin, origin_value);
            return Ok(end);
        }
        Ok(data.len())
    }

    pub fn handle_altsvc_frame(&mut self, frame: FrameHeader, data: &[u8], stream_: Option<*mut Stream>) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "handleAltsvcFrame {}", BStr::new(data));
        if self.is_server {
            // client should not send ALTSVC frame
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"ALTSVC frame on server", self.last_stream_id, true);
            return Ok(data.len());
        }
        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data;
            let end = content.end;
            self.read_buffer.reset();

            if payload.len() < 2 {
                self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid ALTSVC frame size", self.last_stream_id, true);
                return Ok(end);
            }
            let origin_length = u16::from_be_bytes([payload[0], payload[1]]) as usize;
            let origin_and_value = &payload[2..];

            if origin_and_value.len() < origin_length {
                self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid ALTSVC frame size", self.last_stream_id, true);
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
                JSValue::js_number(frame.stream_identifier),
            );
            return Ok(end);
        }
        Ok(data.len())
    }

    pub fn handle_rst_stream_frame(&mut self, frame: FrameHeader, data: &[u8], stream_: Option<*mut Stream>) -> usize {
        bun_output::scoped_log!(H2FrameParser, "handleRSTStreamFrame {}", BStr::new(data));
        let Some(stream_ptr) = stream_ else {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"RST_STREAM frame on connection stream", self.last_stream_id, true);
            return data.len();
        };
        let stream = unsafe { &mut *stream_ptr };

        if frame.length != 4 {
            self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid RST_STREAM frame size", self.last_stream_id, true);
            return data.len();
        }

        if stream.is_waiting_more_headers {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Headers frame without continuation", self.last_stream_id, true);
            return data.len();
        }

        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data;
            let rst_code = u32_from_bytes(payload);
            stream.rst_code = rst_code;
            let end = content.end;
            self.read_buffer.reset();
            stream.state = StreamState::CLOSED;
            let identifier = stream.get_identifier();
            identifier.ensure_still_alive();
            stream.free_resources::<false>(self);
            if rst_code == ErrorCode::NO_ERROR.0 {
                self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, JSValue::js_number(stream.state as u8));
            } else {
                self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, identifier, JSValue::js_number(rst_code));
            }
            return end;
        }
        data.len()
    }

    pub fn handle_ping_frame(&mut self, frame: FrameHeader, data: &[u8], stream_: Option<*mut Stream>) -> usize {
        if stream_.is_some() {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Ping frame on stream", self.last_stream_id, true);
            return data.len();
        }

        if frame.length != 8 {
            self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"Invalid ping frame size", self.last_stream_id, true);
            return data.len();
        }

        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data;
            let is_not_ack = frame.flags & PingFrameFlags::ACK as u8 == 0;
            let end = content.end;
            // PORT NOTE: read_buffer.reset() must come AFTER reads of payload (may borrow it)
            // but Zig calls it before send_ping; safe because Zig copies payload into output frame.
            // Keep behavior; need to materialize payload if it points into read_buffer.
            // TODO(port): verify aliasing of payload vs read_buffer in Phase B
            let payload_owned = payload.to_vec();
            self.read_buffer.reset();

            // if is not ACK send response
            if is_not_ack {
                self.send_ping(true, &payload_owned);
            } else {
                self.out_standing_pings = self.out_standing_pings.saturating_sub(1);
            }
            let global = unsafe { &*self.handlers.global_object };
            let buffer = self.handlers.binary_type.to_js(&payload_owned, global).unwrap_or(JSValue::ZERO);
            // TODO: properly propagate exception upwards
            self.dispatch_with_extra(JSH2FrameParser::Gc::onPing, buffer, JSValue::from(!is_not_ack));
            return end;
        }
        data.len()
    }

    pub fn handle_priority_frame(&mut self, frame: FrameHeader, data: &[u8], stream_: Option<*mut Stream>) -> usize {
        let Some(stream_ptr) = stream_ else {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Priority frame on connection stream", self.last_stream_id, true);
            return data.len();
        };
        let stream = unsafe { &mut *stream_ptr };

        if frame.length as usize != StreamPriority::BYTE_SIZE {
            self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid Priority frame size", self.last_stream_id, true);
            return data.len();
        }

        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data;
            let end = content.end;

            let mut priority = StreamPriority::default();
            StreamPriority::from(&mut priority, payload);
            self.read_buffer.reset();

            let stream_identifier = UInt31WithReserved::from(priority.stream_identifier);
            if stream_identifier.uint31() == stream.id {
                self.send_go_away(stream.id, ErrorCode::PROTOCOL_ERROR, b"Priority frame with self dependency", self.last_stream_id, true);
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
    pub fn handle_continuation_frame(&mut self, frame: FrameHeader, data: &[u8], stream_: Option<*mut Stream>) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "handleContinuationFrame");
        let Some(stream_ptr) = stream_ else {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Continuation on connection stream", self.last_stream_id, true);
            return Ok(data.len());
        };
        let mut stream = unsafe { &mut *stream_ptr };

        if !stream.is_waiting_more_headers {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Continuation without headers", self.last_stream_id, true);
            return Ok(data.len());
        }
        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data;
            let end = content.end;
            // TODO(port): payload may borrow read_buffer; reset moved after decode in Phase B if needed
            unsafe { &mut *self_ptr }.read_buffer.reset();
            stream.end_after_headers = frame.flags & HeadersFrameFlags::END_STREAM as u8 != 0;
            stream = match self.decode_header_block(payload, stream, frame.flags)? {
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
                    self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, JSValue::js_number(stream.state as u8));
                }
            }
            return Ok(end);
        }

        // needs more data
        Ok(data.len())
    }

    pub fn handle_headers_frame(&mut self, frame: FrameHeader, data: &[u8], stream_: Option<*mut Stream>) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "handleHeadersFrame {}", if self.is_server { "server" } else { "client" });
        let Some(stream_ptr) = stream_ else {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Headers frame on connection stream", self.last_stream_id, true);
            return Ok(data.len());
        };
        let mut stream = unsafe { &mut *stream_ptr };

        let settings = self.remote_settings.unwrap_or(self.local_settings);
        if frame.length > settings.max_frame_size {
            self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid Headers frame size", self.last_stream_id, true);
            return Ok(data.len());
        }

        if stream.is_waiting_more_headers {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Headers frame without continuation", self.last_stream_id, true);
            return Ok(data.len());
        }

        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let payload = content.data;
            let mut offset: usize = 0;
            let mut padding: usize = 0;
            let end_ = content.end;
            unsafe { &mut *self_ptr }.read_buffer.reset();

            if frame.flags & HeadersFrameFlags::PADDED as u8 != 0 {
                if payload.len() < 1 {
                    self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid Headers frame size", self.last_stream_id, true);
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
                self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"invalid Headers frame size", self.last_stream_id, true);
                return Ok(end_);
            }
            if padding > payload.len() - offset {
                self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"invalid Headers frame padding", self.last_stream_id, true);
                return Ok(end_);
            }
            let end = payload.len() - padding;
            stream.end_after_headers = frame.flags & HeadersFrameFlags::END_STREAM as u8 != 0;
            stream = match self.decode_header_block(&payload[offset..end], stream, frame.flags)? {
                Some(s) => unsafe { &mut *s },
                None => return Ok(end_),
            };
            stream.is_waiting_more_headers = frame.flags & HeadersFrameFlags::END_HEADERS as u8 == 0;
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
                self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, JSValue::js_number(stream.state as u8));
            }
            return Ok(end_);
        }

        // needs more data
        Ok(data.len())
    }

    pub fn handle_settings_frame(&mut self, frame: FrameHeader, data: &[u8]) -> usize {
        let is_ack = frame.flags & SettingsFlags::ACK as u8 != 0;

        bun_output::scoped_log!(H2FrameParser, "handleSettingsFrame {} isACK {}", if self.is_server { "server" } else { "client" }, is_ack);
        if frame.stream_identifier != 0 {
            self.send_go_away(frame.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Settings frame on connection stream", self.last_stream_id, true);
            return data.len();
        }
        // defer if (!isACK) this.sendSettingsACK();
        let send_ack_on_exit = !is_ack;

        let setting_byte_size = SettingsPayloadUnit::BYTE_SIZE;
        if frame.length > 0 {
            if is_ack || frame.length as usize % setting_byte_size != 0 {
                bun_output::scoped_log!(H2FrameParser, "invalid settings frame size");
                self.send_go_away(frame.stream_identifier, ErrorCode::FRAME_SIZE_ERROR, b"Invalid settings frame size", self.last_stream_id, true);
                if send_ack_on_exit { self.send_settings_ack(); }
                return data.len();
            }
        } else {
            if is_ack {
                // we received an ACK
                bun_output::scoped_log!(H2FrameParser, "settings frame ACK");

                // we can now write any request
                if self.outstanding_settings > 0 {
                    self.outstanding_settings -= 1;

                    // Per RFC 7540 Section 6.9.2: When INITIAL_WINDOW_SIZE changes, adjust
                    // all existing stream windows by the difference.
                    if self.outstanding_settings == 0 && self.local_settings.initial_window_size as u64 != DEFAULT_WINDOW_SIZE {
                        let old_size: i64 = DEFAULT_WINDOW_SIZE as i64;
                        let new_size: i64 = self.local_settings.initial_window_size as i64;
                        let delta = new_size - old_size;
                        for (_, item) in self.streams.iter() {
                            let stream = unsafe { &mut **item };
                            if delta >= 0 {
                                stream.window_size = stream.window_size.saturating_add(delta as u64);
                            } else {
                                stream.window_size = stream.window_size.saturating_sub((-delta) as u64);
                            }
                        }
                        bun_output::scoped_log!(H2FrameParser, "adjusted stream windows by delta {} (old: {}, new: {})", delta, old_size, new_size);
                    }
                }

                let global = unsafe { &*self.handlers.global_object };
                self.dispatch(JSH2FrameParser::Gc::onLocalSettings, self.local_settings.to_js(global));
            } else {
                bun_output::scoped_log!(H2FrameParser, "empty settings has remoteSettings? {}", self.remote_settings.is_some());
                if self.remote_settings.is_none() {
                    // ok empty settings so default settings
                    let remote_settings = FullSettingsPayload::default();
                    self.remote_settings = Some(remote_settings);
                    bun_output::scoped_log!(H2FrameParser, "remoteSettings.initialWindowSize: {} {} {}", remote_settings.initial_window_size, self.remote_used_window_size, self.remote_window_size);

                    if remote_settings.initial_window_size as u64 >= self.remote_window_size {
                        for (_, item) in self.streams.iter() {
                            let stream = unsafe { &mut **item };
                            if remote_settings.initial_window_size as u64 >= stream.remote_window_size {
                                stream.remote_window_size = remote_settings.initial_window_size as u64;
                            }
                        }
                    }
                    let global = unsafe { &*self.handlers.global_object };
                    self.dispatch(JSH2FrameParser::Gc::onRemoteSettings, remote_settings.to_js(global));
                }
                // defer chain (reverse order)
                self.increment_window_size_if_needed();
                let _ = self.flush();
            }

            self.current_frame = None;
            if send_ack_on_exit { self.send_settings_ack(); }
            return 0;
        }
        let self_ptr = self as *mut Self;
        if let Some(content) = unsafe { &mut *self_ptr }.handle_incomming_payload(data, frame.stream_identifier) {
            let mut remote_settings: FullSettingsPayload = self.remote_settings.unwrap_or_default();
            let mut i: usize = 0;
            let payload = content.data;
            while i < payload.len() {
                let mut unit: SettingsPayloadUnit = unsafe { core::mem::zeroed() };
                SettingsPayloadUnit::from::<true>(&mut unit, &payload[i..i + setting_byte_size], 0);
                remote_settings.update_with(unit);
                bun_output::scoped_log!(H2FrameParser, "remoteSettings: {} {} isServer: {}", unit.type_, unit.value, self.is_server);
                i += setting_byte_size;
            }
            let end = content.end;
            self.read_buffer.reset();
            self.remote_settings = Some(remote_settings);
            bun_output::scoped_log!(H2FrameParser, "remoteSettings.initialWindowSize: {} {} {}", remote_settings.initial_window_size, self.remote_used_window_size, self.remote_window_size);
            if remote_settings.initial_window_size as u64 >= self.remote_window_size {
                for (_, item) in self.streams.iter() {
                    let stream = unsafe { &mut **item };
                    if remote_settings.initial_window_size as u64 >= stream.remote_window_size {
                        stream.remote_window_size = remote_settings.initial_window_size as u64;
                    }
                }
            }
            let global = unsafe { &*self.handlers.global_object };
            self.dispatch(JSH2FrameParser::Gc::onRemoteSettings, remote_settings.to_js(global));
            // defer chain
            self.increment_window_size_if_needed();
            let _ = self.flush();
            if send_ack_on_exit { self.send_settings_ack(); }
            return end;
        }
        // needs more data
        if send_ack_on_exit { self.send_settings_ack(); }
        data.len()
    }

    /// Returned *Stream is heap-allocated and stable for the lifetime of this H2FrameParser.
    fn handle_received_stream_id(&mut self, stream_identifier: u32) -> Option<*mut Stream> {
        // connection stream
        if stream_identifier == 0 {
            return None;
        }

        // already exists
        if let Some(stream) = self.streams.get(&stream_identifier).copied() {
            return Some(stream);
        }

        if stream_identifier > self.last_stream_id {
            self.last_stream_id = stream_identifier;
        }

        // new stream open
        let local_window_size = if self.outstanding_settings > 0 {
            DEFAULT_WINDOW_SIZE as u32
        } else {
            self.local_settings.initial_window_size
        };
        let stream = Box::into_raw(Box::new(Stream::init(
            stream_identifier,
            local_window_size,
            self.remote_settings.map(|s| s.initial_window_size).unwrap_or(DEFAULT_WINDOW_SIZE as u32),
            self.padding_strategy,
        )));
        self.streams.put(stream_identifier, stream);

        let Some(this_value) = self.strong_this.try_get() else { return Some(stream) };
        let Some(ctx_value) = JSH2FrameParser::Gc::context.get(this_value) else { return Some(stream) };
        let Some(callback) = JSH2FrameParser::Gc::onStreamStart.get(this_value) else { return Some(stream) };

        let global = unsafe { &*self.handlers.global_object };
        if let Err(err) = callback.call(global, ctx_value, &[ctx_value, JSValue::js_number(stream_identifier)]) {
            global.report_active_exception_as_unhandled(err);
        }
        Some(stream)
    }

    fn read_bytes(&mut self, bytes: &[u8]) -> JsResult<usize> {
        bun_output::scoped_log!(H2FrameParser, "read {}", bytes.len());
        if self.is_server && self.preface_received_len < 24 {
            // Handle Server Preface
            let preface_missing: usize = 24 - self.preface_received_len as usize;
            let preface_available = preface_missing.min(bytes.len());
            let expected = &b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"[self.preface_received_len as usize..preface_available + self.preface_received_len as usize];
            if bytes[0..preface_available] != *expected {
                // invalid preface
                bun_output::scoped_log!(H2FrameParser, "invalid preface");
                self.send_go_away(0, ErrorCode::PROTOCOL_ERROR, b"Invalid preface", self.last_stream_id, true);
                return Ok(preface_available);
            }
            self.preface_received_len += u8::try_from(preface_available).unwrap();
            return Ok(preface_available);
        }
        if let Some(header) = self.current_frame {
            bun_output::scoped_log!(
                H2FrameParser,
                "current frame {} {} {} {} {}",
                if self.is_server { "server" } else { "client" },
                header.type_, header.length, header.flags, header.stream_identifier
            );

            let stream = self.handle_received_stream_id(header.stream_identifier);
            return self.dispatch_frame(header, bytes, stream, 0);
        }

        // nothing to do
        if bytes.is_empty() {
            return Ok(bytes.len());
        }

        let buffered_data = self.read_buffer.list.len();

        let mut header = FrameHeader { flags: 0, ..Default::default() };
        // we can have less than 9 bytes buffered
        if buffered_data > 0 {
            let total = buffered_data + bytes.len();
            if total < FrameHeader::BYTE_SIZE {
                // buffer more data
                let _ = self.read_buffer.append_slice(bytes);
                unsafe { &*self.global_this }.vm().deprecated_report_extra_memory(bytes.len());
                return Ok(bytes.len());
            }
            FrameHeader::from::<false>(&mut header, &self.read_buffer.list[0..buffered_data], 0);
            let needed = FrameHeader::BYTE_SIZE - buffered_data;
            FrameHeader::from::<true>(&mut header, &bytes[0..needed], buffered_data);
            // ignore the reserved bit
            let id = UInt31WithReserved::from(header.stream_identifier);
            header.stream_identifier = id.uint31();
            // reset for later use
            self.read_buffer.reset();

            self.current_frame = Some(header);
            self.remaining_length = header.length as i32;
            bun_output::scoped_log!(H2FrameParser, "new frame {} {} {} {}", header.type_, header.length, header.flags, header.stream_identifier);
            let stream = self.handle_received_stream_id(header.stream_identifier);

            return self.dispatch_frame(header, &bytes[needed..], stream, needed);
        }

        if bytes.len() < FrameHeader::BYTE_SIZE {
            // buffer more dheaderata
            let _ = self.read_buffer.append_slice(bytes);
            unsafe { &*self.global_this }.vm().deprecated_report_extra_memory(bytes.len());
            return Ok(bytes.len());
        }

        FrameHeader::from::<true>(&mut header, &bytes[0..FrameHeader::BYTE_SIZE], 0);

        bun_output::scoped_log!(
            H2FrameParser,
            "new frame {} {} {} {} {}",
            if self.is_server { "server" } else { "client" },
            header.type_, header.length, header.flags, header.stream_identifier
        );
        self.current_frame = Some(header);
        self.remaining_length = header.length as i32;
        let stream = self.handle_received_stream_id(header.stream_identifier);
        self.dispatch_frame(header, &bytes[FrameHeader::BYTE_SIZE..], stream, FrameHeader::BYTE_SIZE)
    }

    // PORT NOTE: hoisted from three identical switch blocks in read_bytes for borrowck/DRY.
    // The `add` parameter is the number of bytes already consumed before `bytes` (0, `needed`, or BYTE_SIZE).
    fn dispatch_frame(&mut self, header: FrameHeader, bytes: &[u8], stream: Option<*mut Stream>, add: usize) -> JsResult<usize> {
        Ok(match header.type_ {
            x if x == FrameType::HTTP_FRAME_SETTINGS as u8 => self.handle_settings_frame(header, bytes) + add,
            x if x == FrameType::HTTP_FRAME_WINDOW_UPDATE as u8 => self.handle_window_update_frame(header, bytes, stream) + add,
            x if x == FrameType::HTTP_FRAME_HEADERS as u8 => self.handle_headers_frame(header, bytes, stream)? + add,
            x if x == FrameType::HTTP_FRAME_DATA as u8 => self.handle_data_frame(header, bytes, stream) + add,
            x if x == FrameType::HTTP_FRAME_CONTINUATION as u8 => self.handle_continuation_frame(header, bytes, stream)? + add,
            x if x == FrameType::HTTP_FRAME_PRIORITY as u8 => self.handle_priority_frame(header, bytes, stream) + add,
            x if x == FrameType::HTTP_FRAME_PING as u8 => self.handle_ping_frame(header, bytes, stream) + add,
            x if x == FrameType::HTTP_FRAME_GOAWAY as u8 => self.handle_go_away_frame(header, bytes, stream) + add,
            x if x == FrameType::HTTP_FRAME_RST_STREAM as u8 => self.handle_rst_stream_frame(header, bytes, stream) + add,
            x if x == FrameType::HTTP_FRAME_ALTSVC as u8 => self.handle_altsvc_frame(header, bytes, stream)? + add,
            x if x == FrameType::HTTP_FRAME_ORIGIN as u8 => self.handle_origin_frame(header, bytes, stream)? + add,
            _ => {
                self.send_go_away(header.stream_identifier, ErrorCode::PROTOCOL_ERROR, b"Unknown frame type", self.last_stream_id, true);
                bytes.len() + add
            }
        })
    }

    fn to_writer(&mut self) -> DirectWriterStruct<'_> {
        DirectWriterStruct { writer: self }
    }
}

struct DirectWriterStruct<'a> {
    writer: &'a mut H2FrameParser,
}
impl<'a> WireWriter for DirectWriterStruct<'a> {
    fn write(&mut self, data: &[u8]) -> Result<usize, bun_core::Error> {
        Ok(if self.writer.write(data) { data.len() } else { 0 })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — JS host fns (part 1)
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    #[bun_jsc::host_fn(method)]
    pub fn set_encoding(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected encoding argument");
        }
        this.handlers.binary_type = match BinaryType::from_js_value(global_object, args_list.ptr[0])? {
            Some(bt) => bt,
            None => {
                let err = bun_jsc::to_invalid_arguments("Expected 'binaryType' to be 'arraybuffer', 'uint8array', 'buffer'", global_object).as_object_ref();
                return global_object.throw_value(err);
            }
        };
        Ok(JSValue::UNDEFINED)
    }

    pub fn load_settings_from_js_value(&mut self, global_object: &JSGlobalObject, options: JSValue) -> JsResult<()> {
        if options.is_empty_or_undefined_or_null() || !options.is_object() {
            return global_object.throw("Expected settings to be a object");
        }

        macro_rules! number_setting {
            ($key:literal, $field:ident, $min:expr, $max:expr, $err:literal) => {{
                if let Some(v) = options.get(global_object, $key)? {
                    if v.is_number() {
                        let value = v.as_number();
                        if value < ($min as f64) || value > $max {
                            return global_object.err_http2_invalid_setting_value_range_error($err).throw();
                        }
                        self.local_settings.$field = value as u32;
                    } else if !v.is_empty_or_undefined_or_null() {
                        return global_object.err_http2_invalid_setting_value_range_error(
                            concat!("Expected ", $key, " to be a number")
                        ).throw();
                    }
                }
            }};
        }

        number_setting!("headerTableSize", header_table_size, 0, MAX_HEADER_TABLE_SIZE_F64, "Expected headerTableSize to be a number between 0 and 2^32-1");

        if let Some(enable_push) = options.get(global_object, "enablePush")? {
            if enable_push.is_boolean() {
                self.local_settings.enable_push = if enable_push.as_boolean() { 1 } else { 0 };
            } else if !enable_push.is_undefined() {
                return global_object.err_http2_invalid_setting_value("Expected enablePush to be a boolean").throw();
            }
        }

        if let Some(v) = options.get(global_object, "initialWindowSize")? {
            if v.is_number() {
                let value = v.as_number();
                if value < 0.0 || value > MAX_WINDOW_SIZE_F64 {
                    return global_object.err_http2_invalid_setting_value_range_error("Expected initialWindowSize to be a number between 0 and 2^32-1").throw();
                }
                bun_output::scoped_log!(H2FrameParser, "initialWindowSize: {}", value as u32);
                self.local_settings.initial_window_size = value as u32;
            } else if !v.is_empty_or_undefined_or_null() {
                return global_object.err_http2_invalid_setting_value_range_error("Expected initialWindowSize to be a number").throw();
            }
        }

        number_setting!("maxFrameSize", max_frame_size, 16384, MAX_FRAME_SIZE_F64, "Expected maxFrameSize to be a number between 16,384 and 2^24-1");
        number_setting!("maxConcurrentStreams", max_concurrent_streams, 0, MAX_HEADER_TABLE_SIZE_F64, "Expected maxConcurrentStreams to be a number between 0 and 2^32-1");
        number_setting!("maxHeaderListSize", max_header_list_size, 0, MAX_HEADER_TABLE_SIZE_F64, "Expected maxHeaderListSize to be a number between 0 and 2^32-1");
        number_setting!("maxHeaderSize", max_header_list_size, 0, MAX_HEADER_TABLE_SIZE_F64, "Expected maxHeaderSize to be a number between 0 and 2^32-1");

        // Validate customSettings
        if let Some(custom_settings) = options.get(global_object, "customSettings")? {
            if !custom_settings.is_undefined() {
                let Some(custom_settings_obj) = custom_settings.get_object() else {
                    return global_object.err_http2_invalid_setting_value("Expected customSettings to be an object").throw();
                };

                let mut count: usize = 0;
                let mut iter = bun_jsc::JSPropertyIterator::init(
                    global_object,
                    custom_settings_obj,
                    bun_jsc::JSPropertyIteratorOptions { skip_empty_name: false, include_value: true },
                )?;

                while let Some(prop_name) = iter.next()? {
                    count += 1;
                    if count > MAX_CUSTOM_SETTINGS {
                        return global_object.err_http2_too_many_custom_settings("Number of custom settings exceeds MAX_ADDITIONAL_SETTINGS").throw();
                    }

                    // Validate setting ID (key) is in range [0, 0xFFFF]
                    let setting_id_str = prop_name.to_utf8();
                    let Ok(setting_id) = core::str::from_utf8(setting_id_str.as_bytes())
                        .ok()
                        .and_then(|s| s.parse::<u32>().ok())
                        .ok_or(())
                    else {
                        return global_object.err_http2_invalid_setting_value_range_error("Invalid custom setting identifier").throw();
                    };
                    if setting_id > 0xFFFF {
                        return global_object.err_http2_invalid_setting_value_range_error("Invalid custom setting identifier").throw();
                    }

                    // Validate setting value is in range [0, 2^32-1]
                    let setting_value = iter.value;
                    if setting_value.is_number() {
                        let value = setting_value.as_number();
                        if value < 0.0 || value > MAX_HEADER_TABLE_SIZE_F64 {
                            return global_object.err_http2_invalid_setting_value_range_error("Invalid custom setting value").throw();
                        }
                    } else {
                        return global_object.err_http2_invalid_setting_value_range_error("Expected custom setting value to be a number").throw();
                    }
                }
            }
        }
        Ok(())
    }

    #[bun_jsc::host_fn(method)]
    pub fn update_settings(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected settings argument");
        }

        let options = args_list.ptr[0];

        this.load_settings_from_js_value(global_object, options)?;

        Ok(JSValue::from(this.set_settings(this.local_settings)))
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_local_window_size(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw_invalid_arguments("Expected windowSize argument");
        }
        let window_size = args_list.ptr[0];
        if !window_size.is_number() {
            return global_object.throw_invalid_arguments("Expected windowSize to be a number");
        }
        let window_size_value: u32 = window_size.to::<u32>();
        if this.used_window_size > window_size_value as u64 {
            return global_object.throw_invalid_arguments("Expected windowSize to be greater than usedWindowSize");
        }
        let old_window_size = this.window_size;
        this.window_size = window_size_value as u64;
        if this.local_settings.initial_window_size < window_size_value {
            this.local_settings.initial_window_size = window_size_value;
        }
        if window_size_value as u64 > old_window_size {
            let increment: u32 = (window_size_value as u64 - old_window_size) as u32;
            this.send_window_update(0, UInt31WithReserved::init(increment, false));
        }
        for (_, item) in this.streams.iter() {
            let stream = unsafe { &mut **item };
            if stream.used_window_size > window_size_value as u64 {
                continue;
            }
            stream.window_size = window_size_value as u64;
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_current_state(this: &mut Self, global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        let result = JSValue::create_empty_object(global_object, 9);
        result.put(global_object, ZigString::static_("effectiveLocalWindowSize"), JSValue::js_number(this.window_size));
        result.put(global_object, ZigString::static_("effectiveRecvDataLength"), JSValue::js_number(this.window_size - this.used_window_size));
        result.put(global_object, ZigString::static_("nextStreamID"), JSValue::js_number(this.get_next_stream_id()));
        result.put(global_object, ZigString::static_("lastProcStreamID"), JSValue::js_number(this.last_stream_id));

        let settings = this.remote_settings.unwrap_or_default();
        result.put(global_object, ZigString::static_("remoteWindowSize"), JSValue::js_number(settings.initial_window_size));
        result.put(global_object, ZigString::static_("localWindowSize"), JSValue::js_number(this.local_settings.initial_window_size));
        result.put(global_object, ZigString::static_("deflateDynamicTableSize"), JSValue::js_number(this.local_settings.header_table_size));
        result.put(global_object, ZigString::static_("inflateDynamicTableSize"), JSValue::js_number(this.local_settings.header_table_size));
        result.put(global_object, ZigString::static_("outboundQueueSize"), JSValue::js_number(this.outbound_queue_size));
        Ok(result)
    }

    #[bun_jsc::host_fn(method)]
    pub fn goaway(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(3);
        if args_list.len() < 1 {
            return global_object.throw("Expected errorCode argument");
        }

        let error_code_arg = args_list.ptr[0];

        if !error_code_arg.is_number() {
            return global_object.throw("Expected errorCode to be a number");
        }
        let error_code = error_code_arg.to_int32();
        if error_code < 1 && error_code > 13 {
            return global_object.throw("invalid errorCode");
        }

        let mut last_stream_id = this.last_stream_id;
        if args_list.len() >= 2 {
            let last_stream_arg = args_list.ptr[1];
            if !last_stream_arg.is_empty_or_undefined_or_null() {
                if !last_stream_arg.is_number() {
                    return global_object.throw("Expected lastStreamId to be a number");
                }
                let id = last_stream_arg.to_int32();
                if id < 0 && id as u32 > MAX_STREAM_ID {
                    return global_object.throw("Expected lastStreamId to be a number between 1 and 2147483647");
                }
                last_stream_id = u32::try_from(id).unwrap();
            }
            if args_list.len() >= 3 {
                let opaque_data_arg = args_list.ptr[2];
                if !opaque_data_arg.is_empty_or_undefined_or_null() {
                    if let Some(array_buffer) = opaque_data_arg.as_array_buffer(global_object) {
                        let slice = array_buffer.byte_slice();
                        this.send_go_away(0, ErrorCode(error_code as u32), slice, last_stream_id, false);
                        return Ok(JSValue::UNDEFINED);
                    }
                }
            }
        }

        this.send_go_away(0, ErrorCode(error_code as u32), b"", last_stream_id, false);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn ping(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected payload argument");
        }

        if this.out_standing_pings >= this.max_outstanding_pings {
            let exception = global_object.to_type_error(bun_jsc::ErrorCode::HTTP2_PING_CANCEL, "HTTP2 ping cancelled");
            return global_object.throw_value(exception);
        }

        if let Some(array_buffer) = args_list.ptr[0].as_array_buffer(global_object) {
            let slice = array_buffer.slice();
            this.send_ping(false, slice);
            return Ok(JSValue::UNDEFINED);
        }

        global_object.throw("Expected payload to be a Buffer")
    }

    #[bun_jsc::host_fn(method)]
    pub fn origin(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
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
                let exception = global_object.to_type_error(bun_jsc::ErrorCode::HTTP2_ORIGIN_LENGTH, "HTTP/2 ORIGIN frames are limited to 16382 bytes");
                return global_object.throw_value(exception);
            }

            let mut buffer = [0u8; FrameHeader::BYTE_SIZE + 2];
            let mut stream = FixedBufferStream::new(&mut buffer);

            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_ORIGIN as u8,
                flags: 0,
                stream_identifier: 0,
                length: u32::try_from(slice.len() + 2).unwrap(),
            };
            let _ = frame.write(&mut stream);
            let _ = stream.write_int_u16_be(u16::try_from(slice.len()).unwrap());
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
                    return global_object.throw_invalid_arguments("Expected origin to be a string or an array of strings");
                }
                let origin_string = item.to_slice(global_object)?;
                let slice = origin_string.slice();
                if stream.write_int_u16_be(u16::try_from(slice.len()).unwrap()).is_err() {
                    let exception = global_object.to_type_error(bun_jsc::ErrorCode::HTTP2_ORIGIN_LENGTH, "HTTP/2 ORIGIN frames are limited to 16382 bytes");
                    return global_object.throw_value(exception);
                }

                if stream.write(slice).is_err() {
                    let exception = global_object.to_type_error(bun_jsc::ErrorCode::HTTP2_ORIGIN_LENGTH, "HTTP/2 ORIGIN frames are limited to 16382 bytes");
                    return global_object.throw_value(exception);
                }
            }

            let total_length: u32 = u32::try_from(stream.get_pos()).unwrap();
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
    pub fn altsvc(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let mut origin_slice: Option<bun_str::Slice> = None;
        let mut value_slice: Option<bun_str::Slice> = None;

        let mut origin_str: &[u8] = b"";
        let mut value_str: &[u8] = b"";
        let mut stream_id: u32 = 0;
        let origin_string = callframe.argument(0);
        if !origin_string.is_empty_or_undefined_or_null() {
            if !origin_string.is_string() {
                return global_object.throw_invalid_argument_type_value("origin", "origin", origin_string);
            }
            origin_slice = Some(origin_string.to_slice(global_object)?);
            origin_str = origin_slice.as_ref().unwrap().slice();
        }

        let value_string = callframe.argument(1);
        if !value_string.is_empty_or_undefined_or_null() {
            if !value_string.is_string() {
                return global_object.throw_invalid_argument_type_value("value", "value", value_string);
            }
            value_slice = Some(value_string.to_slice(global_object)?);
            value_str = value_slice.as_ref().unwrap().slice();
        }

        let stream_id_js = callframe.argument(2);
        if !stream_id_js.is_empty_or_undefined_or_null() {
            if !stream_id_js.is_number() {
                return global_object.throw("Expected streamId to be a number");
            }
            stream_id = stream_id_js.to_u32();
        }
        if stream_id > 0 {
            // dont error but dont send frame to invalid stream id
            if this.streams.get(&stream_id).is_none() {
                return Ok(JSValue::UNDEFINED);
            }
        }
        this.send_alt_svc(stream_id, origin_str, value_str);
        // origin_slice/value_slice dropped here
        let _ = (origin_slice, value_slice);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_end_after_headers(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected stream argument");
        }
        let stream_arg = args_list.ptr[0];

        if !stream_arg.is_number() {
            return global_object.throw("Invalid stream id");
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 {
            return global_object.throw("Invalid stream id");
        }

        let Some(stream) = this.streams.get(&stream_id).copied() else {
            return global_object.throw("Invalid stream id");
        };

        Ok(JSValue::from(unsafe { (*stream).end_after_headers }))
    }

    #[bun_jsc::host_fn(method)]
    pub fn is_stream_aborted(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected stream argument");
        }
        let stream_arg = args_list.ptr[0];

        if !stream_arg.is_number() {
            return global_object.throw("Invalid stream id");
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 {
            return global_object.throw("Invalid stream id");
        }

        let Some(stream) = this.streams.get(&stream_id).copied() else {
            return global_object.throw("Invalid stream id");
        };
        let stream = unsafe { &*stream };

        if let Some(signal_ref) = &stream.signal {
            return Ok(JSValue::from(signal_ref.is_aborted()));
        }
        // closed with cancel = aborted
        Ok(JSValue::from(stream.state == StreamState::CLOSED && stream.rst_code == ErrorCode::CANCEL.0))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_stream_state(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected stream argument");
        }
        let stream_arg = args_list.ptr[0];

        if !stream_arg.is_number() {
            return global_object.throw("Invalid stream id");
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 {
            return global_object.throw("Invalid stream id");
        }

        let Some(stream) = this.streams.get(&stream_id).copied() else {
            return global_object.throw("Invalid stream id");
        };
        let stream = unsafe { &mut *stream };
        let state = JSValue::create_empty_object(global_object, 6);

        state.put(global_object, ZigString::static_("localWindowSize"), JSValue::js_number(stream.window_size));
        state.put(global_object, ZigString::static_("state"), JSValue::js_number(stream.state as u8));
        state.put(global_object, ZigString::static_("localClose"), JSValue::js_number(if stream.can_send_data() { 0i32 } else { 1 }));
        state.put(global_object, ZigString::static_("remoteClose"), JSValue::js_number(if stream.can_receive_data() { 0i32 } else { 1 }));
        // TODO: sumDependencyWeight
        state.put(global_object, ZigString::static_("sumDependencyWeight"), JSValue::js_number(0));
        state.put(global_object, ZigString::static_("weight"), JSValue::js_number(stream.weight));

        Ok(state)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_stream_priority(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(2);
        if args_list.len() < 2 {
            return global_object.throw("Expected stream and options arguments");
        }
        let stream_arg = args_list.ptr[0];
        let options = args_list.ptr[1];

        if !stream_arg.is_number() {
            return global_object.throw("Invalid stream id");
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 {
            return global_object.throw("Invalid stream id");
        }

        let Some(stream_ptr) = this.streams.get(&stream_id).copied() else {
            return global_object.throw("Invalid stream id");
        };
        let stream = unsafe { &mut *stream_ptr };

        if !stream.can_send_data() && !stream.can_receive_data() {
            return Ok(JSValue::FALSE);
        }

        if !options.is_object() {
            return global_object.throw("Invalid priority");
        }

        let mut weight = stream.weight;
        let mut exclusive = stream.exclusive;
        let mut parent_id = stream.stream_dependency;
        let mut silent = false;
        if let Some(js_weight) = options.get(global_object, "weight")? {
            if js_weight.is_number() {
                let weight_u32 = js_weight.to_u32();
                if weight_u32 > 255 {
                    return global_object.throw("Invalid weight");
                }
                weight = u16::try_from(weight_u32).unwrap();
            }
        }

        if let Some(js_parent) = options.get(global_object, "parent")? {
            if js_parent.is_number() {
                parent_id = js_parent.to_u32();
                if parent_id == 0 || parent_id > MAX_STREAM_ID {
                    return global_object.throw("Invalid stream id");
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
                return global_object.err_invalid_arg_type("options.silent must be a boolean").throw();
            }
        }
        if parent_id == stream.id {
            this.send_go_away(stream.id, ErrorCode::PROTOCOL_ERROR, b"Stream with self dependency", this.last_stream_id, true);
            return Ok(JSValue::FALSE);
        }

        stream.stream_dependency = parent_id;
        stream.exclusive = exclusive;
        stream.weight = weight;

        if !silent {
            let stream_identifier = UInt31WithReserved::init(stream.stream_dependency, stream.exclusive);

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
    pub fn rst_stream(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        bun_output::scoped_log!(H2FrameParser, "rstStream");
        let args_list = callframe.arguments_old(2);
        if args_list.len() < 2 {
            return global_object.throw("Expected stream and code arguments");
        }
        let stream_arg = args_list.ptr[0];
        let error_arg = args_list.ptr[1];

        if !stream_arg.is_number() {
            return global_object.throw("Invalid stream id");
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return global_object.throw("Invalid stream id");
        }

        let Some(stream) = this.streams.get(&stream_id).copied() else {
            return global_object.throw("Invalid stream id");
        };
        if !error_arg.is_number() {
            return global_object.throw("Invalid ErrorCode");
        }

        let error_code = error_arg.to_u32();

        this.end_stream(unsafe { &mut *stream }, ErrorCode(error_code));

        Ok(JSValue::TRUE)
    }
}

struct MemoryWriter<'a> {
    buffer: &'a mut [u8],
    offset: usize,
}
impl<'a> MemoryWriter<'a> {
    pub fn slice(&self) -> &[u8] {
        &self.buffer[0..self.offset]
    }
}
impl<'a> WireWriter for MemoryWriter<'a> {
    fn write(&mut self, data: &[u8]) -> Result<usize, bun_core::Error> {
        let pending = &mut self.buffer[self.offset..];
        debug_assert!(pending.len() >= data.len());
        pending[0..data.len()].copy_from_slice(data);
        self.offset += data.len();
        Ok(data.len())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// H2FrameParser impl — JS host fns (part 2)
// ──────────────────────────────────────────────────────────────────────────

impl H2FrameParser {
    // get memory usage in MB
    fn get_session_memory_usage(&self) -> usize {
        (self.write_buffer.len as usize + self.queued_data_size as usize) / 1024 / 1024
    }

    // get memory in bytes
    #[bun_jsc::host_fn(method)]
    pub fn get_buffer_size(this: &mut Self, _global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(this.write_buffer.len as u64 + this.queued_data_size))
    }

    fn send_data(&mut self, stream: &mut Stream, payload: &[u8], close: bool, callback: JSValue) {
        bun_output::scoped_log!(
            H2FrameParser,
            "HTTP_FRAME_DATA {} sendData({}, {}, {})",
            if self.is_server { "server" } else { "client" }, stream.id, payload.len(), close
        );

        let stream_id = stream.id;
        let mut enqueued = false;
        self.ref_();

        let can_close = close && !stream.wait_for_trailers;
        if payload.is_empty() {
            // empty payload we still need to send a frame
            let mut data_header = FrameHeader {
                type_: FrameType::HTTP_FRAME_DATA as u8,
                flags: if can_close { DataFrameFlags::END_STREAM as u8 } else { 0 },
                stream_identifier: stream_id,
                length: 0,
            };
            if self.has_backpressure() || self.outbound_queue_size > 0 {
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
                    .min((self.remote_window_size.saturating_sub(self.remote_used_window_size)) as usize)
                    .min((stream.remote_window_size.saturating_sub(stream.remote_used_window_size)) as usize);
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

                if self.has_backpressure() || self.outbound_queue_size > 0 || is_flow_control_limited {
                    enqueued = true;
                    // write the full frame in memory and queue the frame
                    // the callback will only be called after the last frame is sended
                    stream.queue_frame(
                        self,
                        slice,
                        if offset >= payload.len() { callback } else { JSValue::UNDEFINED },
                        offset >= payload.len() && close,
                    );
                } else {
                    let padding = stream.get_padding(size, max_size - 1);
                    let payload_size = size + if padding != 0 { padding as usize + 1 } else { 0 };
                    bun_output::scoped_log!(H2FrameParser, "padding: {} size: {} max_size: {} payload_size: {}", padding, size, max_size, payload_size);
                    stream.remote_used_window_size += payload_size as u64;
                    self.remote_used_window_size += payload_size as u64;
                    let mut flags: u8 = if end_stream { DataFrameFlags::END_STREAM as u8 } else { 0 };
                    if padding != 0 {
                        flags |= DataFrameFlags::PADDED as u8;
                    }
                    let mut data_header = FrameHeader {
                        type_: FrameType::HTTP_FRAME_DATA as u8,
                        flags,
                        stream_identifier: stream_id,
                        length: payload_size as u32,
                    };
                    let mut writer = self.to_writer();
                    let _ = data_header.write(&mut writer);
                    if padding != 0 {
                        SHARED_REQUEST_BUFFER.with_borrow_mut(|buffer| {
                            unsafe {
                                core::ptr::copy(slice.as_ptr(), buffer.as_mut_ptr().add(1), slice.len());
                            }
                            buffer[0] = padding;
                            let _ = writer.write(&buffer[0..payload_size]);
                        });
                    } else {
                        let _ = writer.write(slice);
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
                    self.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, JSValue::js_number(stream.state as u8));
                }
            }
        }
        self.deref();
    }

    #[bun_jsc::host_fn(method)]
    pub fn no_trailers(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected stream, headers and sensitiveHeaders arguments");
        }

        let stream_arg = args_list.ptr[0];

        if !stream_arg.is_number() {
            return global_object.throw("Expected stream to be a number");
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return global_object.throw("Invalid stream id");
        }

        let Some(stream) = this.streams.get(&stream_id).copied() else {
            return global_object.throw("Invalid stream id");
        };
        let stream = unsafe { &mut *stream };

        stream.wait_for_trailers = false;
        this.send_data(stream, b"", true, JSValue::UNDEFINED);
        Ok(JSValue::UNDEFINED)
    }

    /// validate header name and convert to lowecase if needed
    fn to_valid_header_name<'a>(in_: &'a [u8], out: &'a mut [u8]) -> Result<&'a [u8], bun_core::Error> {
        let mut in_slice = in_;
        let mut out_slice = &mut out[..];
        let mut any = false;
        if in_.len() > 4096 {
            return Err(bun_core::err!("InvalidHeaderName"));
        }
        debug_assert!(out.len() >= in_.len());
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
                    b'a'..=b'z' | b'0'..=b'9' | b'!' | b'#' | b'$' | b'%' | b'&' | b'\''
                    | b'*' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~' => {}
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
    pub fn send_trailers(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(3);
        if args_list.len() < 3 {
            return global_object.throw("Expected stream, headers and sensitiveHeaders arguments");
        }

        let stream_arg = args_list.ptr[0];
        let headers_arg = args_list.ptr[1];
        let sensitive_arg = args_list.ptr[2];

        if !stream_arg.is_number() {
            return global_object.throw("Expected stream to be a number");
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return global_object.throw("Invalid stream id");
        }

        let Some(stream_ptr) = this.streams.get(&stream_id).copied() else {
            return global_object.throw("Invalid stream id");
        };
        let stream = unsafe { &mut *stream_ptr };

        let Some(headers_obj) = headers_arg.get_object() else {
            return global_object.throw("Expected headers to be an object");
        };

        if !sensitive_arg.is_object() {
            return global_object.throw("Expected sensitiveHeaders to be an object");
        }

        // PERF(port): was BufferFallbackAllocator over shared_request_buffer — using plain Vec
        let mut encoded_headers: Vec<u8> = Vec::new();
        if encoded_headers.try_reserve(16384).is_err() {
            return global_object.throw("Failed to allocate header buffer");
        }
        // max header name length for lshpack
        let mut name_buffer = [0u8; 4096];

        let mut iter = bun_jsc::JSPropertyIterator::init(
            global_object,
            headers_obj,
            bun_jsc::JSPropertyIteratorOptions { skip_empty_name: false, include_value: true },
        )?;

        let mut single_value_headers = [false; SINGLE_VALUE_HEADERS_LEN];

        // Encode trailer headers using HPACK
        while let Some(header_name) = iter.next()? {
            if header_name.length() == 0 {
                continue;
            }

            let name_slice = header_name.to_utf8();
            let name = name_slice.slice();

            if header_name.char_at(0) == b':' as u16 {
                let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_INVALID_PSEUDOHEADER, format_args!("\"{}\" is an invalid pseudoheader or is used incorrectly", BStr::new(name)));
                return global_object.throw_value(exception);
            }

            let js_value = iter.value;
            if js_value.is_undefined_or_null() {
                let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE, format_args!("Invalid value for header \"{}\"", BStr::new(name)));
                return global_object.throw_value(exception);
            }
            let validated_name = match Self::to_valid_header_name(name, &mut name_buffer[0..name.len()]) {
                Ok(n) => n,
                Err(_) => {
                    let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::INVALID_HTTP_TOKEN, format_args!("The arguments Header name is invalid. Received {}", BStr::new(name)));
                    return global_object.throw_value(exception);
                }
            };

            // closure for encode error handling
            let mut handle_encode = |this: &mut Self, value: &[u8], never_index: bool| -> JsResult<Option<JSValue>> {
                bun_output::scoped_log!(H2FrameParser, "encode header {} {}", BStr::new(validated_name), BStr::new(value));
                match this.encode_header_into_list(&mut encoded_headers, validated_name, value, never_index) {
                    Ok(_) => Ok(None),
                    Err(err) if err == bun_core::err!("OutOfMemory") => {
                        global_object.throw("Failed to allocate header buffer").map(Some)
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
                            JSValue::js_number(FrameType::HTTP_FRAME_HEADERS as u8),
                            JSValue::js_number(ErrorCode::FRAME_SIZE_ERROR.0),
                        );
                        this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, identifier, JSValue::js_number(stream.rst_code));
                        Ok(Some(JSValue::UNDEFINED))
                    }
                }
            };

            if js_value.js_type().is_array() {
                let mut value_iter = js_value.array_iterator(global_object)?;

                if let Some(idx) = single_value_headers_index_of(validated_name) {
                    if value_iter.len > 1 || single_value_headers[idx] {
                        let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE, format_args!("Header field \"{}\" must only have a single value", BStr::new(validated_name)));
                        return global_object.throw_value(exception);
                    }
                    single_value_headers[idx] = true;
                }

                while let Some(item) = value_iter.next()? {
                    if item.is_empty_or_undefined_or_null() {
                        let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE, format_args!("Invalid value for header \"{}\"", BStr::new(validated_name)));
                        return global_object.throw_value(exception);
                    }

                    let value_str = match item.to_js_string(global_object) {
                        Ok(s) => s,
                        Err(_) => {
                            global_object.clear_exception();
                            let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE, format_args!("Invalid value for header \"{}\"", BStr::new(validated_name)));
                            return global_object.throw_value(exception);
                        }
                    };

                    let never_index = sensitive_arg.get_truthy_property_value(global_object, validated_name)?
                        .or(sensitive_arg.get_truthy_property_value(global_object, name)?)
                        .is_some();

                    let value_slice = value_str.to_slice(global_object);
                    let value = value_slice.slice();

                    if let Some(ret) = handle_encode(this, value, never_index)? {
                        return Ok(ret);
                    }
                }
            } else {
                if let Some(idx) = single_value_headers_index_of(validated_name) {
                    if single_value_headers[idx] {
                        let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE, format_args!("Header field \"{}\" must only have a single value", BStr::new(validated_name)));
                        return global_object.throw_value(exception);
                    }
                    single_value_headers[idx] = true;
                }
                let value_str = match js_value.to_js_string(global_object) {
                    Ok(s) => s,
                    Err(_) => {
                        global_object.clear_exception();
                        let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE, format_args!("Invalid value for header \"{}\"", BStr::new(validated_name)));
                        return global_object.throw_value(exception);
                    }
                };

                let never_index = sensitive_arg.get_truthy_property_value(global_object, validated_name)?
                    .or(sensitive_arg.get_truthy_property_value(global_object, name)?)
                    .is_some();

                let value_slice = value_str.to_slice(global_object);
                let value = value_slice.slice();
                bun_output::scoped_log!(H2FrameParser, "encode header {} {}", BStr::new(name), BStr::new(value));

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
        let actual_max_frame_size = this.remote_settings.unwrap_or(this.local_settings).max_frame_size as usize;

        bun_output::scoped_log!(H2FrameParser, "trailers encoded_size {}", encoded_size);

        let mut writer = this.to_writer();

        if encoded_size <= actual_max_frame_size {
            // Single HEADERS frame - header block fits in one frame
            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags: base_flags | HeadersFrameFlags::END_HEADERS as u8,
                stream_identifier: stream.id,
                length: u32::try_from(encoded_size).unwrap(),
            };
            let _ = frame.write(&mut writer);
            let _ = writer.write(encoded_data);
        } else {
            bun_output::scoped_log!(H2FrameParser, "Using CONTINUATION frames for trailers: encoded_size={} max_frame_size={}", encoded_size, actual_max_frame_size);

            let first_chunk_size = actual_max_frame_size;

            let mut headers_frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags: base_flags, // END_STREAM but NOT END_HEADERS
                stream_identifier: stream.id,
                length: u32::try_from(first_chunk_size).unwrap(),
            };
            let _ = headers_frame.write(&mut writer);
            let _ = writer.write(&encoded_data[0..first_chunk_size]);

            let mut offset: usize = first_chunk_size;
            while offset < encoded_size {
                let remaining = encoded_size - offset;
                let chunk_size = remaining.min(actual_max_frame_size);
                let is_last = offset + chunk_size >= encoded_size;

                let mut cont_frame = FrameHeader {
                    type_: FrameType::HTTP_FRAME_CONTINUATION as u8,
                    flags: if is_last { HeadersFrameFlags::END_HEADERS as u8 } else { 0 },
                    stream_identifier: stream.id,
                    length: u32::try_from(chunk_size).unwrap(),
                };
                let _ = cont_frame.write(&mut writer);
                let _ = writer.write(&encoded_data[offset..offset + chunk_size]);

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
        this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamEnd, identifier, JSValue::js_number(stream.state as u8));
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn write_stream(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_undef(5);
        let [stream_arg, data_arg, encoding_arg, close_arg, callback_arg] = args.ptr;

        if !stream_arg.is_number() {
            return global_object.throw("Expected stream to be a number");
        }

        let stream_id = stream_arg.to_u32();
        if stream_id == 0 || stream_id > MAX_STREAM_ID {
            return global_object.throw("Invalid stream id");
        }
        let close = close_arg.to_boolean();

        let Some(stream_ptr) = this.streams.get(&stream_id).copied() else {
            return global_object.throw("Invalid stream id");
        };
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
                return global_object.throw_invalid_argument_type_value("write", "encoding", encoding_arg);
            }
            match Encoding::from_js(encoding_arg, global_object)? {
                Some(e) => break 'brk e,
                None => {
                    return global_object.throw_invalid_argument_type_value("write", "encoding", encoding_arg);
                }
            }
        };

        let buffer = match StringOrBuffer::from_js_with_encoding(global_object, data_arg, encoding)? {
            Some(b) => b,
            None => {
                return global_object.throw_invalid_argument_type_value("write", "Buffer or String", data_arg);
            }
        };

        this.send_data(stream, buffer.slice(), close, callback_arg);

        Ok(JSValue::TRUE)
    }

    fn get_next_stream_id(&self) -> u32 {
        let mut stream_id: u32 = self.last_stream_id;
        if self.is_server {
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
    pub fn set_next_stream_id(this: &mut Self, _global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments();
        debug_assert!(args_list.len() >= 1);
        let stream_id_arg = args_list[0];
        debug_assert!(stream_id_arg.is_number());
        this.last_stream_id = stream_id_arg.to::<u32>();
        if this.is_server {
            if this.last_stream_id % 2 == 0 {
                this.last_stream_id -= 2;
            } else {
                this.last_stream_id -= 1;
            }
        } else {
            if this.last_stream_id % 2 == 0 {
                this.last_stream_id -= 1;
            } else if this.last_stream_id == 1 {
                this.last_stream_id = 0;
            } else {
                this.last_stream_id -= 2;
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn has_native_read(this: &mut Self, _global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::from(matches!(this.native_socket, BunSocket::Tcp(_) | BunSocket::Tls(_))))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_next_stream(this: &mut Self, _global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        let id = this.get_next_stream_id();
        if id > MAX_STREAM_ID {
            return Ok(JSValue::js_number(-1));
        }
        if this.handle_received_stream_id(id).is_none() {
            return Ok(JSValue::js_number(-1));
        }
        Ok(JSValue::js_number(id))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_stream_context(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected stream_id argument");
        }

        let stream_id_arg = args_list.ptr[0];
        if !stream_id_arg.is_number() {
            return global_object.throw("Expected stream_id to be a number");
        }

        let Some(stream) = this.streams.get(&stream_id_arg.to::<u32>()).copied() else {
            return global_object.throw("Invalid stream id");
        };

        Ok(unsafe { (*stream).js_context.get() }.unwrap_or(JSValue::UNDEFINED))
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_stream_context(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(2);
        if args_list.len() < 2 {
            return global_object.throw("Expected stream_id and context arguments");
        }

        let stream_id_arg = args_list.ptr[0];
        if !stream_id_arg.is_number() {
            return global_object.throw("Expected stream_id to be a number");
        }
        let Some(stream) = this.streams.get(&stream_id_arg.to::<u32>()).copied() else {
            return global_object.throw("Invalid stream id");
        };
        let context_arg = args_list.ptr[1];
        if !context_arg.is_object() {
            return global_object.throw("Expected context to be an object");
        }

        unsafe { (*stream).set_context(context_arg, global_object) };
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn for_each_stream(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.len() < 1 || !args[0].is_callable() {
            return Ok(JSValue::UNDEFINED);
        }
        let callback = args[0];
        let this_value: JSValue = if args.len() > 1 { args[1] } else { JSValue::UNDEFINED };
        let mut _count: u32 = 0;
        let self_ptr = this as *mut Self;
        let mut it = StreamResumableIterator::init(unsafe { &mut *self_ptr });
        while let Some(stream) = it.next() {
            let Some(value) = unsafe { (*stream).js_context.get() } else { continue };
            this.handlers.vm.event_loop().run_callback(callback, global_object, this_value, &[value]);
            _count += 1;
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn emit_abort_to_all_streams(this: &mut Self, _global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        let self_ptr = this as *mut Self;
        let mut it = StreamResumableIterator::init(unsafe { &mut *self_ptr });
        while let Some(stream_ptr) = it.next() {
            let stream = unsafe { &mut *stream_ptr };
            // this is the oposite logic of emitErrorToallStreams, in this case we wanna to cancel this streams
            if this.is_server {
                if stream.id % 2 == 0 { continue; }
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
                this.dispatch_with_2_extra(JSH2FrameParser::Gc::onAborted, identifier, JSValue::UNDEFINED, JSValue::js_number(old_state as u8));
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn emit_error_to_all_streams(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected error argument");
        }

        let self_ptr = this as *mut Self;
        let mut it = StreamResumableIterator::init(unsafe { &mut *self_ptr });
        while let Some(stream_ptr) = it.next() {
            let stream = unsafe { &mut *stream_ptr };
            if stream.state != StreamState::CLOSED {
                stream.state = StreamState::CLOSED;
                stream.rst_code = args_list.ptr[0].to::<u32>();
                let identifier = stream.get_identifier();
                identifier.ensure_still_alive();
                stream.free_resources::<false>(this);
                this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, identifier, args_list.ptr[0]);
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn flush_from_js(this: &mut Self, _global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(this.flush()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn request(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        bun_output::scoped_log!(H2FrameParser, "request");

        let args_list = callframe.arguments_old(5);
        if args_list.len() < 4 {
            return global_object.throw("Expected stream_id, stream_ctx, headers and sensitiveHeaders arguments");
        }

        let stream_id_arg = args_list.ptr[0];
        let stream_ctx_arg = args_list.ptr[1];
        let headers_arg = args_list.ptr[2];
        let sensitive_arg = args_list.ptr[3];

        let Some(headers_obj) = headers_arg.get_object() else {
            return global_object.throw("Expected headers to be an object");
        };

        if !sensitive_arg.is_object() {
            return global_object.throw("Expected sensitiveHeaders to be an object");
        }
        // PERF(port): was BufferFallbackAllocator over shared_request_buffer — using plain Vec
        let mut encoded_headers: Vec<u8> = Vec::new();
        if encoded_headers.try_reserve(16384).is_err() {
            return global_object.throw("Failed to allocate header buffer");
        }
        // max header name length for lshpack
        let mut name_buffer = [0u8; 4096];
        let stream_id: u32 = if !stream_id_arg.is_empty_or_undefined_or_null() && stream_id_arg.is_number() {
            stream_id_arg.to::<u32>()
        } else {
            this.get_next_stream_id()
        };
        if stream_id > MAX_STREAM_ID {
            return Ok(JSValue::js_number(-1));
        }

        // we iterate twice, because pseudo headers must be sent first, but can appear anywhere in the headers object
        let mut iter = bun_jsc::JSPropertyIterator::init(
            global_object,
            headers_obj,
            bun_jsc::JSPropertyIteratorOptions { skip_empty_name: false, include_value: true },
        )?;
        let mut single_value_headers = [false; SINGLE_VALUE_HEADERS_LEN];

        for ignore_pseudo_headers in 0..2usize {
            iter.reset();

            while let Some(header_name) = iter.next()? {
                if header_name.length() == 0 {
                    continue;
                }

                let name_slice = header_name.to_utf8();
                let name = name_slice.slice();

                let validated_name = match Self::to_valid_header_name(name, &mut name_buffer[0..name.len()]) {
                    Ok(n) => n,
                    Err(_) => {
                        let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::INVALID_HTTP_TOKEN, format_args!("The arguments Header name is invalid. Received \"{}\"", BStr::new(name)));
                        return global_object.throw_value(exception);
                    }
                };

                if header_name.char_at(0) == b':' as u16 {
                    if ignore_pseudo_headers == 1 {
                        continue;
                    }

                    if this.is_server {
                        if !VALID_RESPONSE_PSEUDO_HEADERS.contains_key(validated_name) {
                            if !global_object.has_exception() {
                                return global_object.err_http2_invalid_pseudoheader(format_args!("\"{}\" is an invalid pseudoheader or is used incorrectly", BStr::new(name))).throw();
                            }
                            return Ok(JSValue::ZERO);
                        }
                    } else {
                        if !VALID_REQUEST_PSEUDO_HEADERS.contains_key(validated_name) {
                            if !global_object.has_exception() {
                                return global_object.err_http2_invalid_pseudoheader(format_args!("\"{}\" is an invalid pseudoheader or is used incorrectly", BStr::new(name))).throw();
                            }
                            return Ok(JSValue::ZERO);
                        }
                    }
                } else if ignore_pseudo_headers == 0 {
                    continue;
                }

                let js_value = iter.value;
                if js_value.is_undefined_or_null() {
                    let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_INVALID_HEADER_VALUE, format_args!("Invalid value for header \"{}\"", BStr::new(name)));
                    return global_object.throw_value(exception);
                }

                if js_value.js_type().is_array() {
                    bun_output::scoped_log!(H2FrameParser, "array header {}", BStr::new(name));
                    let mut value_iter = js_value.array_iterator(global_object)?;

                    if let Some(idx) = single_value_headers_index_of(validated_name) {
                        if value_iter.len > 1 || single_value_headers[idx] {
                            if !global_object.has_exception() {
                                let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE, format_args!("Header field \"{}\" must only have a single value", BStr::new(validated_name)));
                                return global_object.throw_value(exception);
                            }
                            return Ok(JSValue::ZERO);
                        }
                        single_value_headers[idx] = true;
                    }

                    while let Some(item) = value_iter.next()? {
                        if item.is_empty_or_undefined_or_null() {
                            if !global_object.has_exception() {
                                return global_object.err_http2_invalid_header_value(format_args!("Invalid value for header \"{}\"", BStr::new(validated_name))).throw();
                            }
                            return Ok(JSValue::ZERO);
                        }

                        let value_str = match item.to_js_string(global_object) {
                            Ok(s) => s,
                            Err(_) => {
                                global_object.clear_exception();
                                return global_object.err_http2_invalid_header_value(format_args!("Invalid value for header \"{}\"", BStr::new(validated_name))).throw();
                            }
                        };

                        let never_index = sensitive_arg.get_truthy_property_value(global_object, validated_name)?
                            .or(sensitive_arg.get_truthy_property_value(global_object, name)?)
                            .is_some();

                        let value_slice = value_str.to_slice(global_object);
                        let value = value_slice.slice();
                        bun_output::scoped_log!(H2FrameParser, "encode header {} {}", BStr::new(validated_name), BStr::new(value));

                        if let Err(err) = this.encode_header_into_list(&mut encoded_headers, validated_name, value, never_index) {
                            if err == bun_core::err!("OutOfMemory") {
                                return global_object.throw("Failed to allocate header buffer");
                            }
                            let Some(stream) = this.handle_received_stream_id(stream_id) else {
                                return Ok(JSValue::js_number(-1));
                            };
                            let stream = unsafe { &mut *stream };
                            if !stream_ctx_arg.is_empty_or_undefined_or_null() && stream_ctx_arg.is_object() {
                                stream.set_context(stream_ctx_arg, global_object);
                            }
                            stream.state = StreamState::CLOSED;
                            stream.rst_code = ErrorCode::COMPRESSION_ERROR.0;
                            this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, stream.get_identifier(), JSValue::js_number(stream.rst_code));
                            return Ok(JSValue::UNDEFINED);
                        }
                    }
                } else if !js_value.is_empty_or_undefined_or_null() {
                    bun_output::scoped_log!(H2FrameParser, "single header {}", BStr::new(name));
                    if let Some(idx) = single_value_headers_index_of(validated_name) {
                        if single_value_headers[idx] {
                            let exception = global_object.to_type_error_fmt(bun_jsc::ErrorCode::HTTP2_HEADER_SINGLE_VALUE, format_args!("Header field \"{}\" must only have a single value", BStr::new(validated_name)));
                            return global_object.throw_value(exception);
                        }
                        single_value_headers[idx] = true;
                    }
                    let value_str = match js_value.to_js_string(global_object) {
                        Ok(s) => s,
                        Err(_) => {
                            global_object.clear_exception();
                            return global_object.err_http2_invalid_header_value(format_args!("Invalid value for header \"{}\"", BStr::new(name))).throw();
                        }
                    };

                    let never_index = sensitive_arg.get_truthy_property_value(global_object, validated_name)?
                        .or(sensitive_arg.get_truthy_property_value(global_object, name)?)
                        .is_some();

                    let value_slice = value_str.to_slice(global_object);
                    let value = value_slice.slice();
                    bun_output::scoped_log!(H2FrameParser, "encode header {} {}", BStr::new(validated_name), BStr::new(value));

                    if let Err(err) = this.encode_header_into_list(&mut encoded_headers, validated_name, value, never_index) {
                        if err == bun_core::err!("OutOfMemory") {
                            return global_object.throw("Failed to allocate header buffer");
                        }
                        let Some(stream) = this.handle_received_stream_id(stream_id) else {
                            return Ok(JSValue::js_number(-1));
                        };
                        let stream = unsafe { &mut *stream };
                        stream.state = StreamState::CLOSED;
                        if !stream_ctx_arg.is_empty_or_undefined_or_null() && stream_ctx_arg.is_object() {
                            stream.set_context(stream_ctx_arg, global_object);
                        }
                        stream.rst_code = ErrorCode::COMPRESSION_ERROR.0;
                        this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, stream.get_identifier(), JSValue::js_number(stream.rst_code));
                        return Ok(JSValue::js_number(stream_id));
                    }
                }
            }
        }
        let encoded_size = encoded_headers.len();

        let Some(stream_ptr) = this.handle_received_stream_id(stream_id) else {
            return Ok(JSValue::js_number(-1));
        };
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
        if args_list.len() > 4 && !args_list.ptr[4].is_empty_or_undefined_or_null() {
            let options = args_list.ptr[4];
            if !options.is_object() {
                stream.state = StreamState::CLOSED;
                stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
                this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, stream.get_identifier(), JSValue::js_number(stream.rst_code));
                return Ok(JSValue::js_number(stream_id));
            }

            if let Some(padding_js) = options.get(global_object, "paddingStrategy")? {
                if padding_js.is_number() {
                    stream.padding_strategy = match padding_js.to::<u32>() {
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
                    return global_object.throw_invalid_argument_type_value("options.silent", "boolean", silent_js);
                }
            }

            if let Some(end_stream_js) = options.get(global_object, "endStream")? {
                if end_stream_js.is_boolean() {
                    if end_stream_js.as_boolean() {
                        end_stream = true;
                        // will end the stream after trailers
                        if !wait_for_trailers || this.is_server {
                            flags |= HeadersFrameFlags::END_STREAM as u8;
                        }
                    }
                } else {
                    return global_object.throw_invalid_argument_type_value("options.endStream", "boolean", end_stream_js);
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
                    return global_object.throw_invalid_argument_type_value("options.exclusive", "boolean", exclusive_js);
                }
            }

            if let Some(parent_js) = options.get(global_object, "parent")? {
                if parent_js.is_number() || parent_js.is_int32() {
                    has_priority = true;
                    parent = parent_js.to_int32();
                    if parent <= 0 || parent as u32 > MAX_STREAM_ID {
                        stream.state = StreamState::CLOSED;
                        stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
                        this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, stream.get_identifier(), JSValue::js_number(stream.rst_code));
                        return Ok(JSValue::js_number(stream.id));
                    }
                    stream.stream_dependency = u32::try_from(parent).unwrap();
                } else {
                    return global_object.throw_invalid_argument_type_value("options.parent", "number", parent_js);
                }
            }

            if let Some(weight_js) = options.get(global_object, "weight")? {
                if weight_js.is_number() || weight_js.is_int32() {
                    has_priority = true;
                    weight = weight_js.to_int32();
                    if weight < 1 || weight > u8::MAX as i32 {
                        stream.state = StreamState::CLOSED;
                        stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
                        this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, stream.get_identifier(), JSValue::js_number(stream.rst_code));
                        return Ok(JSValue::js_number(stream_id));
                    }
                    stream.weight = u16::try_from(weight).unwrap();
                } else {
                    return global_object.throw_invalid_argument_type_value("options.weight", "number", weight_js);
                }

                if weight < 1 || weight > u8::MAX as i32 {
                    stream.state = StreamState::CLOSED;
                    stream.rst_code = ErrorCode::INTERNAL_ERROR.0;
                    this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, stream.get_identifier(), JSValue::js_number(stream.rst_code));
                    return Ok(JSValue::js_number(stream_id));
                }

                stream.weight = u16::try_from(weight).unwrap();
            }

            if let Some(signal_arg) = options.get(global_object, "signal")? {
                if let Some(signal_) = signal_arg.as_::<AbortSignal>() {
                    if signal_.aborted() {
                        stream.state = StreamState::IDLE;
                        let wrapped = unsafe { Bun__wrapAbortError(global_object, signal_.abort_reason()) };
                        this.abort_stream(stream, wrapped);
                        return Ok(JSValue::js_number(stream_id));
                    }
                    stream.attach_signal(this, signal_);
                } else {
                    return global_object.throw_invalid_argument_type_value("options.signal", "AbortSignal", signal_arg);
                }
            }
        }

        // too much memory being use
        if this.get_session_memory_usage() > this.max_session_memory as usize {
            stream.state = StreamState::CLOSED;
            stream.rst_code = ErrorCode::ENHANCE_YOUR_CALM.0;
            this.rejected_streams += 1;
            this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, stream.get_identifier(), JSValue::js_number(stream.rst_code));
            if this.rejected_streams >= this.max_rejected_streams {
                let global = unsafe { &*this.handlers.global_object };
                let chunk = this.handlers.binary_type.to_js(b"ENHANCE_YOUR_CALM", global)?;
                this.dispatch_with_2_extra(JSH2FrameParser::Gc::onError, JSValue::js_number(ErrorCode::ENHANCE_YOUR_CALM.0), JSValue::js_number(this.last_stream_id), chunk);
            }
            return Ok(JSValue::js_number(stream_id));
        }
        let mut length: usize = encoded_size;
        if has_priority {
            length += 5;
            flags |= HeadersFrameFlags::PRIORITY as u8;
        }

        bun_output::scoped_log!(H2FrameParser, "request encoded_size {}", encoded_size);

        // Check if headers block exceeds maxSendHeaderBlockLength
        if this.max_send_header_block_length != 0 && encoded_size > this.max_send_header_block_length as usize {
            stream.state = StreamState::CLOSED;
            stream.rst_code = ErrorCode::REFUSED_STREAM.0;

            this.dispatch_with_2_extra(
                JSH2FrameParser::Gc::onFrameError,
                stream.get_identifier(),
                JSValue::js_number(FrameType::HTTP_FRAME_HEADERS as u8),
                JSValue::js_number(ErrorCode::FRAME_SIZE_ERROR.0),
            );

            this.dispatch_with_extra(JSH2FrameParser::Gc::onStreamError, stream.get_identifier(), JSValue::js_number(stream.rst_code));
            return Ok(JSValue::js_number(stream_id));
        }

        let actual_max_frame_size = this.remote_settings.unwrap_or(this.local_settings).max_frame_size as usize;
        let priority_overhead: usize = if has_priority { StreamPriority::BYTE_SIZE } else { 0 };
        let available_payload = actual_max_frame_size - priority_overhead;
        let padding: u8 = if encoded_size > available_payload {
            0
        } else {
            stream.get_padding(encoded_size, available_payload)
        };
        let padding_overhead: usize = if padding != 0 { padding as usize + 1 } else { 0 };
        let headers_frame_max_payload = available_payload - padding_overhead;

        let mut writer = this.to_writer();

        // Check if we need CONTINUATION frames
        if encoded_size <= headers_frame_max_payload {
            // Single HEADERS frame - fits in one frame
            let payload_size = encoded_size + priority_overhead + padding_overhead;
            bun_output::scoped_log!(H2FrameParser, "padding: {} size: {} max_size: {} payload_size: {}", padding, encoded_size, encoded_headers.len(), payload_size);

            if padding != 0 {
                flags |= HeadersFrameFlags::PADDED as u8;
            }

            let mut frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags,
                stream_identifier: stream.id,
                length: u32::try_from(payload_size).unwrap(),
            };
            let _ = frame.write(&mut writer);

            // Write priority data if present
            if has_priority {
                let stream_identifier = UInt31WithReserved::init(u32::try_from(parent).unwrap(), exclusive);
                let mut priority_data = StreamPriority {
                    stream_identifier: stream_identifier.to_uint32(),
                    weight: u8::try_from(weight).unwrap(),
                };
                let _ = priority_data.write(&mut writer);
            }

            // Handle padding
            if padding != 0 {
                if encoded_headers.try_reserve(encoded_size + padding_overhead - encoded_headers.len()).is_err() {
                    return global_object.throw("Failed to allocate padding buffer");
                }
                // SAFETY: capacity ensured above; we treat allocatedSlice manually
                unsafe { encoded_headers.set_len(encoded_headers.capacity()) };
                let buffer = encoded_headers.as_mut_slice();
                // memmove: shift right by 1
                unsafe { core::ptr::copy(buffer.as_ptr(), buffer.as_mut_ptr().add(1), encoded_size) };
                buffer[0] = padding;
                let _ = writer.write(&buffer[0..encoded_size + padding_overhead]);
            } else {
                let _ = writer.write(&encoded_headers);
            }
        } else {
            bun_output::scoped_log!(H2FrameParser, "Using CONTINUATION frames: encoded_size={} max_frame_payload={}", encoded_size, actual_max_frame_size);

            let first_chunk_size = actual_max_frame_size - priority_overhead;
            let headers_flags = flags & !(HeadersFrameFlags::END_HEADERS as u8);

            let mut headers_frame = FrameHeader {
                type_: FrameType::HTTP_FRAME_HEADERS as u8,
                flags: headers_flags | (if has_priority { HeadersFrameFlags::PRIORITY as u8 } else { 0 }),
                stream_identifier: stream.id,
                length: u32::try_from(first_chunk_size + priority_overhead).unwrap(),
            };
            let _ = headers_frame.write(&mut writer);

            if has_priority {
                let stream_identifier = UInt31WithReserved::init(u32::try_from(parent).unwrap(), exclusive);
                let mut priority_data = StreamPriority {
                    stream_identifier: stream_identifier.to_uint32(),
                    weight: u8::try_from(weight).unwrap(),
                };
                let _ = priority_data.write(&mut writer);
            }

            // Write first chunk of header block fragment
            let _ = writer.write(&encoded_headers[0..first_chunk_size]);

            let mut offset: usize = first_chunk_size;
            while offset < encoded_size {
                let remaining = encoded_size - offset;
                let chunk_size = remaining.min(actual_max_frame_size);
                let is_last = offset + chunk_size >= encoded_size;

                let mut cont_frame = FrameHeader {
                    type_: FrameType::HTTP_FRAME_CONTINUATION as u8,
                    flags: if is_last { HeadersFrameFlags::END_HEADERS as u8 } else { 0 },
                    stream_identifier: stream.id,
                    length: u32::try_from(chunk_size).unwrap(),
                };
                let _ = cont_frame.write(&mut writer);
                let _ = writer.write(&encoded_headers[offset..offset + chunk_size]);

                offset += chunk_size;
            }
        }

        if end_stream {
            stream.end_after_headers = true;
            stream.state = StreamState::HALF_CLOSED_LOCAL;

            if wait_for_trailers {
                this.dispatch(JSH2FrameParser::Gc::onWantTrailers, stream.get_identifier());
                return Ok(JSValue::js_number(stream_id));
            }
        } else {
            stream.wait_for_trailers = wait_for_trailers;
        }

        if silent {
            // TODO: should we make use of this in the future? We validate it.
        }

        let _ = length;
        Ok(JSValue::js_number(stream_id))
    }

    #[bun_jsc::host_fn(method)]
    pub fn read(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected 1 argument");
        }
        let buffer = args_list.ptr[0];
        buffer.ensure_still_alive();
        let result = if let Some(array_buffer) = buffer.as_array_buffer(global_object) {
            let mut bytes = array_buffer.byte_slice();
            // read all the bytes
            while !bytes.is_empty() {
                let result = this.read_bytes(bytes)?;
                bytes = &bytes[result..];
            }
            Ok(JSValue::UNDEFINED)
        } else {
            global_object.throw("Expected data to be a Buffer or ArrayBuffer")
        };
        // defer
        this.increment_window_size_if_needed();
        result
    }

    pub fn on_native_read(&mut self, data: &[u8]) -> JsResult<()> {
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

    pub fn on_native_writable(&mut self) {
        let _ = self.flush();
    }

    pub fn on_native_close(&mut self) {
        bun_output::scoped_log!(H2FrameParser, "onNativeClose");
        self.detach_native_socket();
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_native_socket_from_js(this: &mut Self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected socket argument");
        }

        let socket_js = args_list.ptr[0];
        this.detach_native_socket();
        if let Some(socket) = JSTLSSocket::from_js(socket_js) {
            bun_output::scoped_log!(H2FrameParser, "TLSSocket attached");
            if socket.attach_native_callback(bun_runtime::api::socket::NativeCallback::H2(this)) {
                this.native_socket = BunSocket::Tls(socket);
            } else {
                socket.ref_();
                this.native_socket = BunSocket::TlsWriteonly(socket);
            }
            this.has_nonnative_backpressure = false;
            let _ = this.flush();
        } else if let Some(socket) = JSTCPSocket::from_js(socket_js) {
            bun_output::scoped_log!(H2FrameParser, "TCPSocket attached");
            if socket.attach_native_callback(bun_runtime::api::socket::NativeCallback::H2(this)) {
                this.native_socket = BunSocket::Tcp(socket);
            } else {
                socket.ref_();
                this.native_socket = BunSocket::TcpWriteonly(socket);
            }
            this.has_nonnative_backpressure = false;
            let _ = this.flush();
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn detach_native_socket(&mut self) {
        let native_socket = core::mem::take(&mut self.native_socket);

        match native_socket {
            BunSocket::Tcp(socket) => unsafe { (*socket).detach_native_callback() },
            BunSocket::Tls(socket) => unsafe { (*socket).detach_native_callback() },
            BunSocket::TcpWriteonly(socket) => unsafe { (*socket).deref() },
            BunSocket::TlsWriteonly(socket) => unsafe { (*socket).deref() },
            BunSocket::None => {}
        }
    }

    pub fn constructor(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<*mut H2FrameParser> {
        let args_list = callframe.arguments_old(1);
        if args_list.len() < 1 {
            return global_object.throw("Expected 1 argument");
        }

        let options = args_list.ptr[0];
        if options.is_empty_or_undefined_or_null() || options.is_boolean() || !options.is_object() {
            return global_object.throw_invalid_arguments("expected options as argument");
        }

        let Some(context_obj) = options.get(global_object, "context")? else {
            return global_object.throw("Expected \"context\" option");
        };
        let mut handler_js = JSValue::ZERO;
        if let Some(handlers_) = options.get(global_object, "handlers")? {
            handler_js = handlers_;
        }
        let handlers = Handlers::from_js(global_object, handler_js, this_value)?;

        // PERF(port): was HiveArray pool — profile in Phase B
        // TODO(port): ENABLE_ALLOCATOR_POOL path uses thread-local HiveArray; for now Box::new
        let this: *mut H2FrameParser = Box::into_raw(Box::new(H2FrameParser {
            ref_count: Cell::new(1),
            handlers,
            global_this: global_object as *const _,
            strong_this: JsRef::empty(),
            native_socket: BunSocket::None,
            local_settings: FullSettingsPayload::default(),
            remote_settings: None,
            current_frame: None,
            remaining_length: 0,
            read_buffer: MutableString::default(),
            window_size: DEFAULT_WINDOW_SIZE,
            used_window_size: 0,
            remote_window_size: DEFAULT_WINDOW_SIZE,
            remote_used_window_size: 0,
            max_header_list_pairs: 128,
            max_rejected_streams: 100,
            max_outstanding_settings: 10,
            outstanding_settings: 0,
            rejected_streams: 0,
            max_session_memory: 10,
            queued_data_size: 0,
            max_outstanding_pings: 10,
            out_standing_pings: 0,
            max_send_header_block_length: 0,
            last_stream_id: 0,
            is_server: false,
            preface_received_len: 0,
            write_buffer: ByteList::default(),
            write_buffer_offset: 0,
            outbound_queue_size: 0,
            streams: BunHashMap::default(),
            hpack: None,
            has_nonnative_backpressure: false,
            auto_flusher: AutoFlusher::default(),
            padding_strategy: PaddingStrategy::None,
        }));
        let this_ref = unsafe { &mut *this };
        // TODO(port): errdefer this.deinit() — use scopeguard in Phase B

        // check if socket is provided, and if it is a valid native socket
        if let Some(socket_js) = options.get(global_object, "native")? {
            if let Some(socket) = JSTLSSocket::from_js(socket_js) {
                bun_output::scoped_log!(H2FrameParser, "TLSSocket attached");
                if socket.attach_native_callback(bun_runtime::api::socket::NativeCallback::H2(this)) {
                    this_ref.native_socket = BunSocket::Tls(socket);
                } else {
                    socket.ref_();
                    this_ref.native_socket = BunSocket::TlsWriteonly(socket);
                }
                let _ = this_ref.flush();
            } else if let Some(socket) = JSTCPSocket::from_js(socket_js) {
                bun_output::scoped_log!(H2FrameParser, "TCPSocket attached");
                if socket.attach_native_callback(bun_runtime::api::socket::NativeCallback::H2(this)) {
                    this_ref.native_socket = BunSocket::Tcp(socket);
                } else {
                    socket.ref_();
                    this_ref.native_socket = BunSocket::TcpWriteonly(socket);
                }
                let _ = this_ref.flush();
            }
        }
        if let Some(settings_js) = options.get(global_object, "settings")? {
            if !settings_js.is_empty_or_undefined_or_null() {
                bun_output::scoped_log!(H2FrameParser, "settings received in the constructor");
                this_ref.load_settings_from_js_value(global_object, settings_js)?;

                if let Some(max_pings) = settings_js.get(global_object, "maxOutstandingPings")? {
                    if max_pings.is_number() {
                        this_ref.max_outstanding_pings = max_pings.to::<u64>();
                    }
                }
                if let Some(max_memory) = settings_js.get(global_object, "maxSessionMemory")? {
                    if max_memory.is_number() {
                        this_ref.max_session_memory = max_memory.to::<u64>() as u32;
                        if this_ref.max_session_memory < 1 {
                            this_ref.max_session_memory = 1;
                        }
                    }
                }
                if let Some(max_header_list_pairs) = settings_js.get(global_object, "maxHeaderListPairs")? {
                    if max_header_list_pairs.is_number() {
                        this_ref.max_header_list_pairs = max_header_list_pairs.to::<u64>() as u32;
                        if this_ref.max_header_list_pairs < 4 {
                            this_ref.max_header_list_pairs = 4;
                        }
                    }
                }
                if let Some(max_rejected_streams) = settings_js.get(global_object, "maxSessionRejectedStreams")? {
                    if max_rejected_streams.is_number() {
                        this_ref.max_rejected_streams = max_rejected_streams.to::<u64>() as u32;
                    }
                }
                if let Some(max_outstanding_settings) = settings_js.get(global_object, "maxOutstandingSettings")? {
                    if max_outstanding_settings.is_number() {
                        this_ref.max_outstanding_settings = (max_outstanding_settings.to::<u64>() as u32).max(1);
                    }
                }
                if let Some(max_send_header_block_length) = settings_js.get(global_object, "maxSendHeaderBlockLength")? {
                    if max_send_header_block_length.is_number() {
                        // SAFETY: i32→u32 bitcast
                        this_ref.max_send_header_block_length = unsafe { core::mem::transmute::<i32, u32>(max_send_header_block_length.to_int32()) };
                    }
                }
                if let Some(padding_strategy) = settings_js.get(global_object, "paddingStrategy")? {
                    if padding_strategy.is_number() {
                        this_ref.padding_strategy = match padding_strategy.to::<u32>() {
                            1 => PaddingStrategy::Aligned,
                            2 => PaddingStrategy::Max,
                            _ => PaddingStrategy::None,
                        };
                    }
                }
            }
        }
        let mut is_server = false;
        if let Some(type_js) = options.get(global_object, "type")? {
            is_server = type_js.is_number() && type_js.to::<u32>() == 0;
        }

        this_ref.is_server = is_server;
        JSH2FrameParser::Gc::context.set(this_value, global_object, context_obj);

        this_ref.strong_this.set_strong(this_value, global_object);

        this_ref.hpack = Some(lshpack::HPACK::init(this_ref.local_settings.header_table_size));
        if is_server {
            let _ = this_ref.set_settings(this_ref.local_settings);
        } else {
            // consider that we need to queue until the first flush
            this_ref.has_nonnative_backpressure = true;
            this_ref.send_preface_and_settings();
        }
        Ok(this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn detach_from_js(this: &mut Self, _global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        let self_ptr = this as *mut Self;
        let mut it = StreamResumableIterator::init(unsafe { &mut *self_ptr });
        while let Some(stream) = it.next() {
            unsafe { (*stream).free_resources::<false>(this) };
        }
        this.detach();
        if let Some(this_value) = this.strong_this.try_get() {
            JSH2FrameParser::Gc::context.clear(this_value, unsafe { &*this.global_this });
            this.strong_this.set_weak(this_value);
        }
        Ok(JSValue::UNDEFINED)
    }

    /// be careful when calling detach be sure that the socket is closed and the parser not accesible anymore
    /// this function can be called multiple times, it will erase stream info
    pub fn detach(&mut self) {
        self.uncork();
        self.unregister_auto_flush();
        self.detach_native_socket();

        self.read_buffer.deinit();
        self.write_buffer.clear_and_free();
        self.write_buffer_offset = 0;

        if let Some(hpack) = self.hpack.take() {
            drop(hpack);
        }
    }

    fn deinit(&mut self) {
        bun_output::scoped_log!(H2FrameParser, "deinit");

        self.detach();
        self.strong_this.deinit();
        for (_, item) in self.streams.iter() {
            let stream = *item;
            unsafe {
                (*stream).free_resources::<true>(self);
                drop(Box::from_raw(stream));
            }
        }
        let streams = core::mem::replace(&mut self.streams, BunHashMap::default());
        drop(streams);

        // defer: pool.put(this) / bun.destroy(this)
        // TODO(port): ENABLE_ALLOCATOR_POOL path — for now leak; finalize() owns Box drop via codegen
        if ENABLE_ALLOCATOR_POOL {
            // POOL.with_borrow_mut(|p| p.as_mut().unwrap().put(self));
            // TODO(port): HiveArray.put requires *mut Self from pool slot
        } else {
            // SAFETY: self was Box::into_raw'd in constructor
            unsafe { drop(Box::from_raw(self as *mut Self)) };
        }
    }

    pub fn finalize(this: *mut Self) {
        bun_output::scoped_log!(H2FrameParser, "finalize");
        // SAFETY: called by JSC finalizer on mutator thread
        unsafe {
            (*this).strong_this.deinit();
            (*this).deref();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/h2_frame_parser.zig (4879 lines)
//   confidence: low
//   todos:      27
//   notes:      Heavy borrowck reshaping (raw *mut Stream / *mut Self); FrameHeader packed-u72 wire layout reimplemented manually; HiveArray pool stubbed; read_buffer.reset() vs Payload aliasing needs Phase-B audit; ERR(.X) calls mapped to placeholder methods.
// ──────────────────────────────────────────────────────────────────────────
