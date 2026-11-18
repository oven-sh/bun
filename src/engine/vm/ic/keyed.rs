//! Many a site whose key is a value always has the same. Its list has room for a copy of one case for that.

use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_text::PropertyName;

use super::cases::Sample;
use super::{
    AccessCase, AccessCases, AccessKind, CaseList, InlineCase, InlineKind, InlineLoad, InlineStore,
    static_name_for_key,
};
use crate::heap::Survivors;
use crate::{CodeBlock, JsString, JsSymbol, ShapeId, Value, Vm};

#[derive(Default)]
#[repr(C)]
pub struct KeyedCase {
    /// The bits of an atom, a symbol or one of `STATIC_KEYS`. It is not kept alive. Otherwise zero or a constant.
    key: Cell<u64>,
    case: InlineCase,
}

const _: () = assert!(JsString::OFFSET_OF_FIBER == JsSymbol::OFFSET_OF_NAME);

impl KeyedCase {
    pub const OFFSET_OF_KEY: usize = offset_of!(KeyedCase, key);
    pub const OFFSET_OF_CASE: usize = offset_of!(KeyedCase, case);

    /// There is no point in adopting a key until there is another case. No value has these bits.
    const UNSUITABLE: u64 = 1;
    /// Nor ever.
    const VARIES: u64 = 3;

    #[inline(always)]
    pub fn key(&self) -> u64 {
        self.key.get()
    }

    #[inline(always)]
    pub fn case(&self) -> &InlineCase {
        &self.case
    }

    fn key_value(&self) -> Option<Value> {
        // SAFETY: cleared when it dies.
        (!matches!(self.key(), 0 | Self::UNSUITABLE | Self::VARIES))
            .then(|| unsafe { Value::from_bits(self.key()) })
    }

    fn name_address(&self) -> Option<usize> {
        let key = self.key_value()?;
        match key.as_cell() {
            // SAFETY: both kinds have it there.
            Some(cell) => Some(unsafe {
                *core::ptr::with_exposed_provenance(cell.address() + JsSymbol::OFFSET_OF_NAME)
            }),
            None => static_name_for_key(key).map(PropertyName::address),
        }
    }

    pub(super) fn copy_from(&self, other: &KeyedCase) {
        self.key.set(other.key());
        self.case.copy_from(&other.case);
    }

    fn give_up(&self, reason: u64) {
        self.key.set(reason);
        self.case.key.clear();
    }

    pub(super) fn did_add_case(&self, vm: &Vm, cases: &[AccessCase]) {
        if self.key() == Self::UNSUITABLE {
            self.key.set(0);
        }
        self.choose(vm, cases, self.case.key.shape());
    }

    /// The cases of a site are all loads and questions, or all stores.
    fn choose(&self, vm: &Vm, cases: &[AccessCase], shape: ShapeId) {
        let Some(name) = self.name_address() else {
            return;
        };
        // Native code gets the name, which compiled code takes from the cell.
        let is_cell = self.key_value().is_some_and(Value::is_cell);
        let candidates = (cases.iter().filter(|it| it.key.get() == name))
            .filter(|it| is_cell || (it.kind() as u8) < AccessKind::FIRST_THAT_CALLS as u8);
        if !(self.case).choose::<InlineLoad>(vm, candidates.clone(), shape)
            && !self.case.choose::<InlineStore>(vm, candidates, shape)
        {
            self.give_up(Self::UNSUITABLE);
        }
    }

    pub(super) fn reconcile(&self, cases: &[AccessCase], survivors: &Survivors) {
        match self.key_value() {
            Some(key) if !survivors.contains_value(key) => self.give_up(0),
            _ => self.choose(survivors.vm(), cases, self.case.key.shape()),
        }
    }
}

impl CaseList {
    #[inline(never)]
    fn adopt_key(&self, vm: &Vm, owner: &CodeBlock, key: Value, shape: ShapeId) {
        self.keyed().key.set(key.to_bits());
        self.keyed().choose(vm, self.cases(), shape);
        owner.write_barrier_for_cell();
    }
}

impl AccessCases {
    /// For a slow path, before the access. `key` is a value that `KeyedCase` can have, and stands for the name.
    #[inline(always)]
    pub(super) fn will_use_key(
        &self,
        vm: &Vm,
        shape: ShapeId,
        (key, name): (Value, PropertyName<'_>),
    ) {
        // SAFETY: nothing here adds a case or collects.
        let Some(list) = (unsafe { self.list() }) else {
            return;
        };
        let (keyed, inline) = (list.keyed(), &list.keyed().case.key);
        if keyed.key_value().is_some_and(|it| it != key) {
            keyed.give_up(KeyedCase::VARIES);
        }
        match list.take_sample(shape, name.address()) {
            Some(Sample::First) => inline.clear(),
            Some(Sample::Last) => keyed.choose(vm, list.cases(), ShapeId::NONE),
            None if inline.is_out_of_date(vm, shape) => keyed.choose(vm, list.cases(), shape),
            Some(Sample::Another) | None => {}
        }
    }

    /// And after it.
    #[inline(always)]
    pub(super) fn did_use_key(&self, vm: &Vm, owner: &CodeBlock, shape: ShapeId, key: Value) {
        // SAFETY: as above.
        if let Some(list) = unsafe { self.list() }
            && list.keyed().key() == 0
        {
            list.adopt_key(vm, owner, key, shape);
        }
    }

    /// What is worth a place in compiled code.
    pub fn likely_keyed_kind<K: InlineKind>(&self) -> Option<K> {
        // SAFETY: as above.
        let list = unsafe { self.list() }?;
        let name = list.keyed().name_address()?;
        (list.cases().iter().all(|it| it.key.get() == name))
            .then(|| K::from_tag(list.keyed().case.key.tag()))
    }
}
