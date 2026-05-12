// PORT NOTE: Zig source is `enum(u8) { ..., _ }` (non-exhaustive — any u8 is a
// valid bit pattern). A `#[repr(u8)] enum` in Rust would be UB for values >6
// arriving over FFI, so this is ported as a transparent newtype with associated
// consts. The `match` arms below mirror the Zig `switch` exactly, including the
// `else` fallthrough for unknown values.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct ZigStackFrameCode(pub u8);

impl ZigStackFrameCode {
    pub const NONE: Self = Self(0);
    /// 🏃
    pub const EVAL: Self = Self(1);
    /// 📦
    pub const MODULE: Self = Self(2);
    /// λ
    pub const FUNCTION: Self = Self(3);
    /// 🌎
    pub const GLOBAL: Self = Self(4);
    /// ⚙️
    pub const WASM: Self = Self(5);
    /// 👷
    pub const CONSTRUCTOR: Self = Self(6);

    // PORT NOTE: Zig returns `u21` (Unicode code point width). Rust has no u21;
    // u32 is the narrowest native type that fits.
    pub fn emoji(self) -> u32 {
        match self {
            Self::EVAL => 0x1F3C3,
            Self::MODULE => 0x1F4E6,
            Self::FUNCTION => 0x03BB,
            Self::GLOBAL => 0x1F30E,
            Self::WASM => 0xFE0F,
            Self::CONSTRUCTOR => 0xF1477,
            _ => b' ' as u32,
        }
    }

    pub fn ansi_color(self) -> &'static [u8] {
        use bun_core::output::ansi_b;
        match self {
            Self::EVAL => ansi_b::RED,
            Self::MODULE => ansi_b::CYAN,
            Self::FUNCTION => ansi_b::GREEN,
            Self::GLOBAL => ansi_b::MAGENTA,
            Self::WASM => ansi_b::WHITE,
            Self::CONSTRUCTOR => ansi_b::YELLOW,
            _ => b"",
        }
    }
}

// ported from: src/jsc/ZigStackFrameCode.zig
