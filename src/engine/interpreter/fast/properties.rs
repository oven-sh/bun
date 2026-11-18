use bun_engine_bytecode::{PutFlags, Width, op};
use bun_engine_text::{PropertyName, symbols};
use bun_engine_vm::caches::{LoadEntry, StoreEntry};
use bun_engine_vm::code::metadata::{
    ArrayAccess, CasesAndValue, GetById, GetByVal, GetLength, SetPrototype,
};
use bun_engine_vm::ic::{
    self, AccessCase, AccessCases, AccessKind, InlineCase, InlineLoad, InlineStore, StoreCache,
    operations,
};
use bun_engine_vm::{
    CellType, IndexingMode, JsCell, JsObject, JsString, JsSymbol, JsTypedArray, MappedArguments,
    OFFSET_OF_INTERNAL_FIELDS, ShapeId, TypeFlags, Value, ValueProfile,
};

use super::{barrier_and_next, operate};
use crate::machine::{EMPTY, Machine, boolean, cell, go, handler, jump, next, slow};
use crate::stubs;

impl<W: Width> Machine<W> {
    /// # Safety
    /// The case is of a site that loads, and for the shape of the object.
    #[inline(always)]
    unsafe fn try_load(&self, case: &AccessCase, object: &JsObject) -> u64 {
        if case.plain_offset() != 0 {
            // SAFETY: the caller's.
            Value::bits_of(unsafe { ic::slot_at(object, case.plain_offset()) }.get())
        } else if let Some(answer) = case.current_answer(self.vm) {
            answer
        } else if case.kind() == AccessKind::LoadInherited {
            Value::bits_of(case.lookup().and_then(|it| it.stored_value()))
        } else {
            EMPTY
        }
    }

    /// If that is what the inline case does.
    #[inline(always)]
    unsafe fn try_load_inherited(&self, case: &InlineCase, shape: ShapeId) -> u64 {
        let is = |kind| u64::from(shape.bits()) ^ self.vm.lookup_key(kind) == case.key();
        let place = case.constant();
        // SAFETY: a slot of the holder of a lookup that is valid.
        unsafe {
            if is(InlineLoad::InheritedInObject) {
                *core::ptr::with_exposed_provenance(place as usize)
            } else if is(InlineLoad::InheritedInStorage) {
                let holder = cell::<JsObject>(place & ((1 << InlineLoad::OFFSET_SHIFT) - 1));
                let slots = core::ptr::with_exposed_provenance::<u64>(holder.storage().address());
                *slots.offset((place as i64 >> InlineLoad::OFFSET_SHIFT) as isize)
            } else {
                EMPTY
            }
        }
    }

    /// The new shape and the offset of the slot.
    #[inline(always)]
    fn plain_store(&self, case: &AccessCase) -> Option<(ShapeId, i32)> {
        if case.plain_offset() == 0 {
            None
        } else if case.kind() == AccessKind::Replace {
            Some((case.shape(), case.plain_offset()))
        } else {
            (case.is_current_transition(self.vm)).then(|| (case.new_shape(), case.plain_offset()))
        }
    }

    /// Whether the inline case stores to a slot, is for the shape and holds.
    #[inline(always)]
    pub(super) fn is_inline_store(&self, case: &InlineCase, shape: ShapeId) -> bool {
        const ADDS: u32 = InlineStore::AddInObject as u32 - InlineStore::InObject as u32;
        const { assert!(ADDS == InlineStore::AddInStorage as u32 - InlineStore::InStorage as u32) };
        let tag = case.key() as u32 ^ shape.bits();
        tag <= InlineStore::InStorage as u32
            || (tag.wrapping_sub(ADDS) <= InlineStore::InStorage as u32
                && (case.key() >> 32) as u32 == self.vm.lookup_epoch())
    }

    /// The barrier is left to the caller.
    ///
    /// # Safety
    /// `is_inline_store` holds.
    #[inline(always)]
    pub(super) unsafe fn store_inline(&self, case: &InlineCase, object: &JsObject, value: u64) {
        // SAFETY: the caller's.
        unsafe {
            ic::slot_at(object, case.stored_slot())
                .set_without_barrier(Some(Value::from_bits(value)));
            if !case.new_shape().is_none() {
                object.set_shape_id_directly(case.new_shape());
            }
        }
    }
}

macro_rules! loads {
    ($(
        $name:ident, $from_cases:ident, $slow:ident, $Op:ident, $Entry:ident, $base:ident, $is_own:literal,
        |$cx:ident, $f:ident, $op:ident, $cache:ident, $value:ident| $operation:expr;
    )*) => { handler! {$(
        #[inline(always)]
        fn $name(m, op: op::$Op) {
            let base = m.get(op.$base);
            if !m.is_cell(base) {
                go!(m, $slow::<W>)
            }
            let (object, entry) = (cell::<JsObject>(base), m.entry::<$Entry>(op.metadata));
            let (shape, key) = (object.shape_id().bits(), entry.cache.inline().key());
            let value = if shape == key as u32 {
                *core::ptr::with_exposed_provenance::<u64>((base + (key >> 32)) as usize)
            } else if u64::from(shape) ^ m.vm.lookup_key(InlineLoad::Constant) == key {
                entry.cache.inline().constant()
            } else if shape ^ InlineLoad::InStorage as u32 == key as u32 {
                let address = object.storage().address().wrapping_add_signed((key as i64 >> 32) as isize);
                *core::ptr::with_exposed_provenance::<u64>(address)
            } else {
                go!(m, $from_cases::<W>; base)
            };
            entry.value.record_bits(value);
            m.set(op.dst, value);
            next!(m, op)
        }

        #[inline(never)]
        fn $from_cases(m, op: op::$Op, base) {
            let (object, entry) = (cell::<JsObject>(base), m.entry::<$Entry>(op.metadata));
            let (cases, shape) = (entry.cache.all_cases(), object.shape_id());
            let value = if let value @ 1.. = m.try_load_inherited(entry.cache.inline(), shape) {
                value
            } else if let Some(list) = cases.list() {
                match list.find_by_shape(shape) {
                    Some(case) if !list.count_turn() => {
                        let value = m.try_load(case, &object);
                        if value == EMPTY && let Some(getter) = case.function_to_call(&object) {
                            go!(m, stubs::call_accessor::<op::$Op, W>; getter.address(), base, EMPTY)
                        }
                        value
                    }
                    _ => EMPTY,
                }
            } else if cases.is_megamorphic()
                && let Some(found) =
                    LoadEntry::find_hashed(m.vm, shape, entry.cache.inline().constant() as usize, cases.name_hash())
                && (!$is_own || found.is_own())
            {
                Value::bits_of(found.plain_value(&object))
            } else {
                EMPTY
            };
            if value == EMPTY {
                go!(m, $slow::<W>)
            }
            entry.value.record_bits(value);
            m.set(op.dst, value);
            next!(m, op)
        }

        #[inline(never)]
        fn $slow(m, $op: op::$Op) {
            let (entry, $value) = (m.entry::<$Entry>($op.metadata), Value::from_bits(m.get($op.$base)));
            let $cache = &entry.cache;
            let value = operate!(m, |$cx, $f| $operation);
            entry.value.record(value);
            m.set($op.dst, value.to_bits());
            next!(m, $op)
        }
    )*} };
}

loads! {
    get_by_id, get_by_id_from_cases, get_by_id_slow, GetById, GetById, base, false,
        |cx, f, op, cache, base| operations::get_by_id(cx, f.code_block, cache, base, f.name(op.name));
    get_by_id_direct, get_by_id_direct_from_cases, get_by_id_direct_slow, GetByIdDirect, GetById, base, true,
        |cx, f, op, cache, base| operations::get_by_id_direct(cx, f.code_block, cache, base, f.name(op.name));
    get_has_instance_of_object, get_has_instance_from_cases, get_has_instance_slow, GetHasInstance, GetById,
        constructor, false,
        |cx, f, op, cache, base| operations::get_by_id(cx, f.code_block, cache, base, symbols::hasInstance);
    get_length_property, get_length_from_cases, get_length_slow, GetLength, GetLength, base, false,
        |cx, f, op, cache, base| operations::get_length(cx, f.code_block, cache, base);
}

handler! {
    fn get_has_instance(m, op: op::GetHasInstance) {
        if m.as_object(m.get(op.constructor)).is_none() {
            slow!(m, op::GetHasInstance)
        }
        go!(m, get_has_instance_of_object::<W>)
    }

    fn get_length(m, op: op::GetLength) {
        let base = m.get(op.base);
        if !m.is_cell(base) {
            slow!(m, op::GetLength)
        }
        let (object, entry) = (cell::<JsObject>(base), m.entry::<GetLength>(op.metadata));
        entry.array.record_shape(&object);
        let mode = object.indexing_mode();
        let length = if mode.is_array() && mode.bits() & IndexingMode::KIND_MASK != 0 {
            object.storage().public_length() as usize
        } else if object.is_string() {
            cell::<JsString>(base).len() as usize
        } else if u64::from(object.shape_id().bits()) ^ m.vm.lookup_key(InlineLoad::TypedArrayLength) == entry.cache.inline().key() {
            cell::<JsTypedArray>(base).known_length()
        } else if object.cell_type() != CellType::FinalObject
            && let Some(length) = object.downcast::<MappedArguments>().and_then(|it| it.original_length())
        {
            length as usize
        } else {
            go!(m, get_length_property::<W>)
        };
        if length > i32::MAX as usize {
            slow!(m, op::GetLength)
        }
        let length = m.box_int32(length as i32);
        entry.value.record_bits(length);
        m.set(op.dst, length);
        next!(m, op)
    }

    fn get_by_id_with_this(m, op: op::GetByIdWithThis) {
        let (base, entry) = (m.reg(op.base), m.entry::<CasesAndValue>(op.metadata));
        let case = m.as_cell(base).and_then(|it| entry.cases.list()?.find_by_shape(it.shape_id()));
        let value = case.map_or(EMPTY, |case| m.try_load(case, &cell(base)));
        if value == EMPTY {
            slow!(m, op::GetByIdWithThis)
        }
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn put_by_id(m, op: op::PutById) {
        let base = m.get(op.base);
        if !m.is_cell(base) {
            go!(m, put_by_id_slow::<W>)
        }
        let (object, cache) = (cell::<JsObject>(base), m.entry::<StoreCache>(op.metadata));
        let (shape, value, offset) = (object.shape_id().bits(), m.get(op.value), cache.byte_offset() as isize);
        let store = |base: usize| {
            let slot = core::ptr::with_exposed_provenance::<Field>(base.wrapping_add_signed(offset));
            (*slot).set_without_barrier(Some(Value::from_bits(value)));
        };
        if shape == cache.inline().key() as u32 {
            store(object.address());
            barrier_and_next!(m, op: op::PutById, object, value)
        }
        if u64::from(shape) ^ m.vm.lookup_key(InlineStore::AddInObject) == cache.inline().key() {
            store(object.address());
            object.set_shape_id_directly(cache.new_shape());
            barrier_and_next!(m, op: op::PutById, object)
        }
        if shape ^ InlineStore::InStorage as u32 == cache.inline().key() as u32 {
            store(object.storage().address());
            barrier_and_next!(m, op: op::PutById, object, value)
        }
        go!(m, put_by_id_from_cases::<W>; base)
    }

    #[inline(never)]
    fn put_by_id_from_cases(m, op: op::PutById, base) {
        let (object, cache) = (cell::<JsObject>(base), m.entry::<StoreCache>(op.metadata));
        let (cases, shape) = (cache.all_cases(), object.shape_id());
        let store = if u64::from(shape.bits()) ^ m.vm.lookup_key(InlineStore::AddInStorage) == cache.inline().key() {
            Some((cache.new_shape(), cache.byte_offset()))
        } else if let Some(list) = cases.list() {
            let case = list.find_by_shape(shape).filter(|_| !list.count_turn());
            let store = case.and_then(|it| m.plain_store(it));
            if store.is_none() && let Some(setter) = case.and_then(|it| it.function_to_call(&object)) {
                go!(m, stubs::call_accessor::<op::PutById, W>; setter.address(), base, m.get(op.value))
            }
            store
        } else if cases.is_megamorphic() {
            let key = if op.flags.contains(PutFlags::DIRECT) { StoreEntry::key_for_defining(shape) } else { shape };
            let name = m.code_block().identifier(op.name).address();
            StoreEntry::find_hashed(m.vm, key, name, cases.name_hash()).and_then(StoreEntry::plain_store)
        } else {
            None
        };
        let Some((new_shape, byte_offset)) = store else { go!(m, put_by_id_slow::<W>) };
        ic::slot_at(&object, byte_offset).set_without_barrier(Some(Value::from_bits(m.get(op.value))));
        if new_shape != shape {
            object.set_shape_id_directly(new_shape);
        }
        barrier_and_next!(m, op: op::PutById, object)
    }

    #[inline(never)]
    fn put_by_id_slow(m, op: op::PutById) {
        let (base, value) = (Value::from_bits(m.get(op.base)), Value::from_bits(m.get(op.value)));
        let operation = crate::slow::properties::operation_for_put_by_id(op.flags);
        operate!(m, |cx, f| operation(cx, f.code_block, m.entry(op.metadata), base, f.name(op.name), value));
        next!(m, op)
    }

    fn get_prototype_of(m, op: op::GetPrototypeOf) {
        let object = m.as_object(m.get(op.value));
        let Some(object) = object.filter(|it| !it.overrides_get_prototype()) else {
            slow!(m, op::GetPrototypeOf)
        };
        let prototype = object.prototype_direct().to_bits();
        m.entry::<ValueProfile>(op.metadata).record_bits(prototype);
        m.set(op.dst, prototype);
        next!(m, op)
    }

    fn set_prototype(m, op: op::SetPrototype) {
        let (object, entry) = (cell::<JsObject>(m.reg(op.object)), m.entry::<SetPrototype>(op.metadata));
        if object.shape_id() != entry.from.get() || entry.to.get().decode().prototype().to_bits() != m.get(op.prototype) {
            slow!(m, op::SetPrototype)
        }
        object.set_shape_id_directly(entry.to.get());
        barrier_and_next!(m, op: op::SetPrototype, object)
    }

    fn instanceof_custom(m, op: op::InstanceofCustom) {
        let global = m.code_block().global();
        let default = global.slot_if_initialized(bun_engine_vm::RealmSlot::function_prototype_has_instance);
        let flags = cell::<JsCell>(m.get(op.constructor)).inline_flags();
        if m.reg(op.has_instance) != default.map_or(EMPTY, |it| it.address() as u64)
            || !flags.contains(TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE)
        {
            slow!(m, op::InstanceofCustom)
        }
        if m.as_object(m.get(op.value)).is_none() {
            m.set(op.dst, boolean(false));
            jump!(m, op.done)
        }
        next!(m, op)
    }

    fn get_internal_field(m, op: op::GetInternalField) {
        let fields = m.get(op.base) as usize + OFFSET_OF_INTERNAL_FIELDS;
        let value = *core::ptr::with_exposed_provenance::<u64>(fields).add(op.index as usize);
        m.entry::<ValueProfile>(op.metadata).record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn put_internal_field(m, op: op::PutInternalField) {
        let (base, value) = (m.get(op.base), m.get(op.value));
        let fields = base as usize + OFFSET_OF_INTERNAL_FIELDS;
        let field = core::ptr::with_exposed_provenance_mut::<u64>(fields).add(op.index as usize);
        core::sync::atomic::AtomicU64::from_ptr(field).store(value, core::sync::atomic::Ordering::Relaxed);
        barrier_and_next!(m, op: op::PutInternalField, cell::<JsCell>(base), value)
    }
}

type Field = bun_engine_vm::Field<Option<Value>>;

impl<W: Width> Machine<W> {
    /// The name that a key stands for, if that is known at once.
    #[inline(always)]
    pub(super) unsafe fn name_of_key(&self, key: u64) -> Option<PropertyName<'static>> {
        // SAFETY: not empty. Both have the name in the word after the header, and the frame keeps the key alive.
        unsafe {
            let Some(cell) = self.as_cell(key) else {
                return ic::static_name_for_key(Value::from_bits(key));
            };
            ((cell.is_string() && cell.per_cell_bit()) || cell.is_symbol()).then(|| {
                *core::ptr::with_exposed_provenance::<PropertyName<'static>>(key as usize).add(1)
            })
        }
    }

    /// # Safety
    /// The cases are of a site that loads, by a key that varies.
    #[inline(always)]
    pub(super) unsafe fn try_load_by_name(
        &self,
        cases: &AccessCases,
        object: &JsObject,
        name: PropertyName<'_>,
    ) -> u64 {
        // SAFETY: the caller's, and nothing is called.
        unsafe {
            if let Some(list) = cases.list() {
                let case = list
                    .find(object.shape_id(), name.address())
                    .filter(|_| !list.count_turn());
                case.map_or(EMPTY, |case| self.try_load(case, object))
            } else if cases.is_megamorphic()
                && let Some(found) = LoadEntry::find(self.vm, object.shape_id(), name)
            {
                Value::bits_of(found.plain_value(object))
            } else {
                EMPTY
            }
        }
    }

    /// `key` is what to ask the cache of the `Vm` for. The barrier is left to the caller.
    ///
    /// # Safety
    /// The same, of a site that stores.
    #[inline(always)]
    pub(super) unsafe fn try_store_by_name(
        &self,
        cases: &AccessCases,
        object: &JsObject,
        key: ShapeId,
        name: PropertyName<'_>,
        value: u64,
    ) -> bool {
        let shape = object.shape_id();
        // SAFETY: as above.
        unsafe {
            let store = if let Some(list) = cases.list() {
                list.find(shape, name.address())
                    .and_then(|it| self.plain_store(it))
            } else if cases.is_megamorphic() {
                StoreEntry::find(self.vm, key, name).and_then(StoreEntry::plain_store)
            } else {
                None
            };
            let Some((new_shape, byte_offset)) = store else {
                return false;
            };
            ic::slot_at(object, byte_offset).set_without_barrier(Some(Value::from_bits(value)));
            if new_shape != shape {
                object.set_shape_id_directly(new_shape);
            }
        }
        true
    }

    #[inline(always)]
    unsafe fn try_has(
        &self,
        cases: &AccessCases,
        shape: ShapeId,
        name: PropertyName<'_>,
        key: usize,
    ) -> Option<u64> {
        // SAFETY: nothing is called.
        match unsafe { cases.list() } {
            Some(list) => list.find(shape, key)?.current_answer(self.vm),
            None if cases.is_megamorphic() => {
                Some(boolean(LoadEntry::find(self.vm, shape, name)?.is_present()))
            }
            None => None,
        }
    }
}

const _: () = assert!(JsString::OFFSET_OF_FIBER == 8 && JsSymbol::OFFSET_OF_NAME == 8);

handler! {
    #[inline(never)]
    fn get_by_name(m, op: op::GetByVal) {
        let (base, key, entry) = (m.get(op.base), m.get(op.key), m.entry::<GetByVal>(op.metadata));
        if !m.is_cell(base) {
            go!(m, get_by_val_slow::<W>)
        }
        let object = cell::<JsObject>(base);
        if let Some(list) = entry.cases.list() && list.keyed().key() == key {
            let (case, shape) = (list.keyed().case(), object.shape_id().bits());
            let value = if shape ^ case.key() as u32 <= InlineLoad::InStorage as u32 {
                Value::bits_of(ic::slot_at(&object, case.loaded_slot()).get())
            } else if u64::from(shape) ^ m.vm.lookup_key(InlineLoad::Constant) == case.key() {
                case.constant()
            } else {
                go!(m, get_by_name_from_cases::<W>; base)
            };
            entry.value.record_bits(value);
            m.set(op.dst, value);
            next!(m, op)
        }
        go!(m, get_by_name_from_cases::<W>; base)
    }

    #[inline(never)]
    fn get_by_name_from_cases(m, op: op::GetByVal, base) {
        let Some(name) = m.name_of_key(m.get(op.key)) else { go!(m, get_by_val_slow::<W>) };
        let (object, entry) = (cell::<JsObject>(base), m.entry::<GetByVal>(op.metadata));
        let value = m.try_load_by_name(&entry.cases, &object, name);
        if value == EMPTY {
            go!(m, get_by_val_slow::<W>)
        }
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    #[inline(never)]
    fn get_by_val_slow(m, op: op::GetByVal) {
        let (base, key) = (Value::from_bits(m.get(op.base)), Value::from_bits(m.get(op.key)));
        let entry = m.entry::<GetByVal>(op.metadata);
        let value = operate!(m, |cx, f| operations::get_by_val(cx, f.code_block, &entry.access, base, key));
        entry.value.record(value);
        m.set(op.dst, value.to_bits());
        next!(m, op)
    }

    fn in_by_id(m, op: op::InById) {
        let Some(object) = m.as_object(m.get(op.base)) else { slow!(m, op::InById) };
        let answer = m.try_has(m.entry(op.metadata), object.shape_id(), m.code_block().identifier(op.name), 0);
        let Some(answer) = answer else { slow!(m, op::InById) };
        m.set(op.dst, answer);
        next!(m, op)
    }

    fn in_by_val(m, op: op::InByVal) {
        let (Some(object), key) = (m.as_object(m.get(op.base)), m.get(op.key)) else { slow!(m, op::InByVal) };
        let entry = m.entry::<ArrayAccess>(op.metadata);
        if m.is_int32(key) {
            if object.try_get_dense(key as u32).is_none() {
                go!(m, in_by_val_slow::<W>)
            }
            entry.array.record_shape(&object);
            m.set(op.dst, boolean(true));
            next!(m, op)
        }
        let answer = m.name_of_key(key).and_then(|it| m.try_has(&entry.cases, object.shape_id(), it, it.address()));
        let Some(answer) = answer else { go!(m, in_by_val_slow::<W>) };
        m.set(op.dst, answer);
        next!(m, op)
    }

    #[inline(never)]
    fn in_by_val_slow(m, op: op::InByVal) {
        let (base, key) = (Value::from_bits(m.get(op.base)), Value::from_bits(m.get(op.key)));
        let answer = operate!(m, |cx, f| operations::in_by_val(cx, f.code_block, m.entry(op.metadata), base, key));
        m.set(op.dst, answer.to_bits());
        next!(m, op)
    }

    fn has_private_name(m, op: op::HasPrivateName) {
        let (Some(object), name) = (m.as_object(m.get(op.base)), cell::<JsSymbol>(m.reg(op.name))) else {
            slow!(m, op::HasPrivateName)
        };
        let answer = m.try_has(m.entry(op.metadata), object.shape_id(), name.name(), name.name().address());
        let Some(answer) = answer else { slow!(m, op::HasPrivateName) };
        m.set(op.dst, answer);
        next!(m, op)
    }

    fn has_private_brand(m, op: op::HasPrivateBrand) {
        let (Some(object), name) = (m.as_object(m.get(op.base)), cell::<JsSymbol>(m.reg(op.brand))) else {
            slow!(m, op::HasPrivateBrand)
        };
        let answer = m.try_has(m.entry(op.metadata), object.shape_id(), name.name(), name.name().address());
        let Some(answer) = answer else { slow!(m, op::HasPrivateBrand) };
        m.set(op.dst, answer);
        next!(m, op)
    }

    fn delete_by_id(m, op: op::DeleteById) {
        let base = Value::from_bits(m.get(op.base));
        let operation = if op.strict { operations::delete_by_id::<true> } else { operations::delete_by_id::<false> };
        let answer = operate!(m, |cx, f| operation(cx, f.code_block, m.entry(op.metadata), base, f.name(op.name)));
        m.set(op.dst, answer.to_bits());
        next!(m, op)
    }

    fn delete_by_val(m, op: op::DeleteByVal) {
        let (base, key) = (Value::from_bits(m.get(op.base)), Value::from_bits(m.get(op.key)));
        let operation = if op.strict { operations::delete_by_val::<true> } else { operations::delete_by_val::<false> };
        let answer = operate!(m, |cx, f| operation(cx, f.code_block, m.entry(op.metadata), base, key));
        m.set(op.dst, answer.to_bits());
        next!(m, op)
    }

    fn instanceof(m, op: op::Instanceof) {
        let prototype = m.reg(op.prototype);
        let (Some(mut object), Some(_)) = (m.as_object(m.get(op.value)), m.as_object(prototype)) else {
            slow!(m, op::Instanceof)
        };
        let result = loop {
            if object.overrides_get_prototype() {
                slow!(m, op::Instanceof)
            }
            let next = object.prototype_direct().to_bits();
            if next == prototype || !m.is_cell(next) {
                break next == prototype;
            }
            object = cell(next);
        };
        m.set(op.dst, boolean(result));
        next!(m, op)
    }
}

macro_rules! stores_by_name {
    ($(
        $name:ident, $from_cases:ident, $slow:ident, $Op:ident, |$shape:ident| $key:expr, |$op:ident| $operation:expr;
    )*) => { handler! {$(
        #[inline(never)]
        fn $name(m, op: op::$Op) {
            let base = m.get(op.base);
            if let Some(list) = m.entry::<ArrayAccess>(op.metadata).cases.list()
                && list.keyed().key() == m.get(op.key)
                && m.is_cell(base)
                && m.is_inline_store(list.keyed().case(), cell::<JsCell>(base).shape_id())
            {
                m.store_inline(list.keyed().case(), &cell(base), m.get(op.value));
                barrier_and_next!(m, op: op::$Op, cell::<JsCell>(base))
            }
            go!(m, $from_cases::<W>)
        }

        #[inline(never)]
        fn $from_cases(m, op: op::$Op) {
            let base = m.get(op.base);
            let (true, Some(name)) = (m.is_cell(base), m.name_of_key(m.get(op.key))) else { go!(m, $slow::<W>) };
            let (object, cases) = (cell::<JsObject>(base), &m.entry::<ArrayAccess>(op.metadata).cases);
            let $shape = object.shape_id();
            if !m.try_store_by_name(cases, &object, $key, name, m.get(op.value)) {
                go!(m, $slow::<W>)
            }
            barrier_and_next!(m, op: op::$Op, object)
        }

        #[inline(never)]
        fn $slow(m, $op: op::$Op) {
            let [base, key, value] = [$op.base, $op.key, $op.value].map(|it| Value::from_bits(m.get(it)));
            operate!(m, |cx, f| $operation(cx, f.code_block, m.entry($op.metadata), base, key, value));
            next!(m, $op)
        }
    )*} };
}

stores_by_name! {
    put_by_name, put_by_name_from_cases, put_by_val_slow, PutByVal, |shape| shape,
        |op| (if op.strict { operations::put_by_val::<true> } else { operations::put_by_val::<false> });
    put_by_name_direct, put_by_name_direct_from_cases, put_by_val_direct_slow, PutByValDirect, |shape| StoreEntry::key_for_defining(shape),
        |op| operations::put_by_val_direct;
}
