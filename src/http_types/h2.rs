//! HTTP/2 wire-format types (RFC 7540 / 9113). Pure-data tier-1 module —
//! zero JSC, socket, or io dependencies. Shared by:
//!   • `bun_http`    (fetch() HTTP/2 client) — re-exported as `h2_frame_parser`
//!   • `bun_runtime` (node:http2 bindings)   — `pub use`d into its
//!     `h2_frame_parser` module, which layers `WireWriter`-based `write()`
//!     and `to_js()` on top as local extension traits.
//!
//! The Zig tree carries TWO copies of these types (`src/http/H2FrameParser.zig`
//! and a private duplicate inside `src/runtime/api/bun/h2_frame_parser.zig`);
//! the http copy's own doc-comment already promised this dedup. This module is
//! that promise kept on the Rust side.
#![allow(non_camel_case_types, non_upper_case_globals)]

// ─── connection / sizing constants ──────────────

pub const CLIENT_PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

pub const MAX_WINDOW_SIZE: u32 = i32::MAX as u32;
pub const MAX_HEADER_TABLE_SIZE: u32 = u32::MAX;
pub const MAX_STREAM_ID: u32 = i32::MAX as u32;
/// `std.math.maxInt(u24)`
pub const MAX_FRAME_SIZE: u32 = 0x00FF_FFFF;
pub const DEFAULT_WINDOW_SIZE: u32 = u16::MAX as u32;
/// PORT NOTE: Zig type was `u24`; Rust has no `u24`, so widened to `u32`.
pub const DEFAULT_MAX_FRAME_SIZE: u32 = 16384;

// ─── frame type / flags ─────────────────────────
//
// PORT NOTE: Zig `enum(u8) { …, _ }` is non-exhaustive (any u8 is a valid
// value). A `#[repr(u8)]` Rust enum is UB for unknown discriminants received
// off the wire, so callers dispatch on the raw `u8` (`FrameHeader.type_`) and
// only ever use this enum for *outbound* frame construction (`X as u8`).

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FrameType {
    HTTP_FRAME_DATA = 0x00,
    HTTP_FRAME_HEADERS = 0x01,
    HTTP_FRAME_PRIORITY = 0x02,
    HTTP_FRAME_RST_STREAM = 0x03,
    HTTP_FRAME_SETTINGS = 0x04,
    HTTP_FRAME_PUSH_PROMISE = 0x05,
    HTTP_FRAME_PING = 0x06,
    HTTP_FRAME_GOAWAY = 0x07,
    HTTP_FRAME_WINDOW_UPDATE = 0x08,
    /// RFC 7540 §6.10: continues a header block fragment.
    HTTP_FRAME_CONTINUATION = 0x09,
    /// <https://datatracker.ietf.org/doc/html/rfc7838#section-7.2>
    HTTP_FRAME_ALTSVC = 0x0A,
    /// <https://datatracker.ietf.org/doc/html/rfc8336#section-2>
    HTTP_FRAME_ORIGIN = 0x0C,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PingFrameFlags {
    ACK = 0x1,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DataFrameFlags {
    END_STREAM = 0x1,
    PADDED = 0x8,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum HeadersFrameFlags {
    END_STREAM = 0x1,
    END_HEADERS = 0x4,
    PADDED = 0x8,
    PRIORITY = 0x20,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum SettingsFlags {
    ACK = 0x1,
}

// ─── error / setting codes ──────────────────────
//
// Non-exhaustive in Zig (`_` catch-all). Newtype-over-int instead of
// `#[repr]` enums so any value off the wire is well-defined; consumers match
// on `.0` or the associated consts.

#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct ErrorCode(pub u32);
impl ErrorCode {
    pub const NO_ERROR: Self = Self(0x0);
    pub const PROTOCOL_ERROR: Self = Self(0x1);
    pub const INTERNAL_ERROR: Self = Self(0x2);
    pub const FLOW_CONTROL_ERROR: Self = Self(0x3);
    pub const SETTINGS_TIMEOUT: Self = Self(0x4);
    pub const STREAM_CLOSED: Self = Self(0x5);
    pub const FRAME_SIZE_ERROR: Self = Self(0x6);
    pub const REFUSED_STREAM: Self = Self(0x7);
    pub const CANCEL: Self = Self(0x8);
    pub const COMPRESSION_ERROR: Self = Self(0x9);
    pub const CONNECT_ERROR: Self = Self(0xa);
    pub const ENHANCE_YOUR_CALM: Self = Self(0xb);
    pub const INADEQUATE_SECURITY: Self = Self(0xc);
    pub const HTTP_1_1_REQUIRED: Self = Self(0xd);
    pub const MAX_PENDING_SETTINGS_ACK: Self = Self(0xe);
}

#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct SettingsType(pub u16);
impl SettingsType {
    pub const SETTINGS_HEADER_TABLE_SIZE: Self = Self(0x1);
    pub const SETTINGS_ENABLE_PUSH: Self = Self(0x2);
    pub const SETTINGS_MAX_CONCURRENT_STREAMS: Self = Self(0x3);
    pub const SETTINGS_INITIAL_WINDOW_SIZE: Self = Self(0x4);
    pub const SETTINGS_MAX_FRAME_SIZE: Self = Self(0x5);
    pub const SETTINGS_MAX_HEADER_LIST_SIZE: Self = Self(0x6);
    // Non-standard extension settings (still unsupported):
    pub const SETTINGS_ENABLE_CONNECT_PROTOCOL: Self = Self(0x8);
    pub const SETTINGS_NO_RFC7540_PRIORITIES: Self = Self(0x9);
}

// ─── wire helpers ───────────────────────────────

#[inline]
pub fn u32_from_bytes(src: &[u8]) -> u32 {
    debug_assert!(src.len() == 4);
    u32::from_be_bytes([src[0], src[1], src[2], src[3]])
}

/// Zig: `packed struct(u32) { reserved: bool = false, uint31: u31 = 0 }`.
///
/// PORT NOTE (intentional divergence): Zig's `toUInt32()` is `@bitCast` of
/// `packed struct(u32){ reserved: bool, uint31: u31 }`, which on little-endian
/// places `reserved` in bit 0 and yields `(uint31 << 1) | reserved`. That is a
/// latent RFC 7540 §6.3 bug in Zig's deprecated PRIORITY path — the wire
/// format wants the reserved/E bit at bit 31. We keep the RFC-compliant
/// `(reserved << 31) | uint31` layout here, which already matches
/// `from_bytes`/`encode_into` and the on-wire `StreamPriority.stream_identifier`.
#[repr(transparent)]
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub struct UInt31WithReserved(u32);

impl UInt31WithReserved {
    #[inline]
    pub const fn reserved(self) -> bool {
        self.0 & 0x8000_0000 != 0
    }
    #[inline]
    pub const fn uint31(self) -> u32 {
        self.0 & 0x7fff_ffff
    }
    #[inline]
    pub const fn from(value: u32) -> Self {
        Self(value)
    }
    #[inline]
    pub const fn init(value: u32, reserved: bool) -> Self {
        Self((value & 0x7fff_ffff) | if reserved { 0x8000_0000 } else { 0 })
    }
    #[inline]
    pub const fn to_uint32(self) -> u32 {
        self.0
    }
    #[inline]
    pub fn from_bytes(src: &[u8]) -> Self {
        Self(u32_from_bytes(src))
    }
    #[inline]
    pub fn encode_into(self, dst: &mut [u8; 4]) {
        *dst = self.0.to_be_bytes();
    }
}

// ─── packed wire structs ────────────────────────
//
// `StreamPriority`, `SettingsPayloadUnit` and `FullSettingsPayload` are
// `#[repr(C, packed)]` with integer-only fields and therefore have no padding
// bytes and no niches. They implement `bytemuck::Pod`, so the per-`from()`
// byte-view that the Zig parser did via `@ptrCast` is the safe
// `bytemuck::bytes_of_mut`.

/// Zig: `packed struct(u40) { streamIdentifier: u32 = 0, weight: u8 = 0 }`.
#[repr(C, packed)]
#[derive(Copy, Clone, Default)]
pub struct StreamPriority {
    pub stream_identifier: u32,
    pub weight: u8,
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
    pub fn from(dst: &mut StreamPriority, src: &[u8]) {
        bytemuck::bytes_of_mut(dst).copy_from_slice(src);
        // std.mem.byteSwapAllFields(StreamPriority, dst) — `weight: u8` is a no-op.
        // PORT NOTE: brace-expr `{packed.field}` performs an unaligned copy;
        // assignment to a packed field is an unaligned store. No `unsafe`.
        dst.stream_identifier = u32::swap_bytes({ dst.stream_identifier });
    }

    #[inline]
    pub fn encode_into(&self, dst: &mut [u8; Self::BYTE_SIZE]) {
        let mut swap = *self;
        swap.stream_identifier = u32::swap_bytes({ swap.stream_identifier });
        dst.copy_from_slice(bytemuck::bytes_of(&swap));
    }
}

/// Zig: `packed struct(u72) { length: u24, type: u8, flags: u8, streamIdentifier: u32 }`.
///
/// NOT `#[repr(packed)]` — the `u24` length is widened to a native `u32`
/// in-memory; wire encoding is handled in `decode()`/`encode_into()` instead
/// of by punning the struct bytes. Callers assemble the 9 raw wire bytes on
/// the stack and hand them to `decode()`.
#[derive(Copy, Clone)]
pub struct FrameHeader {
    /// `u24` on the wire.
    pub length: u32,
    pub type_: u8,
    pub flags: u8,
    pub stream_identifier: u32,
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

    /// Decode a complete 9-byte big-endian frame header.
    #[inline]
    pub fn decode(raw: &[u8; Self::BYTE_SIZE]) -> Self {
        Self {
            length: ((raw[0] as u32) << 16) | ((raw[1] as u32) << 8) | (raw[2] as u32),
            type_: raw[3],
            flags: raw[4],
            stream_identifier: u32::from_be_bytes([raw[5], raw[6], raw[7], raw[8]]),
        }
    }

    #[inline]
    pub fn encode_into(&self, dst: &mut [u8; Self::BYTE_SIZE]) {
        // std.mem.byteSwapAllFields on `packed struct(u72)` — emit BE manually.
        dst[0] = ((self.length >> 16) & 0xFF) as u8;
        dst[1] = ((self.length >> 8) & 0xFF) as u8;
        dst[2] = (self.length & 0xFF) as u8;
        dst[3] = self.type_;
        dst[4] = self.flags;
        dst[5..9].copy_from_slice(&self.stream_identifier.to_be_bytes());
    }
}

/// Zig: `packed struct(u48) { type: u16, value: u32 }`.
#[repr(C, packed)]
#[derive(Copy, Clone, Default)]
pub struct SettingsPayloadUnit {
    pub type_: u16,
    pub value: u32,
}
// SAFETY: `#[repr(C, packed)]` with `u16 + u32` fields — no padding, no
// niches, every 6-byte pattern is a valid value.
unsafe impl bytemuck::Zeroable for SettingsPayloadUnit {}
// SAFETY: see `Zeroable` impl above; additionally `Copy + 'static`.
unsafe impl bytemuck::Pod for SettingsPayloadUnit {}
const _: () = assert!(core::mem::size_of::<SettingsPayloadUnit>() == SettingsPayloadUnit::BYTE_SIZE);

impl SettingsPayloadUnit {
    pub const BYTE_SIZE: usize = 6;

    #[inline]
    pub fn from<const END: bool>(dst: &mut SettingsPayloadUnit, src: &[u8], offset: usize) {
        let bytes = bytemuck::bytes_of_mut(dst);
        bytes[offset..src.len() + offset].copy_from_slice(src);
        if END {
            // std.mem.byteSwapAllFields(SettingsPayloadUnit, dst)
            dst.type_ = u16::swap_bytes({ dst.type_ });
            dst.value = u32::swap_bytes({ dst.value });
        }
    }

    #[inline]
    pub fn encode(dst: &mut [u8; Self::BYTE_SIZE], setting: SettingsType, value: u32) {
        dst[0..2].copy_from_slice(&setting.0.to_be_bytes());
        dst[2..6].copy_from_slice(&value.to_be_bytes());
    }
}

/// Zig: `packed struct(u336)` — 7 × (`u16` type + `u32` value) = 42 bytes.
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct FullSettingsPayload {
    _header_table_size_type: u16,
    pub header_table_size: u32,
    _enable_push_type: u16,
    pub enable_push: u32,
    _max_concurrent_streams_type: u16,
    pub max_concurrent_streams: u32,
    _initial_window_size_type: u16,
    pub initial_window_size: u32,
    _max_frame_size_type: u16,
    pub max_frame_size: u32,
    _max_header_list_size_type: u16,
    pub max_header_list_size: u32,
    _enable_connect_protocol_type: u16,
    pub enable_connect_protocol: u32,
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
            max_concurrent_streams: u32::MAX,
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

    pub fn update_with(&mut self, option: SettingsPayloadUnit) {
        match SettingsType({ option.type_ }) {
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

    /// `std.mem.byteSwapAllFields` — write the big-endian wire image.
    pub fn encode_into(&self, dst: &mut [u8; Self::BYTE_SIZE]) {
        let mut swap = *self;
        swap._header_table_size_type = swap._header_table_size_type.swap_bytes();
        swap.header_table_size = u32::swap_bytes({ swap.header_table_size });
        swap._enable_push_type = swap._enable_push_type.swap_bytes();
        swap.enable_push = u32::swap_bytes({ swap.enable_push });
        swap._max_concurrent_streams_type = swap._max_concurrent_streams_type.swap_bytes();
        swap.max_concurrent_streams = u32::swap_bytes({ swap.max_concurrent_streams });
        swap._initial_window_size_type = swap._initial_window_size_type.swap_bytes();
        swap.initial_window_size = u32::swap_bytes({ swap.initial_window_size });
        swap._max_frame_size_type = swap._max_frame_size_type.swap_bytes();
        swap.max_frame_size = u32::swap_bytes({ swap.max_frame_size });
        swap._max_header_list_size_type = swap._max_header_list_size_type.swap_bytes();
        swap.max_header_list_size = u32::swap_bytes({ swap.max_header_list_size });
        swap._enable_connect_protocol_type = swap._enable_connect_protocol_type.swap_bytes();
        swap.enable_connect_protocol = u32::swap_bytes({ swap.enable_connect_protocol });
        dst.copy_from_slice(bytemuck::bytes_of(&swap));
    }
}

// ported from: src/http/H2FrameParser.zig + src/runtime/api/bun/h2_frame_parser.zig (wire types)
