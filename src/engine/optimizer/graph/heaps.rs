//! The parts of memory that instructions are told apart by.

use bun_engine_codegen::ir::{Entity, Function, Heap, HeapRange};

macro_rules! heaps {
    ($($(#[$meta:meta])* $name:ident,)*) => {
        #[allow(non_camel_case_types)]
        enum Position {
            $($name,)*
            END,
        }

        $($(#[$meta])* pub(crate) const $name: Heap = Heap::at(FIRST_LEAF + Position::$name as u32);)*
    };
}

/// All that a script can change.
pub(crate) const WORLD: Heap = Heap::at(2);
/// The shape, the indexing mode, the storage and all that is in it.
pub(crate) const OBJECTS: Heap = Heap::at(3);
pub(crate) const NAMED: Heap = Heap::at(4);
pub(crate) const SCOPE_SLOTS: Heap = Heap::at(5);
pub(crate) const GLOBAL_BINDINGS: Heap = Heap::at(6);
/// What changes when an object gets more slots.
pub(crate) const LAYOUT: Heap = Heap::at(7);
/// The fields that point at memory which lives only as long as the cell that has the field, and such memory.
pub(crate) const BACKING: Heap = Heap::at(8);
/// `ELEMENTS` and `BACKING`.
pub(crate) const VECTORS: Heap = Heap::at(9);
/// Where the elements are and how many fit, which no script can tell.
pub(crate) const ROOM: Heap = Heap::at(10);
/// What changes when an element is stored for which the object has to get another shape.
pub(crate) const ELEMENTS_AND_SHAPES: Heap = Heap::at(11);
/// The public length and what is below it.
pub(crate) const ELEMENTS: Heap = Heap::at(12);
pub(crate) const COLLECTIONS_AND_VECTORS: Heap = Heap::at(13);
/// What a search for a pattern changes, but for `LAST_INDEX`.
pub(crate) const SEARCH: Heap = Heap::at(14);
pub(crate) const BACKING_AND_LAST_INDEX: Heap = Heap::at(15);
const FIRST_LEAF: u32 = 16;

/// A bit for each heap that includes others.
pub(crate) const GROUPS: u64 = (1 << FIRST_LEAF) - 1;

pub(crate) fn is_group(heap: Heap) -> bool {
    heap.index() < FIRST_LEAF as usize
}

heaps! {
    /// The header and arguments of the frame.
    FRAME,
    /// What `CopyToMemory` has put there.
    COPIED_VALUES,
    /// Counters and the like, which no script sees.
    SIDE_STATE,
    /// What a coroutine keeps for its code, which alone changes it.
    SAVED_REGISTERS,
    /// From here on it is `WORLD`.
    INTERNAL_FIELDS,
    FUNCTION_TARGET,
    ARGUMENT_SLOTS,
    RANDOM_STATE,
    /// Their time values, and the time zone.
    DATES,
    WATCHPOINT_STATES,
    OTHER_FIELDS,
    /// The tables of maps and sets, and which they have.
    COLLECTIONS,
    /// The length, offset and mode of a view on a buffer.
    VIEW_LENGTH,
    /// From here on it is `OBJECTS`. This and the next two are `ELEMENTS`.
    PUBLIC_LENGTH,
    VALUE_ELEMENTS,
    DOUBLE_ELEMENTS,
    /// This and the next are `ROOM`. From here up to the shape it is `BACKING`.
    VECTOR_LENGTH,
    /// From here up to and including the shape it is `LAYOUT`.
    STORAGE,
    STRING_FIBER,
    /// Of a realm, and whether an iterator over matches is done.
    LAST_MATCH,
    VIEW_VECTOR,
    TYPED_ELEMENTS,
    WEAK_TABLES,
    /// What dates keep of their time values. Whatever looks at a date may fill it in.
    DATE_FIELDS,
    SHAPE,
    INDEXING_MODE,
}

/// The member of `NAMED` with the number 0.
pub(crate) const LAST_INDEX: Heap = Heap::at(FIRST_LEAF + Position::END as u32);

const MEMBERS: u32 = 1 << 24;
const NAMED_START: u32 = MEMBERS;
const SCOPE_SLOTS_START: u32 = 2 * MEMBERS;
const GLOBAL_BINDINGS_START: u32 = 3 * MEMBERS;

fn range(start: u32, end: u32) -> HeapRange {
    HeapRange { start, end }
}

/// Nothing in there tells how to find anything else.
pub(crate) fn has_only_values(heap: Heap) -> bool {
    heap.index() >= (FIRST_LEAF + Position::END as u32) as usize
        || [VALUE_ELEMENTS, DOUBLE_ELEMENTS, TYPED_ELEMENTS].contains(&heap)
}

/// Whether writing there again could be noticed.
pub(crate) fn is_observable(function: &Function, written: Heap) -> bool {
    function.may_alias(written, WORLD)
        && ![STRING_FIBER, ROOM, VIEW_LENGTH, VIEW_VECTOR].contains(&written)
}

/// Of the language, with their tags.
pub(crate) fn holds_values(function: &Function, heap: Heap) -> bool {
    let all = [
        NAMED,
        SCOPE_SLOTS,
        GLOBAL_BINDINGS,
        VALUE_ELEMENTS,
        INTERNAL_FIELDS,
    ];
    all.iter().any(|&it| function.may_alias(it, heap))
}

pub(crate) fn add_fixed(function: &mut Function) {
    let groups = [
        range(Position::INTERNAL_FIELDS as u32, u32::MAX),
        range(Position::PUBLIC_LENGTH as u32, SCOPE_SLOTS_START),
        range(NAMED_START, SCOPE_SLOTS_START),
        range(SCOPE_SLOTS_START, GLOBAL_BINDINGS_START),
        range(GLOBAL_BINDINGS_START, GLOBAL_BINDINGS_START + MEMBERS),
        range(Position::STORAGE as u32, Position::INDEXING_MODE as u32),
        range(Position::VECTOR_LENGTH as u32, Position::SHAPE as u32),
        range(Position::PUBLIC_LENGTH as u32, Position::SHAPE as u32),
        range(
            Position::VECTOR_LENGTH as u32,
            Position::STRING_FIBER as u32,
        ),
        range(Position::WATCHPOINT_STATES as u32, Position::END as u32),
        range(
            Position::PUBLIC_LENGTH as u32,
            Position::VECTOR_LENGTH as u32,
        ),
        range(Position::COLLECTIONS as u32, Position::SHAPE as u32),
        range(
            Position::STRING_FIBER as u32,
            Position::LAST_MATCH as u32 + 1,
        ),
        range(Position::VECTOR_LENGTH as u32, NAMED_START + 1),
    ];
    let leaves = (0..Position::END as u32).chain([NAMED_START]);
    let leaves = leaves.map(|position| range(position, position + 1));
    for range in groups.into_iter().chain(leaves) {
        function.add_heap(range);
    }
    debug_assert!(function.heap_count() == LAST_INDEX.index() + 1);
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Family {
    /// By the number of the name.
    Named,
    /// By the index of the slot.
    ScopeSlot,
    /// By the number of the binding.
    GlobalBinding,
}

pub(crate) fn add_member(function: &mut Function, family: Family, number: u32) -> Heap {
    let (start, whole) = match family {
        Family::Named => (NAMED_START, NAMED),
        Family::ScopeSlot => (SCOPE_SLOTS_START, SCOPE_SLOTS),
        Family::GlobalBinding => (GLOBAL_BINDINGS_START, GLOBAL_BINDINGS),
    };
    if number < MEMBERS {
        function.add_heap(range(start + number, start + number + 1))
    } else {
        whole
    }
}
