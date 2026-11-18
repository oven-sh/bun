use core::cell::{Cell, OnceCell};

use crate::{Gc, PropertyOffset, Shape, ShapeId, Vm};

/// A slot of the source, and the slot of the target that its value goes to.
#[derive(Clone, Copy, Default)]
pub(crate) struct Move {
    from: u8,
    to: u8,
}

impl Move {
    /// `None` if either is too far out.
    pub(crate) fn new(from: PropertyOffset, to: PropertyOffset) -> Option<Move> {
        Some(Move {
            from: from.get().try_into().ok()?,
            to: to.get().try_into().ok()?,
        })
    }

    #[inline(always)]
    pub(crate) fn from(self) -> PropertyOffset {
        PropertyOffset::new(self.from.into())
    }

    #[inline(always)]
    pub(crate) fn to(self) -> PropertyOffset {
        PropertyOffset::new(self.to.into())
    }
}

const ENTRY_COUNT: usize = 64;
const MAX_MOVES: usize = 52;

#[repr(align(64))]
struct Entry {
    context: Cell<usize>,
    source: Cell<ShapeId>,
    epoch: Cell<u32>,
    result: Cell<ShapeId>,
    count: Cell<u32>,
    moves: [Cell<Move>; MAX_MOVES],
}

const _: () = assert!(size_of::<Entry>() == 128);

/// What copying the properties of an object comes to, by the shape of the object and a word for whatever else it
/// depends on. What the word is the address of does not go away before the next collection.
#[derive(Default)]
pub(crate) struct CopyPlans(OnceCell<Box<[Entry; ENTRY_COUNT]>>);

#[inline(always)]
fn index(context: usize, source: ShapeId) -> usize {
    let key = (context >> 3) as u32 ^ source.bits();
    (key.wrapping_mul(0x9e37_79b1) >> (u32::BITS - ENTRY_COUNT.ilog2())) as usize
}

impl CopyPlans {
    /// The shape that the target ends up with, and the way there.
    #[inline(always)]
    pub(crate) fn find(
        &self,
        vm: &Vm,
        context: usize,
        source: ShapeId,
    ) -> Option<(Gc<Shape>, &[Cell<Move>])> {
        let entry = &self.0.get()?[index(context, source)];
        if entry.context.get() != context
            || entry.source.get() != source
            || entry.epoch.get() != vm.prototype_chain_epoch()
        {
            return None;
        }
        // SAFETY: there has been no collection since.
        let result = unsafe { entry.result.get().decode() };
        Some((result, &entry.moves[..entry.count.get() as usize]))
    }

    pub(crate) fn insert(
        &self,
        vm: &Vm,
        context: usize,
        source: &Shape,
        result: &Shape,
        moves: &[Cell<Move>],
    ) {
        if moves.len() > MAX_MOVES {
            return;
        }
        let entries = self.0.get_or_init(|| {
            Box::new(core::array::from_fn(|_| Entry {
                context: Cell::new(0),
                source: Cell::new(ShapeId::NONE),
                epoch: Cell::new(0),
                result: Cell::new(ShapeId::NONE),
                count: Cell::new(0),
                moves: core::array::from_fn(|_| Cell::default()),
            }))
        });
        let entry = &entries[index(context, source.id())];
        entry.context.set(context);
        entry.source.set(source.id());
        entry.epoch.set(vm.prototype_chain_epoch());
        entry.result.set(result.id());
        entry.count.set(moves.len() as u32);
        for (slot, step) in entry.moves.iter().zip(moves) {
            slot.set(step.get());
        }
    }

    pub(super) fn clear(&self) {
        for entry in self.0.get().into_iter().flat_map(|it| &**it) {
            entry.epoch.set(0);
        }
    }
}
