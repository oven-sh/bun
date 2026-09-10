//! HTTP/2 wire-format types (RFC 7540 / 9113). Pure-data tier-1 module —
//! zero JSC, socket, or io dependencies. Shared by:
//!   • `bun_http`    (fetch() HTTP/2 client) — re-exported as `h2_frame_parser`
//!   • `bun_runtime` (node:http2 bindings)   — `pub use`d into its
//!     `h2_frame_parser` module, which layers `WireWriter`-based `write()`
//!     and `to_js()` on top as local extension traits.
#![allow(non_camel_case_types, non_upper_case_globals)]

// ─── connection / sizing constants ──────────────

pub const CLIENT_PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

pub const MAX_WINDOW_SIZE: u32 = i32::MAX as u32;
pub const MAX_STREAM_ID: u32 = i32::MAX as u32;
/// Maximum 24-bit value.
pub const MAX_FRAME_SIZE: u32 = 0x00FF_FFFF;
pub const DEFAULT_WINDOW_SIZE: u32 = u16::MAX as u32;
pub const DEFAULT_MAX_FRAME_SIZE: u32 = 16384;

// ─── frame type / flags ─────────────────────────
//
// Frame types are non-exhaustive on the wire (any u8 is a valid value). A
// `#[repr(u8)]` Rust enum is UB for unknown discriminants received off the
// wire, so callers dispatch on the raw `u8` (`FrameHeader.type_`) and only
// ever use this enum for *outbound* frame construction (`X as u8`).

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
// Newtype-over-int instead of
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
    pub const FRAME_SIZE_ERROR: Self = Self(0x6);
    pub const REFUSED_STREAM: Self = Self(0x7);
    pub const CANCEL: Self = Self(0x8);
    pub const COMPRESSION_ERROR: Self = Self(0x9);
    pub const ENHANCE_YOUR_CALM: Self = Self(0xb);
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
}

// ─── wire helpers ───────────────────────────────

#[inline]
pub fn u32_from_bytes(src: &[u8]) -> u32 {
    debug_assert!(src.len() == 4);
    u32::from_be_bytes([src[0], src[1], src[2], src[3]])
}

/// A 31-bit value with a reserved high bit. The RFC 7540 §6.3 wire format
/// wants the reserved/E bit at bit 31, so the layout is the RFC-compliant
/// `(reserved << 31) | uint31`, which matches
/// `from_bytes`/`encode_into` and the on-wire `StreamPriority.stream_identifier`.
#[repr(transparent)]
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub struct UInt31WithReserved(u32);

impl UInt31WithReserved {
    #[inline]
    pub const fn uint31(self) -> u32 {
        self.0 & 0x7fff_ffff
    }
    #[inline]
    pub const fn from(value: u32) -> Self {
        Self(value)
    }
    #[inline]
    pub fn from_bytes(src: &[u8]) -> Self {
        Self(u32_from_bytes(src))
    }
}

// ─── packed wire structs ────────────────────────

/// 5-byte PRIORITY payload: BE stream identifier + weight.
#[repr(C, packed)]
#[derive(Copy, Clone, Default)]
pub struct StreamPriority {
    pub(crate) stream_identifier: u32,
    pub(crate) weight: u8,
}
const _: () = assert!(core::mem::size_of::<StreamPriority>() == StreamPriority::BYTE_SIZE);

impl StreamPriority {
    pub const BYTE_SIZE: usize = 5;
}

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
}

/// 6-byte SETTINGS entry: BE u16 type + BE u32 value.
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
const _: () =
    assert!(core::mem::size_of::<SettingsPayloadUnit>() == SettingsPayloadUnit::BYTE_SIZE);

impl SettingsPayloadUnit {
    pub const BYTE_SIZE: usize = 6;

    #[inline]
    pub fn from<const END: bool>(dst: &mut SettingsPayloadUnit, src: &[u8], offset: usize) {
        let bytes = bytemuck::bytes_of_mut(dst);
        bytes[offset..src.len() + offset].copy_from_slice(src);
        if END {
            // Byte-swap each field.
            dst.type_ = u16::swap_bytes(dst.type_);
            dst.value = u32::swap_bytes(dst.value);
        }
    }
}

// ─── field validation (RFC 9113 §8.2.1) ─────────

/// RFC 9110 §5.6.2 `tchar`, restricted to lowercase: RFC 9113 §8.2.1 requires
/// HTTP/2 field names to be lowercase, so uppercase tchars are rejected (or
/// normalized) by callers rather than accepted here.
#[inline]
pub const fn is_lower_tchar(c: u8) -> bool {
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
}

/// RFC 9113 §8.2.1: a field value MUST NOT contain NUL (0x00), LF (0x0a), or
/// CR (0x0d). HPACK is length-prefixed so these would otherwise pass through
/// verbatim, breaking the no-CR/LF invariant the HTTP/1.1 parser provides and
/// enabling header injection when values are forwarded downstream.
#[inline]
pub fn is_malformed_field_value(value: &[u8]) -> bool {
    bun_core::strings::contains_any(value, b"\0\r\n")
}

#[cfg(test)]
mod tests {
    use super::is_lower_tchar;

    /// Exhaustive parity check against the RFC 9110 §5.6.2 `tchar` grammar
    /// with the uppercase range removed.
    #[test]
    fn lower_tchar_matches_grammar() {
        // RFC 9110 defines tchar as any VCHAR except the delimiters below;
        // deriving the oracle that way keeps it independent of the literal
        // table in `is_lower_tchar`.
        for c in 0..=u8::MAX {
            let is_delimiter = matches!(
                c,
                b'"' | b'('
                    | b')'
                    | b','
                    | b'/'
                    | b':'
                    | b';'
                    | b'<'
                    | b'='
                    | b'>'
                    | b'?'
                    | b'@'
                    | b'['
                    | b'\\'
                    | b']'
                    | b'{'
                    | b'}'
            );
            let expected = c.is_ascii_graphic() && !is_delimiter && !c.is_ascii_uppercase();
            assert_eq!(is_lower_tchar(c), expected, "byte {c:#04x}");
        }
    }

    /// `contains_any` is backed by the highway objects, which a native
    /// `cargo test` of this leaf crate does not link; this crate's unit tests
    /// run in CI under Miri, where highway takes its scalar paths.
    #[cfg(miri)]
    #[test]
    fn field_value_rejects_exactly_nul_cr_lf() {
        use super::is_malformed_field_value;

        assert!(!is_malformed_field_value(b""));
        assert!(!is_malformed_field_value(b"text/plain; charset=utf-8"));
        // Tabs, spaces, and obs-text are legal in values.
        assert!(!is_malformed_field_value(b"\ta b\xff"));
        for bad in [b'\0', b'\r', b'\n'] {
            assert!(is_malformed_field_value(&[bad]), "lone {bad:#04x}");
            assert!(is_malformed_field_value(&[bad, b'x']), "leading {bad:#04x}");
            assert!(
                is_malformed_field_value(&[b'x', bad]),
                "trailing {bad:#04x}"
            );
        }
        let mut long = vec![b'a'; 100];
        assert!(!is_malformed_field_value(&long));
        long[99] = b'\n';
        assert!(is_malformed_field_value(&long));
    }
}
