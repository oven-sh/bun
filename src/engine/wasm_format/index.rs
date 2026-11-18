//! Indices into the index spaces of a module. Imports come first in each.

macro_rules! indices {
    ($($(#[$meta:meta])* $name:ident,)*) => {
        $($(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
        #[repr(transparent)]
        pub struct $name(pub u32);

        impl $name {
            #[inline]
            pub const fn usize(self) -> usize {
                self.0 as usize
            }
        }

        impl core::fmt::Display for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                self.0.fmt(f)
            }
        })*
    };
}

indices! {
    TypeIndex,
    FuncIndex,
    /// The position of a function in the code section, which has no imports.
    CodeIndex,
    TableIndex,
    MemoryIndex,
    GlobalIndex,
    TagIndex,
    ElemIndex,
    DataIndex,
}
