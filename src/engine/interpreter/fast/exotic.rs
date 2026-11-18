use bun_engine_bytecode::{Register, Width, op};
use bun_engine_vm::caches::{LoadEntry, StoreEntry};
use bun_engine_vm::code::metadata::{self, Flags, ForInGet, GetPrivateName, PutPrivateName};
use bun_engine_vm::ic::{self, InlineKey};
use bun_engine_vm::{
    EnumerationMode, ForIn, ForInRegisters, JsObject, JsSymbol, MappedArguments,
    PropertyNameEnumerator, Step, Value, ValueProfile, for_in_next_slow,
};

use super::barrier_and_next;
use crate::machine::{EMPTY, Machine, boolean, branch, cell, go, handler, jump, next, slow};
use crate::slow::Frame;
use crate::stubs;

impl<W: Width> Machine<W> {
    #[inline(always)]
    unsafe fn for_in(&self, state: Register) -> ForIn {
        // SAFETY: what an instruction has put there.
        unsafe {
            let part = |index| Value::from_bits(self.reg(state.nth(index)));
            ForIn::from_registers([part(0), part(1), part(2)])
        }
    }
}

#[inline(always)]
fn has_seen(modes: &Flags, mode: EnumerationMode) -> bool {
    modes.0.get() & mode as u32 != 0
}

handler! {
    fn get_from_arguments(m, op: op::GetFromArguments) {
        let value = cell::<MappedArguments>(m.reg(op.arguments)).slot_unchecked(op.index).get().to_bits();
        m.entry::<ValueProfile>(op.metadata).record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn put_to_arguments(m, op: op::PutToArguments) {
        let (arguments, value) = (cell::<MappedArguments>(m.reg(op.arguments)), m.get(op.value));
        arguments.slot_unchecked(op.index).set_without_barrier(Value::from_bits(value));
        barrier_and_next!(m, op: op::PutToArguments, arguments, value)
    }

    fn ensure_arguments(m, op: op::EnsureArguments) {
        if m.reg(op.arguments) == EMPTY {
            slow!(m, op::EnsureArguments)
        }
        next!(m, op)
    }

    fn for_in_next(m, op: op::ForInNext) {
        let mut for_in = m.for_in(op.state);
        if let Some(name) = for_in.try_next(Value::from_bits(m.reg(op.base)))
            && has_seen(&m.entry::<metadata::ForIn>(op.metadata).modes, EnumerationMode::OwnShape)
        {
            m.set(op.state.nth(2), m.box_int32(for_in.index as i32));
            m.set(op.name, name.address() as u64);
            next!(m, op)
        }
        if m.for_in(op.state).is_at_end() {
            jump!(m, op.done)
        }
        go!(m, for_in_next_other::<W>)
    }

    #[inline(never)]
    fn for_in_next_other(m, op: op::ForInNext) {
        let Some(object) = m.as_object(m.reg(op.base)) else { go!(m, for_in_next_by_call::<W>) };
        match m.state::<ForInRegisters>(op.state).try_next(m.vm, m.entry(op.metadata), &object) {
            Step::FAILED => go!(m, for_in_next_by_call::<W>),
            Step::DONE => jump!(m, op.done),
            name => m.set(op.name, name.bits()),
        }
        next!(m, op)
    }

    #[inline(never)]
    fn for_in_next_by_call(m, op: op::ForInNext) {
        let (base, (cx, _)) = (Value::from_bits(m.reg(op.base)), Frame::enter(m.vm, m.frame(), m.start()));
        match for_in_next_slow(cx, m.state(op.state), m.entry(op.metadata), base) {
            Step::FAILED => go!(m, stubs::throw),
            Step::DONE => jump!(m, op.done),
            name => m.set(op.name, name.bits()),
        }
        next!(m, op)
    }

    fn for_in_open(m, op: op::ForInOpen) {
        let object = m.as_object(m.get(op.base));
        let Some(enumerator) = object.and_then(|it| PropertyNameEnumerator::current_for(m.vm, &it)) else {
            slow!(m, op::ForInOpen)
        };
        let opened = ForIn::with_enumerator(enumerator);
        m.state::<ForInRegisters>(op.state).open(opened);
        branch!(m, op, opened.is_none(), op.empty)
    }

    fn for_in_get(m, op: op::ForInGet) {
        let (for_in, base) = (m.for_in(op.state), m.get(op.base));
        let entry = m.entry::<ForInGet>(op.metadata);
        let value = if let Some((object, offset)) = for_in.object_with_slot(Value::from_bits(base)) {
            object.slot_unchecked(offset).get()
        } else if for_in.mode == EnumerationMode::Indexed && let Some(object) = m.as_object(base) {
            entry.for_in.array.record_shape(&object);
            object.try_get_dense(for_in.index)
        } else {
            go!(m, for_in_get_by_name::<W>)
        };
        let Some(value) = value.filter(|_| has_seen(&entry.for_in.modes, for_in.mode)) else {
            slow!(m, op::ForInGet)
        };
        entry.value.record(value);
        m.set(op.dst, value.to_bits());
        next!(m, op)
    }

    #[inline(never)]
    fn for_in_get_by_name(m, op: op::ForInGet) {
        let (base, entry) = (m.get(op.base), m.entry::<ForInGet>(op.metadata));
        let (true, Some(name)) = (m.is_cell(base), m.name_of_key(m.reg(op.name))) else { slow!(m, op::ForInGet) };
        let value = m.try_load_by_name(&entry.for_in.cases, &cell(base), name);
        if value == EMPTY {
            slow!(m, op::ForInGet)
        }
        entry.for_in.modes.record(m.for_in(op.state).profile_for(Value::from_bits(base)));
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn for_in_put(m, op: op::ForInPut) {
        let (for_in, modes) = (m.for_in(op.state), &m.entry::<metadata::ForIn>(op.metadata).modes);
        let Some((object, offset)) = for_in
            .object_with_writable_slot(Value::from_bits(m.get(op.base)))
            .filter(|_| has_seen(modes, EnumerationMode::OwnShape))
        else {
            go!(m, for_in_put_by_name::<W>)
        };
        let value = m.get(op.value);
        object.slot_unchecked(offset).set_without_barrier(Some(Value::from_bits(value)));
        barrier_and_next!(m, op: op::ForInPut, object, value)
    }

    #[inline(never)]
    fn for_in_put_by_name(m, op: op::ForInPut) {
        let (base, entry) = (m.get(op.base), m.entry::<metadata::ForIn>(op.metadata));
        let (true, Some(name)) = (m.is_cell(base), m.name_of_key(m.reg(op.name))) else { slow!(m, op::ForInPut) };
        let object = cell::<JsObject>(base);
        if !m.try_store_by_name(&entry.cases, &object, object.shape_id(), name, m.get(op.value)) {
            slow!(m, op::ForInPut)
        }
        entry.modes.record(m.for_in(op.state).profile_for(object.into()));
        barrier_and_next!(m, op: op::ForInPut, object)
    }

    fn for_in_has(m, op: op::ForInHas) {
        if m.for_in(op.state).object_with_slot(Value::from_bits(m.get(op.base))).is_none()
            || !has_seen(&m.entry::<metadata::ForIn>(op.metadata).modes, EnumerationMode::OwnShape)
        {
            slow!(m, op::ForInHas)
        }
        m.set(op.dst, boolean(true));
        next!(m, op)
    }

    fn for_in_has_own(m, op: op::ForInHasOwn) {
        let for_in = m.for_in(op.state);
        if !m.as_cell(m.get(op.base)).is_some_and(|it| for_in.is_own(&it))
            || !has_seen(&m.entry::<metadata::ForIn>(op.metadata).modes, for_in.mode)
        {
            slow!(m, op::ForInHasOwn)
        }
        m.set(op.dst, boolean(true));
        next!(m, op)
    }
}

handler! {
    fn get_private_name(m, op: op::GetPrivateName) {
        let base = m.get(op.base);
        if !m.is_cell(base) {
            slow!(m, op::GetPrivateName)
        }
        let (object, entry) = (cell::<JsObject>(base), m.entry::<GetPrivateName>(op.metadata));
        if object.shape_id().bits() ^ entry.cache.inline().key() as u32 > InlineKey::TAG_MASK
            || m.reg(op.name) != entry.name.bits() as u64
        {
            go!(m, get_private_name_from_cases::<W>; base)
        }
        let value = Value::bits_of(ic::slot_at(&object, entry.cache.byte_offset()).get());
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    #[inline(never)]
    fn get_private_name_from_cases(m, op: op::GetPrivateName, base) {
        let (object, entry) = (cell::<JsObject>(base), m.entry::<GetPrivateName>(op.metadata));
        let (cases, symbol) = (entry.cache.all_cases(), cell::<JsSymbol>(m.reg(op.name)));
        let value = if let Some(list) = cases.list() {
            let case = list.find(object.shape_id(), symbol.name().address());
            case.and_then(|it| ic::slot_at(&object, it.plain_offset()).get())
        } else if cases.is_megamorphic() {
            let found = LoadEntry::find(m.vm, object.shape_id(), symbol.name());
            found.filter(|it| it.is_own()).and_then(|it| it.plain_value(&object))
        } else {
            None
        };
        let Some(value) = value else { slow!(m, op::GetPrivateName) };
        entry.value.record(value);
        m.set(op.dst, value.to_bits());
        next!(m, op)
    }

    fn check_private_brand(m, op: op::CheckPrivateBrand) {
        let base = m.get(op.base);
        if !m.is_cell(base) {
            slow!(m, op::CheckPrivateBrand)
        }
        let (object, entry) = (cell::<JsObject>(base), m.entry::<PutPrivateName>(op.metadata));
        if object.shape_id().bits() != entry.cache.inline().key() as u32 || m.reg(op.brand) != entry.name.bits() as u64 {
            let (cases, brand) = (entry.cache.all_cases(), cell::<JsSymbol>(m.reg(op.brand)));
            let has_brand = match cases.list() {
                Some(list) => list.find(object.shape_id(), brand.name().address()).is_some(),
                None => cases.is_megamorphic()
                    && LoadEntry::find(m.vm, object.shape_id(), brand.name()).is_some_and(LoadEntry::is_present),
            };
            if !has_brand {
                slow!(m, op::CheckPrivateBrand)
            }
        }
        next!(m, op)
    }
}

macro_rules! private_stores {
    ($(
        $name:ident, $from_cases:ident, $Op:ident, $symbol:ident, |$shape:ident| $key:expr,
        |$m:ident, $op:ident| ($base:expr, $value:expr);
    )*) => { handler! {$(
        fn $name($m, $op: op::$Op) {
            let base = $base;
            if !$m.is_cell(base) {
                slow!($m, op::$Op)
            }
            let (object, entry) = (cell::<JsObject>(base), $m.entry::<PutPrivateName>($op.metadata));
            let case = entry.cache.inline();
            if !$m.is_inline_store(case, object.shape_id()) || $m.reg($op.$symbol) != entry.name.bits() as u64 {
                go!($m, $from_cases::<W>; base)
            }
            $m.store_inline(case, &object, $value);
            barrier_and_next!($m, $op: op::$Op, object)
        }

        #[inline(never)]
        fn $from_cases($m, $op: op::$Op, base) {
            let (object, entry) = (cell::<JsObject>(base), $m.entry::<PutPrivateName>($op.metadata));
            let (cases, symbol) = (entry.cache.all_cases(), cell::<JsSymbol>($m.reg($op.$symbol)));
            let $shape = object.shape_id();
            if !$m.try_store_by_name(cases, &object, $key, symbol.name(), $value) {
                slow!($m, op::$Op)
            }
            barrier_and_next!($m, $op: op::$Op, object)
        }
    )*} };
}

private_stores! {
    put_private_name, put_private_name_from_cases, PutPrivateName, name, |shape| shape,
        |m, op| (m.get(op.base), m.get(op.value));
    define_private_name, define_private_name_from_cases, DefinePrivateName, name,
        |shape| StoreEntry::key_for_defining(shape),
        |m, op| (m.reg(op.base), m.get(op.value));
    set_private_brand, set_private_brand_from_cases, SetPrivateBrand, brand,
        |shape| StoreEntry::key_for_defining(shape),
        |m, op| (m.reg(op.base), JsObject::PRIVATE_BRAND_VALUE.to_bits());
}
