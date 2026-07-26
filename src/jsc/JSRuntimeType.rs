/// Represents JavaScript runtime value types
// Any u16 bit-pattern is a valid value (the discriminants are bitflags). A
// `#[repr(u16)] enum` would be UB for unlisted values, so this is a transparent
// newtype with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct JSRuntimeType(pub u16);

impl JSRuntimeType {
    pub const NOTHING: Self = Self(0x0);
    pub const UNDEFINED: Self = Self(0x2);
    pub const NULL: Self = Self(0x4);
}
