//! HTTP/2 wire-format types for the fetch() HTTP/2 client. Kept free of JSC
//! and socket dependencies so the node:http2 JS bindings (which currently
//! carry their own copies in src/runtime/api/bun/h2_frame_parser.zig) can later
//! share them.

pub const CLIENT_PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

pub const MAX_WINDOW_SIZE: u32 = i32::MAX as u32;
pub const MAX_HEADER_TABLE_SIZE: u32 = u32::MAX;
pub const MAX_STREAM_ID: u32 = i32::MAX as u32;
pub const MAX_FRAME_SIZE: u32 = 0x00FF_FFFF; // std.math.maxInt(u24)
pub const DEFAULT_WINDOW_SIZE: u32 = u16::MAX as u32;
// TODO(port): Zig type was u24; Rust has no u24 so widened to u32.
pub const DEFAULT_MAX_FRAME_SIZE: u32 = 16384;

// TODO(port): Zig `enum(u8) { ... , _ }` is non-exhaustive (any u8 is a valid
// value). A #[repr(u8)] Rust enum is UB for unknown discriminants received off
// the wire — Phase B should consider a `#[repr(transparent)] struct FrameType(u8)`
// with associated consts if values are ever transmuted from raw bytes.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
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
    HTTP_FRAME_CONTINUATION = 0x09,
    HTTP_FRAME_ALTSVC = 0x0A,
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

// TODO(port): non-exhaustive in Zig (`_`); see note on FrameType.
#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ErrorCode {
    NO_ERROR = 0x0,
    PROTOCOL_ERROR = 0x1,
    INTERNAL_ERROR = 0x2,
    FLOW_CONTROL_ERROR = 0x3,
    SETTINGS_TIMEOUT = 0x4,
    STREAM_CLOSED = 0x5,
    FRAME_SIZE_ERROR = 0x6,
    REFUSED_STREAM = 0x7,
    CANCEL = 0x8,
    COMPRESSION_ERROR = 0x9,
    CONNECT_ERROR = 0xa,
    ENHANCE_YOUR_CALM = 0xb,
    INADEQUATE_SECURITY = 0xc,
    HTTP_1_1_REQUIRED = 0xd,
    MAX_PENDING_SETTINGS_ACK = 0xe,
}

// TODO(port): non-exhaustive in Zig (`_`); see note on FrameType.
#[repr(u16)]
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum SettingsType {
    SETTINGS_HEADER_TABLE_SIZE = 0x1,
    SETTINGS_ENABLE_PUSH = 0x2,
    SETTINGS_MAX_CONCURRENT_STREAMS = 0x3,
    SETTINGS_INITIAL_WINDOW_SIZE = 0x4,
    SETTINGS_MAX_FRAME_SIZE = 0x5,
    SETTINGS_MAX_HEADER_LIST_SIZE = 0x6,
    SETTINGS_ENABLE_CONNECT_PROTOCOL = 0x8,
    SETTINGS_NO_RFC7540_PRIORITIES = 0x9,
}

#[inline]
pub fn u32_from_bytes(src: &[u8]) -> u32 {
    debug_assert!(src.len() == 4);
    u32::from_be_bytes([src[0], src[1], src[2], src[3]])
}

/// Zig: `packed struct(u32) { reserved: bool = false, uint31: u31 = 0 }`.
/// Zig packed structs are LSB-first, so bit 0 = `reserved`, bits 1..=31 = `uint31`.
#[repr(transparent)]
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub struct UInt31WithReserved(u32);

impl UInt31WithReserved {
    #[inline]
    pub const fn reserved(self) -> bool {
        (self.0 & 0x1) != 0
    }

    #[inline]
    pub const fn uint31(self) -> u32 {
        // 31-bit value (Rust has no u31)
        self.0 >> 1
    }

    #[inline]
    pub const fn from(value: u32) -> UInt31WithReserved {
        Self::init(
            (value & 0x7fff_ffff) as u32, // @truncate
            value & 0x8000_0000 != 0,
        )
    }

    #[inline]
    pub const fn init(value: u32, reserved: bool) -> UInt31WithReserved {
        // value must fit in 31 bits (Zig: u31)
        Self((value << 1) | (reserved as u32))
    }

    #[inline]
    pub const fn to_uint32(self) -> u32 {
        // @bitCast — returns the packed-struct backing integer.
        // PORT NOTE: this is NOT the inverse of `from()` (matches Zig behavior).
        self.0
    }

    #[inline]
    pub fn from_bytes(src: &[u8]) -> UInt31WithReserved {
        let value: u32 = u32_from_bytes(src);
        Self::init(
            (value & 0x7fff_ffff) as u32, // @truncate
            value & 0x8000_0000 != 0,
        )
    }
}

/// Zig: `packed struct(u40) { streamIdentifier: u32 = 0, weight: u8 = 0 }`.
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct StreamPriority {
    pub stream_identifier: u32,
    pub weight: u8,
}

impl Default for StreamPriority {
    fn default() -> Self {
        Self { stream_identifier: 0, weight: 0 }
    }
}

impl StreamPriority {
    pub const BYTE_SIZE: usize = 5;

    #[inline]
    pub fn from(dst: &mut StreamPriority, src: &[u8]) {
        // SAFETY: StreamPriority is #[repr(C, packed)] POD with size == BYTE_SIZE.
        let bytes = unsafe {
            core::slice::from_raw_parts_mut(dst as *mut Self as *mut u8, Self::BYTE_SIZE)
        };
        bytes.copy_from_slice(src);
        // std.mem.byteSwapAllFields(StreamPriority, dst)
        // SAFETY: packed field — use unaligned read/write.
        unsafe {
            let p = core::ptr::addr_of_mut!(dst.stream_identifier);
            p.write_unaligned(p.read_unaligned().swap_bytes());
        }
        // weight: u8 — byte swap is a no-op.
    }
}

/// Zig: `packed struct(u72) { length: u24, type: u8, flags: u8, streamIdentifier: u32 }`.
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct FrameHeader {
    // TODO(port): Zig u24. Stored as 3 raw bytes; use `length()` accessor.
    pub length: [u8; 3],
    pub r#type: u8,
    pub flags: u8,
    pub stream_identifier: u32,
}

impl Default for FrameHeader {
    fn default() -> Self {
        Self {
            length: [0; 3],
            r#type: FrameType::HTTP_FRAME_SETTINGS as u8,
            flags: 0,
            stream_identifier: 0,
        }
    }
}

impl FrameHeader {
    pub const BYTE_SIZE: usize = 9;

    /// Returns the 24-bit length as a native u32.
    #[inline]
    pub fn length(&self) -> u32 {
        // After byte_swap_all_fields, the 3 bytes are in native (LE) order.
        u32::from_le_bytes([self.length[0], self.length[1], self.length[2], 0])
    }

    #[inline]
    pub fn from<const END: bool>(dst: &mut FrameHeader, src: &[u8], offset: usize) {
        // SAFETY: FrameHeader is #[repr(C, packed)] POD with size == BYTE_SIZE.
        let bytes = unsafe {
            core::slice::from_raw_parts_mut(dst as *mut Self as *mut u8, Self::BYTE_SIZE)
        };
        bytes[offset..src.len() + offset].copy_from_slice(src);
        if END {
            // std.mem.byteSwapAllFields(FrameHeader, dst)
            dst.length.reverse(); // u24 byte swap
            // r#type, flags: u8 — no-op
            // SAFETY: packed field — use unaligned read/write.
            unsafe {
                let p = core::ptr::addr_of_mut!(dst.stream_identifier);
                p.write_unaligned(p.read_unaligned().swap_bytes());
            }
        }
    }
}

/// Zig: `packed struct(u48) { type: u16, value: u32 }`.
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct SettingsPayloadUnit {
    pub r#type: u16,
    pub value: u32,
}

impl SettingsPayloadUnit {
    pub const BYTE_SIZE: usize = 6;

    #[inline]
    pub fn from<const END: bool>(dst: &mut SettingsPayloadUnit, src: &[u8], offset: usize) {
        // SAFETY: SettingsPayloadUnit is #[repr(C, packed)] POD with size == BYTE_SIZE.
        let bytes = unsafe {
            core::slice::from_raw_parts_mut(dst as *mut Self as *mut u8, Self::BYTE_SIZE)
        };
        bytes[offset..src.len() + offset].copy_from_slice(src);
        if END {
            // std.mem.byteSwapAllFields(SettingsPayloadUnit, dst)
            // SAFETY: packed fields — use unaligned read/write.
            unsafe {
                let tp = core::ptr::addr_of_mut!(dst.r#type);
                tp.write_unaligned(tp.read_unaligned().swap_bytes());
                let vp = core::ptr::addr_of_mut!(dst.value);
                vp.write_unaligned(vp.read_unaligned().swap_bytes());
            }
        }
    }

    #[inline]
    pub fn encode(dst: &mut [u8; Self::BYTE_SIZE], setting: SettingsType, value: u32) {
        dst[0..2].copy_from_slice(&(setting as u16).to_be_bytes());
        dst[2..6].copy_from_slice(&value.to_be_bytes());
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/H2FrameParser.zig (154 lines)
//   confidence: medium
//   todos:      4
//   notes:      packed struct(uN) with non-byte widths (u24/u31/u40/u48/u72) mapped to #[repr(C,packed)]/#[repr(transparent)] + manual byteswap; non-exhaustive `_` enums need newtype audit in Phase B
// ──────────────────────────────────────────────────────────────────────────
