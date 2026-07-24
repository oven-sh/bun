// This is logically a non-exhaustive enum(u8): any u8 is a valid bit pattern
// over FFI. A `#[repr(u8)] enum` in Rust would be UB for values >6 arriving
// from C++, so this is a transparent newtype with associated consts; the
// `match` arms below must keep a fallthrough for unknown values.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct ZigStackFrameCode(pub u8);

impl ZigStackFrameCode {
    pub const NONE: Self = Self(0);
    /// 🏃
    pub const EVAL: Self = Self(1);
    /// λ
    pub const FUNCTION: Self = Self(3);
    /// 🌎
    pub const GLOBAL: Self = Self(4);
    /// ⚙️
    pub const WASM: Self = Self(5);
    /// 👷
    pub const CONSTRUCTOR: Self = Self(6);
}
