/// Represents JavaScript runtime value types
// Any u16 bit-pattern is a valid value (the discriminants are bitflags). A
// `#[repr(u16)] enum` would be UB for unlisted values, so this is a transparent
// newtype with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct JSRuntimeType(pub u16);

impl JSRuntimeType {
    pub const NOTHING: Self = Self(0x0);
    pub const FUNCTION: Self = Self(0x1);
    pub const UNDEFINED: Self = Self(0x2);
    pub const NULL: Self = Self(0x4);
    pub const BOOLEAN: Self = Self(0x8);
    pub const ANY_INT: Self = Self(0x10);
    pub const NUMBER: Self = Self(0x20);
    pub const STRING: Self = Self(0x40);
    pub const OBJECT: Self = Self(0x80);
    pub const SYMBOL: Self = Self(0x100);
    pub const BIG_INT: Self = Self(0x200);
}
