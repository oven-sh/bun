//! Index types.

macro_rules! id {
    ($(#[$meta:meta])* $name:ident, $prefix:literal) => {
        $(#[$meta])*
        #[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(pub u32);

        impl $name {
            pub const NONE: $name = $name(u32::MAX);
            #[inline]
            pub fn idx(self) -> usize {
                self.0 as usize
            }
            #[inline]
            pub fn is_none(self) -> bool {
                self == Self::NONE
            }
            #[inline]
            pub fn is_some(self) -> bool {
                self != Self::NONE
            }
            #[inline]
            pub fn new(index: usize) -> $name {
                $name(index as u32)
            }
        }

        impl core::fmt::Debug for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                if self.is_none() { write!(f, concat!($prefix, "-")) } else { write!(f, concat!($prefix, "{}"), self.0) }
            }
        }

        impl core::fmt::Display for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                core::fmt::Debug::fmt(self, f)
            }
        }
    };
}

id!(
    /// A function of the program.
    FuncId,
    "f"
);
id!(
    /// A basic block of one function.
    BlockId,
    "b"
);
id!(
    /// A value of one function: a block parameter or the result of an operation.
    V,
    "v"
);
id!(
    /// The shape of a kind of object: which fields it has.
    LayoutId,
    "L"
);
id!(
    /// A description of a declared type.
    TyId,
    "t"
);
id!(
    /// Interned bytes: a name or a string constant.
    StrId,
    "s"
);
id!(
    /// A module-level variable.
    GlobalId,
    "g"
);
id!(
    /// A file of the program.
    ModuleId,
    "m"
);
