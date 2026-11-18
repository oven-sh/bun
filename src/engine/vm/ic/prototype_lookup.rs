use core::cell::{Cell, RefCell};
use core::mem::offset_of;
use core::num::NonZeroI32;

use bun_engine_macros::cell;
use bun_engine_text::{Identifier, PropertyName};
use smallvec::SmallVec;

use super::{InlineKey, InlineKind};
use crate::heap::{PlainKey, Survivors, WeakValueMap};
use crate::{
    ConditionSet, Gc, GlobalObject, InlineWatchpointSet, JsCell, JsObject, PropertyCondition,
    PropertyOffset, TypeFlags, Value, Visitor, Vm, Watchpoint, WatchpointState, vm::Root,
};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Query {
    Get,
    /// That nothing on the chain has a say in a store.
    SetMiss,
    /// The name is not used.
    Instanceof {
        prototype: usize,
    },
    GlobalLoad,
    GlobalStore,
}

/// Changes when a lookup is broken, so what has been copied from one holds while it is the same. What a lookup names
/// does not die before the shapes of the receivers that it is used for.
#[repr(C)]
pub struct LookupEpoch {
    /// The epoch in the upper half, and the tag of a kind that is checked in the lower.
    keys: [Cell<u64>; Self::index(InlineKey::LAST_TAG) + 1],
    /// The same number until there are no more, and then, until it starts over, one that never matches.
    to_record: Cell<u32>,
}

impl LookupEpoch {
    pub const OFFSET_OF_CURRENT: usize = offset_of!(LookupEpoch, keys) + size_of::<u32>();
    pub const OFFSET_OF_TO_RECORD: usize = offset_of!(LookupEpoch, to_record);

    /// What makes the key of an inline case of the id of a shape.
    pub fn offset_of_key(kind: impl InlineKind) -> usize {
        offset_of!(LookupEpoch, keys) + Self::index(kind.tag()) * size_of::<u64>()
    }

    const fn index(tag: u32) -> usize {
        (tag - InlineKey::FIRST_CHECKED_TAG) as usize
    }

    pub(crate) fn new() -> LookupEpoch {
        let epoch = LookupEpoch {
            keys: Default::default(),
            to_record: Cell::new(0),
        };
        epoch.start_over();
        epoch
    }

    /// All that has recorded one is about to do so again.
    pub(crate) fn start_over(&self) {
        self.set(1);
    }

    fn set(&self, epoch: u32) {
        for (key, tag) in self.keys.iter().zip(InlineKey::FIRST_CHECKED_TAG..) {
            key.set(u64::from(epoch) << 32 | u64::from(tag));
        }
        (self.to_record).set(if epoch == u32::MAX { 0 } else { epoch });
    }

    #[inline(always)]
    pub(crate) fn current(&self) -> u32 {
        (self.keys[0].get() >> 32) as u32
    }

    #[inline(always)]
    pub(crate) fn to_record(&self) -> u32 {
        self.to_record.get()
    }

    #[inline(always)]
    pub(crate) fn key(&self, kind: impl InlineKind) -> u64 {
        self.keys[Self::index(kind.tag())].get()
    }

    fn advance(&self) {
        self.set(self.current().saturating_add(2));
    }
}

/// What a prototype chain says about a name, for as long as that stays true. All caches that ask the same share it.
#[cell(flags = TypeFlags::SHAPE_IS_IMMORTAL, visit_children, reconcile_weak_references)]
pub struct PrototypeLookup {
    base: JsCell,
    /// The bits of what the slot of the holder has if that is known to stay, of undefined if there is no holder, and
    /// of the answer for `instanceof`. Otherwise, and once it is invalid, zero.
    constant: Cell<u64>,
    /// Zero once it is invalid.
    holder: Cell<usize>,
    /// Of the slot of the holder. A property that is only in a static table has none.
    byte_offset: Option<NonZeroI32>,
    is_valid: Cell<bool>,
    dependents: InlineWatchpointSet,
    name: Identifier,
    guards: RefCell<(ConditionSet, SmallVec<[Watchpoint; 2]>)>,
    /// What else the answer depends on being alive.
    operand: usize,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct Key {
    first: usize,
    name: usize,
    query: Query,
}

impl Key {
    fn new(first: &JsObject, name: PropertyName<'_>, query: Query) -> Key {
        Key {
            first: first.address(),
            name: name.address(),
            query,
        }
    }
}

// SAFETY: integers.
unsafe impl PlainKey for Key {}

pub(crate) struct PrototypeLookups {
    map: WeakValueMap<Key, PrototypeLookup>,
    of_empty_chain: Root<PrototypeLookup>,
}

impl Default for PrototypeLookups {
    fn default() -> PrototypeLookups {
        PrototypeLookups {
            map: WeakValueMap::default(),
            of_empty_chain: Root::new(),
        }
    }
}

impl crate::services::Service for PrototypeLookups {
    fn visit(&self, visitor: &mut Visitor) {
        self.of_empty_chain.visit(visitor);
    }

    fn reconcile_weak_references(&self, _: &Vm, survivors: &Survivors) {
        self.map.prune(survivors);
    }
}

impl PrototypeLookup {
    pub const OFFSET_OF_HOLDER: usize = offset_of!(PrototypeLookup, holder);
    pub const OFFSET_OF_BYTE_OFFSET: usize = offset_of!(PrototypeLookup, byte_offset);
    pub const OFFSET_OF_IS_VALID: usize = offset_of!(PrototypeLookup, is_valid);

    fn create(
        vm: &Vm,
        name: PropertyName<'_>,
        conditions: ConditionSet,
        constant: Option<Value>,
        holder: Option<(Gc<JsObject>, Option<PropertyOffset>)>,
        operand: usize,
    ) -> Option<Gc<PrototypeLookup>> {
        let lookup = vm.allocate::<PrototypeLookup>(PrototypeLookupInit {
            base: vm.shape_for::<PrototypeLookup>(),
            constant: Cell::new(Value::bits_of(constant)),
            holder: Cell::new(holder.map_or(0, |it| it.0.address())),
            byte_offset: (holder.and_then(|it| it.1))
                .and_then(|offset| NonZeroI32::new(offset.byte_offset() as i32)),
            is_valid: Cell::new(true),
            dependents: InlineWatchpointSet::new(WatchpointState::Watched),
            name: name.to_identifier(),
            guards: RefCell::default(),
            operand,
        });
        let invalidate = |vm: &Vm, owner: Gc<JsCell>| owner.cast::<Self>().did_break(vm);
        // SAFETY: owned by the lookup, which drops them in `reconcile_weak_references`.
        let watchpoints = unsafe { conditions.watch(&lookup, invalidate) }?;
        lookup.guards.replace((conditions, watchpoints));
        Some(lookup)
    }

    fn cached(
        vm: &Vm,
        first: Gc<JsObject>,
        name: PropertyName<'_>,
        query: Query,
        create: impl FnOnce() -> Option<Gc<PrototypeLookup>>,
    ) -> Option<Gc<PrototypeLookup>> {
        let (map, key) = (
            &vm.services.prototype_lookups.map,
            Key::new(&first, name, query),
        );
        if let Some(lookup) = map.get(vm, &key).filter(|it| it.is_valid()) {
            return Some(lookup);
        }
        let _defer = vm.heap.defer_collection();
        let lookup = create()?;
        map.insert(key, lookup);
        Some(lookup)
    }

    /// Always valid, and undefined.
    pub fn of_empty_chain(vm: &Vm) -> Gc<PrototypeLookup> {
        let root = &vm.services.prototype_lookups.of_empty_chain;
        root.get().unwrap_or_else(|| {
            let (name, conditions) = (PropertyName::EMPTY, ConditionSet::default());
            let lookup = Self::create(vm, name, conditions, Some(Value::UNDEFINED), None, 0);
            root.set(lookup);
            lookup.expect("nothing to watch")
        })
    }

    pub fn for_miss(
        vm: &Vm,
        first: Option<Gc<JsObject>>,
        name: PropertyName<'_>,
    ) -> Option<Gc<PrototypeLookup>> {
        let Some(first) = first else {
            return Some(Self::of_empty_chain(vm));
        };
        Self::cached(vm, first, name, Query::Get, || {
            let conditions = ConditionSet::for_miss(vm, Some(first), name)?;
            Self::create(vm, name, conditions, Some(Value::UNDEFINED), None, 0)
        })
        .filter(|lookup| lookup.holder().is_none())
    }

    pub fn for_hit(
        vm: &Vm,
        first: Gc<JsObject>,
        holder: Gc<JsObject>,
        name: PropertyName<'_>,
    ) -> Option<Gc<PrototypeLookup>> {
        Self::cached(vm, first, name, Query::Get, || {
            let presence = ConditionSet::for_hit(vm, Some(first), holder, name)?;
            let Some((offset, _)) = holder.shape().get(name) else {
                let place = Some((holder, None));
                return Self::create(vm, name, presence, None, place, 0);
            };
            let (place, value) = (Some((holder, Some(offset))), holder.get_direct_at(offset));
            ConditionSet::for_equivalent_hit(vm, Some(first), holder, name)
                .and_then(|it| Self::create(vm, name, it, Some(value), place, 0))
                .or_else(|| Self::create(vm, name, presence, None, place, 0))
        })
        .filter(|lookup| lookup.holder() == Some(holder))
    }

    pub fn for_setter_miss(
        vm: &Vm,
        first: Option<Gc<JsObject>>,
        name: PropertyName<'_>,
    ) -> Option<Gc<PrototypeLookup>> {
        let Some(first) = first else {
            return Some(Self::of_empty_chain(vm));
        };
        Self::cached(vm, first, name, Query::SetMiss, || {
            let conditions = ConditionSet::for_setter_miss(vm, Some(first), name)?;
            Self::create(vm, name, conditions, Some(Value::UNDEFINED), None, 0)
        })
    }

    pub fn for_instanceof(
        vm: &Vm,
        first: Gc<JsObject>,
        prototype: Gc<JsObject>,
        answer: bool,
    ) -> Option<Gc<PrototypeLookup>> {
        let (name, operand) = (PropertyName::EMPTY, prototype.address());
        let query = Query::Instanceof { prototype: operand };
        Self::cached(vm, first, name, query, || {
            let conditions = ConditionSet::for_instanceof(vm, first, prototype)?;
            Self::create(vm, name, conditions, Some(answer.into()), None, operand)
        })
    }

    /// Of a name whose place is `GlobalPlace::Property`, until a lexical binding hides it.
    pub fn for_global_load(
        vm: &Vm,
        global: Gc<GlobalObject>,
        name: PropertyName<'_>,
    ) -> Option<Gc<PrototypeLookup>> {
        let holder = global.upcast::<JsObject>();
        Self::cached(vm, holder, name, Query::GlobalLoad, || {
            let (offset, _) = holder.shape().get(name)?;
            let (place, value) = (Some((holder, Some(offset))), holder.get_direct_at(offset));
            PropertyCondition::equivalence(&holder, name)
                .and_then(|it| Self::create(vm, name, it.into(), Some(value), place, 0))
                .or_else(|| {
                    let presence = PropertyCondition::presence(&holder, name)?;
                    Self::create(vm, name, presence.into(), None, place, 0)
                })
        })
    }

    /// The same for an assignment, which need tell nobody. `None` unless that goes for other code already.
    pub fn for_global_store(
        vm: &Vm,
        global: Gc<GlobalObject>,
        name: PropertyName<'_>,
    ) -> Option<Gc<PrototypeLookup>> {
        let holder = global.upcast::<JsObject>();
        Self::cached(vm, holder, name, Query::GlobalStore, || {
            let place = Some((holder, Some(holder.shape().get(name)?.0)));
            let replacement = PropertyCondition::replacement(&holder, name)?;
            Self::create(vm, name, replacement.into(), None, place, 0)
        })
    }

    pub(crate) fn did_hide_global(vm: &Vm, global: &GlobalObject, name: PropertyName<'_>) {
        for query in [Query::GlobalLoad, Query::GlobalStore] {
            let key = Key::new(global, name, query);
            let lookup = vm.services.prototype_lookups.map.get(vm, &key);
            if let Some(lookup) = lookup.filter(|it| it.is_valid()) {
                lookup.did_break(vm);
            }
        }
    }

    #[inline(always)]
    pub fn is_valid(&self) -> bool {
        self.is_valid.get()
    }

    #[inline(always)]
    pub fn constant(&self) -> Option<Value> {
        // SAFETY: the holder has it, or it is no cell.
        unsafe { Value::from_bits_or_empty(self.constant.get()) }
    }

    #[inline(always)]
    pub fn holder(&self) -> Option<Gc<JsObject>> {
        let address = self.holder.get();
        // SAFETY: cleared when it dies.
        (address != 0).then(|| unsafe { Gc::from_address(address) })
    }

    pub fn has_slot(&self) -> bool {
        self.byte_offset.is_some()
    }

    /// Panics if there is no slot.
    pub fn byte_offset(&self) -> i32 {
        self.byte_offset.expect("a slot").get()
    }

    /// What the slot of the holder has now.
    #[inline(always)]
    pub fn stored_value(&self) -> Option<Value> {
        let (holder, byte_offset) = (self.holder()?, self.byte_offset?);
        // SAFETY: a condition says that the holder has the slot.
        unsafe { super::slot_at(&holder, byte_offset.get()) }.get()
    }

    pub fn name(&self) -> PropertyName<'_> {
        self.name.name()
    }

    /// Fires when it becomes invalid.
    pub fn dependents(&self) -> &InlineWatchpointSet {
        &self.dependents
    }

    fn did_break(&self, vm: &Vm) {
        vm.lookup_epochs().advance();
        self.invalidate(vm);
    }

    fn invalidate(&self, vm: &Vm) {
        self.is_valid.set(false);
        self.constant.set(0);
        self.holder.set(0);
        self.guards.take();
        self.dependents.invalidate(vm);
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.reconcile_current_cell_later();
    }

    /// Whether or not it has been reconciled yet.
    pub(super) fn stays_valid(&self, survivors: &Survivors) -> bool {
        self.is_valid()
            && self.guards.borrow().0.is_live(survivors)
            && (self.operand == 0 || survivors.contains_address(self.operand))
    }

    fn reconcile_weak_references(&self, survivors: &Survivors) {
        if self.is_valid() && !self.stays_valid(survivors) {
            self.invalidate(survivors.vm());
        }
    }
}
