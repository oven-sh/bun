//! Holds each call to what the description of its form says.

use core::cell::Cell;
use core::hash::{BuildHasher, Hash, Hasher};

use super::form::FirstParameter;
use super::{Context, DirectForm, Kind, Reach, Register, State, Throws};
use crate::heap::MutatorState;
use crate::{
    DateInstance, ErrorInstance, FastHasher, Gc, GlobalObject, JsCell, JsString, JsStringIterator,
    RegExp, RegExpObject, RegExpStringIterator, RootVec, SpeculatedType as T, Value, Vm,
    WatchpointState, root_vec,
};

/// Of the form that is running.
#[thread_local]
static REACH: Cell<Option<Reach>> = Cell::new(None);
#[thread_local]
static HAS_EXTENDED_REALM: Cell<bool> = Cell::new(false);

#[thread_local]
static HAS_FIRED_WATCHPOINT: Cell<bool> = Cell::new(false);

#[track_caller]
pub(crate) fn will_allocate() {
    assert!(REACH.get() != Some(Reach::Leaf), "a leaf allocates");
}

#[track_caller]
pub(crate) fn will_run_script() {
    assert!(REACH.get().is_none(), "a form runs a script");
}

/// A slot or a watchpoint of a realm is asked for the first time.
pub(crate) fn will_extend_realm() {
    HAS_EXTENDED_REALM.set(true);
}

pub(crate) fn will_fire_watchpoint(vm: &Vm) {
    HAS_FIRED_WATCHPOINT.update(|it| it || vm.heap.mutator_state() == MutatorState::Running);
}

/// If a value or a cell is what is passed.
fn value_in(kind: Kind, register: u64) -> Option<Value> {
    match kind {
        Kind::Integer { .. } | Kind::Int52 | Kind::Unit | Kind::Characters => None,
        _ if kind.is_double() => None,
        // SAFETY: what generated code has passed for it.
        _ => unsafe { Value::from_bits_or_empty(register) },
    }
}

fn could_pass(kind: Kind, register: u64, global: Option<Gc<GlobalObject>>) -> bool {
    let value = value_in(kind, register);
    match kind {
        Kind::Integer { min, max, .. } => (min..=max).contains(&(register as i32)),
        Kind::Int52 => (register as i64) << 12 >> 12 == register as i64,
        Kind::Unit => register <= u16::MAX.into(),
        Kind::Undefined | Kind::Number | Kind::ToNumber | Kind::Characters => true,
        Kind::Value(_) | Kind::Literal => kind.types().contains(T::of(value)),
        Kind::Cell(wanted) => {
            value.and_then(Value::as_cell).map(|it| it.cell_type()) == Some(wanted)
        }
        Kind::Pattern(searches) => {
            (value.and_then(Value::downcast::<RegExp>)).is_some_and(|it| searches.suits(it.flags()))
        }
        Kind::Original(..) | Kind::PlainRegExp | Kind::PlainMatchIterator => {
            global.is_some_and(|global| kind.pass(&global, value) == Some(register))
        }
    }
}

fn is_for_lack_of_room(vm: &Vm) -> bool {
    let error = vm.exception().map(|it| it.value());
    vm.has_pending_termination_exception()
        || (error.and_then(Value::downcast::<ErrorInstance>))
            .is_some_and(|it| it.is_out_of_memory() || it.is_stack_overflow())
}

pub(super) struct Check {
    form: &'static DirectForm,
    /// That of the callee, if it is passed or an operand has to be of it.
    global: Option<Gc<GlobalObject>>,
    /// Zero if neither the context nor an operand leads to it.
    vm: usize,
    cells: RootVec<Gc<JsCell>>,
    /// A bit for each of `cells`.
    may_be_resolved: u32,
    first_operand: u64,
    kept: u64,
    kept_if_it_throws: u64,
}

impl Check {
    pub(super) fn begin(
        form: &'static DirectForm,
        context: &impl FirstParameter,
        registers: &[u64],
    ) -> Check {
        let passed = form.operands.iter().filter(|it| it.is_passed);
        let passed = passed.map(|it| it.kind).zip(registers.iter().copied());
        let (mut cells, mut global) = (root_vec(), None);
        for (kind, register) in passed.clone() {
            let cell = value_in(kind, register).and_then(Value::as_cell);
            let iterator = cell.and_then(Gc::downcast::<RegExpStringIterator>);
            cells.extend(
                cell.into_iter()
                    .chain(iterator.map(|it| it.matcher().cell())),
            );
            if let Kind::Original(..) = kind {
                global = cell.and_then(|it| it.shape().global());
            }
        }
        if form.context == Context::Realm {
            // SAFETY: what such a context is.
            global = Some(unsafe { Gc::from_address(context.address()) });
        }
        let cell = (global.map(Gc::cell)).or_else(|| cells.first().copied());
        let vm = match form.context {
            Context::Vm => context.address(),
            _ => cell.map_or(0, |it| core::ptr::from_ref(it.heap().vm()).addr()),
        };
        for (kind, register) in passed {
            assert!(could_pass(kind, register, global), "{kind:?}");
        }
        for &which in form.needs {
            let state = global.map(|it| it.watchpoints_unchecked(which).state());
            assert!(state == Some(WatchpointState::Watched), "{which:?}");
        }
        for slot in form.slots() {
            let cell = global.and_then(|it| it.slot_if_initialized(slot));
            assert!(cell.is_some(), "{slot:?}");
        }
        let is_rope = |it: &Gc<JsCell>| it.downcast::<JsString>().is_some_and(|it| it.is_rope());
        let ropes = (cells.iter().rev()).fold(0, |bits, it| bits << 1 | u32::from(is_rope(it)));
        let mut check = Check {
            form,
            global,
            vm,
            cells,
            may_be_resolved: if form.resolves_ropes { ropes } else { 0 },
            first_operand: registers.first().copied().unwrap_or_default(),
            kept: 0,
            kept_if_it_throws: 0,
        };
        assert!(check.vm().is_none_or(|vm| !vm.has_exception()));
        check.kept = check.hash_all_but(form.writes);
        check.kept_if_it_throws = check.hash_all_but(form.writes & State::LAST_MATCH);
        HAS_EXTENDED_REALM.set(false);
        HAS_FIRED_WATCHPOINT.set(false);
        assert!(REACH.replace(Some(form.reach)).is_none());
        check
    }

    pub(super) fn end(self, result: impl Register) {
        REACH.set(None);
        let (form, result) = (self.form, result.to_bits());
        let has_thrown = form.is_mark(result);
        assert!(self.vm().is_some_and(Vm::has_exception) == has_thrown);
        if has_thrown {
            assert!(form.throws == Throws::Errors || self.vm().is_some_and(is_for_lack_of_room));
            assert!(self.kept_if_it_throws == self.hash_all_but(form.writes & State::LAST_MATCH));
        } else {
            assert!(form.could_give(result, self.first_operand));
            assert!(!HAS_EXTENDED_REALM.get());
            assert!(!HAS_FIRED_WATCHPOINT.get() || form.writes.contains(State::TRANSITIONS));
            let is_result = |it: &Gc<JsCell>| it.address() as u64 == result && !it.is_string();
            assert!(!form.is_distinct || !self.cells.iter().any(is_result));
        }
        assert!(self.kept == self.hash_all_but(form.writes));
    }

    fn vm(&self) -> Option<&Vm> {
        // SAFETY: outlives the call.
        (self.vm != 0).then(|| unsafe { &*core::ptr::with_exposed_provenance(self.vm) })
    }

    /// Of the operands and the realm.
    fn hash_all_but(&self, written: State) -> u64 {
        let mut hasher = FastHasher::default().build_hasher();
        let mut add = |part: State, word: u64| {
            if !written.intersects(part) {
                word.hash(&mut hasher);
            }
        };
        for (index, &cell) in self.cells.iter().enumerate() {
            add(State::SHAPE, cell.shape().address() as u64);
            if let Some(string) = cell.downcast::<JsString>() {
                if self.may_be_resolved >> index & 1 == 0 {
                    add(State::empty(), string.fiber() as u64);
                }
            } else if let Some(regexp) = cell.downcast::<RegExpObject>() {
                add(State::LAST_INDEX, regexp.last_index().to_bits());
                add(State::PATTERN, regexp.regexp().address() as u64);
            } else if let Some(date) = cell.downcast::<DateInstance>() {
                add(State::DATE, date.time().to_bits());
            } else if let Some(iterator) = cell.downcast::<JsStringIterator>() {
                add(State::ITERATOR, iterator.index().into());
            } else if let Some(iterator) = cell.downcast::<RegExpStringIterator>() {
                add(State::ITERATOR, iterator.is_done().into());
            }
        }
        if let Some(global) = self.global {
            for word in global.last_match_as_words() {
                add(State::LAST_MATCH, word);
            }
            add(State::RANDOM, global.random_state().get().next_u64());
            add(State::CLOCK, global.overridden_date_now().get().to_bits());
        }
        hasher.finish()
    }
}
