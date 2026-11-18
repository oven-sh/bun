use core::cell::Cell;

use crate::heap::Survivors;
use crate::{Attributes, ElementKind, FastHashMap, Gc, Shape, ShapeId};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum TransitionKind {
    None,
    AddProperty,
    RemoveProperty,
    ChangeAttributes,
    ChangePrototype,
    AllocateUndecided,
    AllocateInt32,
    AllocateDouble,
    AllocateContiguous,
    AllocateSparse,
    SwitchToSlowPut,
    AddIndexedAccessors,
    PreventExtensions,
    Seal,
    Freeze,
    MakeLengthReadOnly,
    BecomePrototype,
    /// The object no longer defines properties when they are asked for.
    EndLaziness,
}

impl TransitionKind {
    pub fn allocate(kind: ElementKind) -> TransitionKind {
        match kind {
            ElementKind::None => unreachable!(),
            ElementKind::Undecided => TransitionKind::AllocateUndecided,
            ElementKind::Int32 => TransitionKind::AllocateInt32,
            ElementKind::Double => TransitionKind::AllocateDouble,
            ElementKind::Contiguous => TransitionKind::AllocateContiguous,
            ElementKind::Sparse => TransitionKind::AllocateSparse,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct TransitionKey(u64);

impl TransitionKey {
    /// `address` is that of the name or the prototype, which the target keeps alive.
    #[inline(always)]
    pub(super) fn new(address: usize, attributes: Attributes, kind: TransitionKind) -> Self {
        let attributes = u64::from(attributes.for_shape().bits());
        TransitionKey(address as u64 | attributes << 48 | (kind as u64) << 56)
    }
}

type Map = FastHashMap<TransitionKey, ShapeId>;

/// Does not keep its targets alive. Zero, the address of the only target, or that of a map with the low bit set.
#[derive(Default)]
pub(super) struct TransitionTable(Cell<usize>);

impl TransitionTable {
    const IS_MAP: usize = 1;

    pub(super) fn is_empty(&self) -> bool {
        self.0.get() == 0
    }

    #[inline(always)]
    fn map(&self) -> Option<*mut Map> {
        let word = self.0.get();
        (word & Self::IS_MAP != 0)
            .then(|| core::ptr::with_exposed_provenance_mut(word & !Self::IS_MAP))
    }

    #[inline(always)]
    pub(super) fn single(&self) -> Option<Gc<Shape>> {
        let word = self.0.get();
        // SAFETY: cleared by `reconcile` before the target is freed.
        (word != 0 && word & Self::IS_MAP == 0).then(|| unsafe { Gc::from_address(word) })
    }

    #[inline]
    pub(super) fn get(&self, key: TransitionKey) -> Option<Gc<Shape>> {
        let target = match self.map() {
            // SAFETY: owned by `self`, and as in `single`.
            Some(map) => unsafe { (*map).get(&key)?.decode() },
            None => self.single()?,
        };
        // A target that has changed in place no longer has the key.
        (target.transition_key() == key).then_some(target)
    }

    pub(super) fn add(&self, target: &Shape) {
        if self.is_empty() {
            return self.0.set(target.address());
        }
        if let Some(single) = self.single() {
            let mut map = Box::<Map>::default();
            map.insert(single.transition_key(), single.id());
            self.0
                .set(Box::into_raw(map).expose_provenance() | Self::IS_MAP);
        }
        if let Some(map) = self.map() {
            // SAFETY: owned by `self`, and not borrowed.
            unsafe { (*map).insert(target.transition_key(), target.id()) };
        }
    }

    pub(super) fn reconcile(&self, survivors: &Survivors) {
        if let Some(map) = self.map() {
            // SAFETY: as above.
            let map = unsafe { &mut *map };
            map.retain(|_, &mut id| survivors.contains_shape(id));
            if map.len() * 8 < map.capacity() {
                map.shrink_to_fit();
            }
        } else if self.single().is_some_and(|it| !survivors.contains(it)) {
            self.0.set(0);
        }
    }
}

impl Drop for TransitionTable {
    fn drop(&mut self) {
        if let Some(map) = self.map() {
            // SAFETY: from `Box::into_raw` in `add`.
            drop(unsafe { Box::from_raw(map) });
        }
    }
}
