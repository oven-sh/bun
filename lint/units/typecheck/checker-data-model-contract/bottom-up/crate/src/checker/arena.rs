// The lists and texts that one checker makes. Nothing moves and nothing is freed before the arena.
use crate::ast_diagnostic::Arg;
use crate::checker::flags_generated::VarianceFlags;
use crate::checker::types::TupleElementInfo;
use crate::tscore::golang::Text;
use crate::tscore::ids::{IndexInfoId, InferenceInfoId, NodeId, SignatureId, SymbolId, TypeId};
use crate::tscore::stable::Stable;
use std::cell::Cell;

// An element type of a `List` of the checker.
pub trait ListItem<'a>: Copy + Default + 'a {
    fn store(arena: &'a CheckerArena<'a>) -> &'a Stable<Box<[Self]>>;
}

// An element type of a `LiveList` of the checker.
pub trait LiveItem<'a>: Copy + Default + 'a {
    fn cells(arena: &'a CheckerArena<'a>) -> &'a Stable<Box<[Cell<Self>]>>;
}

macro_rules! define_checker_arena {
    (lists { $($field:ident: $item:ty),* $(,)? } live { $($live:ident: $live_item:ty),* $(,)? }) => {
        #[derive(Default)]
        pub struct CheckerArena<'a> {
            $($field: Stable<Box<[$item]>>,)*
            $($live: Stable<Box<[Cell<$live_item>]>>,)*
            bytes: Stable<Box<[u8]>>,
            allocated: Cell<usize>,
        }
        $(impl<'a> ListItem<'a> for $item {
            fn store(arena: &'a CheckerArena<'a>) -> &'a Stable<Box<[Self]>> {
                &arena.$field
            }
        })*
        $(impl<'a> LiveItem<'a> for $live_item {
            fn cells(arena: &'a CheckerArena<'a>) -> &'a Stable<Box<[Cell<Self>]>> {
                &arena.$live
            }
        })*
    };
}

define_checker_arena!(
    lists {
        type_ids: TypeId,
        symbol_ids: SymbolId,
        node_ids: NodeId,
        signature_ids: SignatureId,
        index_info_ids: IndexInfoId,
        tuple_element_infos: TupleElementInfo,
        variance_flags: VarianceFlags,
        texts: Text<'a>,
        args: Arg<'a>,
    }
    live {
        live_type_ids: TypeId,
        live_inference_info_ids: InferenceInfoId,
    }
);

impl<'a> CheckerArena<'a> {
    pub fn new() -> Self {
        Self::default()
    }
    // One allocation per list. The empty slice when the store is full.
    pub fn alloc_slice_copy<T: ListItem<'a>>(&'a self, src: &[T]) -> &'a [T] {
        self.allocated
            .set(self.allocated.get() + std::mem::size_of_val(src));
        match T::store(self).push(src.into()) {
            Some(slice) => slice,
            None => &[],
        }
    }
    pub fn alloc_cells<T: LiveItem<'a>>(&'a self, src: &[T]) -> &'a [Cell<T>] {
        self.allocated
            .set(self.allocated.get() + std::mem::size_of_val(src));
        let cells: Box<[Cell<T>]> = src.iter().map(|value| Cell::new(*value)).collect();
        match T::cells(self).push(cells) {
            Some(slice) => slice,
            None => &[],
        }
    }
    pub fn alloc_bytes(&'a self, src: &[u8]) -> Text<'a> {
        self.allocated.set(self.allocated.get() + src.len());
        match self.bytes.push(src.into()) {
            Some(slice) => slice,
            None => &[],
        }
    }
    pub fn allocated_bytes(&self) -> usize {
        self.allocated.get()
    }
}
