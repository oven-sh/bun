// The ids of the node table. An id takes the place of a pointer of upstream: 0 is nil in every id space.

// Bit 31 marks an object of an open store: what a binder, a program or a checker made.
pub const OPEN_BIT: u32 = 1 << 31;

// A frozen file owns whole pages of the id space, the same pages in every id space.
pub const PAGE_BITS: u32 = 10;
pub const PAGE_SIZE: u32 = 1 << PAGE_BITS;

pub trait Id: Copy + Eq {
    fn from_u32(v: u32) -> Self;
    fn to_u32(self) -> u32;
}

macro_rules! define_id {
    ($($name:ident),* $(,)?) => {$(
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
        pub struct $name(pub u32);

        impl $name {
            pub const NIL: Self = Self(0);

            #[inline]
            pub const fn is_nil(self) -> bool {
                self.0 == 0
            }
            // True for an object of an open store.
            #[inline]
            pub const fn is_open(self) -> bool {
                self.0 & $crate::ast::ids::OPEN_BIT != 0
            }
            #[inline]
            pub const fn open_index(self) -> usize {
                (self.0 & !$crate::ast::ids::OPEN_BIT) as usize
            }
            // The id of the object at `index` of an open store: nil for index 0, which no object has.
            #[inline]
            pub const fn from_open_index(index: u32) -> Self {
                if index == 0 {
                    return Self::NIL;
                }
                Self(index | $crate::ast::ids::OPEN_BIT)
            }
        }

        impl $crate::ast::ids::Id for $name {
            #[inline]
            fn from_u32(v: u32) -> Self {
                Self(v)
            }
            #[inline]
            fn to_u32(self) -> u32 {
                self.0
            }
        }
    )*};
}

define_id!(
    NodeId,
    NodeListId,
    ModifierListId,
    SymbolId,
    SymbolTableId,
    FlowNodeId,
    FlowListId,
);

// A diagnostic is named by its index in the store that made it: bit 31 is never set.
define_id!(DiagnosticId);

impl ModifierListId {
    // A ModifierList embeds a NodeList upstream.
    #[inline]
    pub const fn as_node_list(self) -> NodeListId {
        NodeListId(self.0)
    }
}
