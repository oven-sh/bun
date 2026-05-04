// PORT NOTE: Zig source is a non-exhaustive `enum(u8)` (trailing `_`), meaning
// any u8 value is a valid PacketType. A Rust `#[repr(u8)] enum` would make
// unlisted values UB on transmute, so this is ported as a transparent u8
// newtype with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct PacketType(pub u8);

impl PacketType {
    // Server packets
    pub const OK: Self = Self(0x00);
    pub const EOF: Self = Self(0xfe);
    pub const ERROR: Self = Self(0xff);
    pub const LOCAL_INFILE: Self = Self(0xfb);

    // Client/server packets
    pub const HANDSHAKE: Self = Self(0x0a);
    pub const MORE_DATA: Self = Self(0x01);

    pub const AUTH_SWITCH: u8 = 0xfe;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/PacketType.zig (14 lines)
//   confidence: high
//   todos:      0
//   notes:      non-exhaustive enum(u8) ported as #[repr(transparent)] struct + consts; AUTH_SWITCH kept as raw u8 const (aliases EOF=0xfe)
// ──────────────────────────────────────────────────────────────────────────
