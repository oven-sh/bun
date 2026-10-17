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
    FuncId,
    "f"
);
id!(
    BlockId,
    "b"
);
id!(
    V,
    "v"
);
id!(
    LayoutId,
    "L"
);
id!(
    TyId,
    "t"
);
id!(
    StrId,
    "s"
);
id!(
    GlobalId,
    "g"
);
id!(
    ModuleId,
    "m"
);
