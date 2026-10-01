// Id newtypes. 0 is nil for every id space.
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
            // True for an object that a builder or a checker made, false for an object of a frozen file.
            #[inline]
            pub const fn is_synthetic(self) -> bool {
                self.0 & crate::ids::SYNTH != 0
            }
        }
        impl crate::ids::Id for $name {
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

// Bit 31 marks an id of the arena of one context (a file under construction, or the nodes a checker makes).
pub const SYNTH: u32 = 1 << 31;
// A frozen file owns whole pages of the id space, the same pages in every id space.
pub const PAGE_SHIFT: u32 = 12;
pub const PAGE_SIZE: u32 = 1 << PAGE_SHIFT;

define_id!(
    NodeId,
    NodeListId,
    ModifierListId,
    SymbolId,
    SymbolTableId,
    FlowNodeId,
    FlowListId,
);

impl ModifierListId {
    #[inline]
    pub const fn as_node_list(self) -> NodeListId {
        NodeListId(self.0)
    }
}
