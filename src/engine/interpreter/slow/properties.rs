use bun_engine_bytecode::PutFlags;
use bun_engine_macros::native_abi;
use bun_engine_text::{PropertyName, symbols};
use bun_engine_vm::code::metadata::{
    CasesAndValue, Flags, GetById, GetByVal, GetLength, SetPrototype,
};
use bun_engine_vm::ic::{StoreCache, operations};
use bun_engine_vm::{
    CodeBlock, Cx, Field, JsCell, JsObject, JsResult, OFFSET_OF_INTERNAL_FIELDS, PutPropertySlot,
    TypeFlags, Value, errors,
};

use super::{Next, execute};

#[native_abi]
type PutById =
    fn(&mut Cx, &CodeBlock, &StoreCache, Value, PropertyName<'_>, Value) -> JsResult<Value>;

#[inline(always)]
pub(crate) fn operation_for_put_by_id(flags: PutFlags) -> PutById {
    if flags.contains(PutFlags::DIRECT) {
        operations::put_by_id_direct
    } else if flags.contains(PutFlags::STRICT) {
        operations::put_by_id::<true>
    } else {
        operations::put_by_id::<false>
    }
}

/// # Safety
/// The cell has that many internal fields.
unsafe fn internal_field(cell: &JsCell, index: u32) -> &Field<Option<Value>> {
    let address = cell.address() + OFFSET_OF_INTERNAL_FIELDS + index as usize * size_of::<u64>();
    // SAFETY: the caller's.
    unsafe { &*core::ptr::with_exposed_provenance(address) }
}

execute! {
    GetById(op, cx, f) {
        let cache = &f.entry::<GetById>(op.metadata).cache;
        let value = operations::get_by_id(cx, f.code_block, cache, f.get(op.base), f.name(op.name))?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetLength(op, cx, f) {
        let (entry, base) = (f.entry::<GetLength>(op.metadata), f.get(op.base));
        entry.array.record_base(base);
        f.set_profiled(op.dst, op.metadata, operations::get_length(cx, f.code_block, &entry.cache, base)?);
    }
    GetByIdDirect(op, cx, f) {
        let cache = &f.entry::<GetById>(op.metadata).cache;
        let value = operations::get_by_id_direct(cx, f.code_block, cache, f.get(op.base), f.name(op.name))?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetByIdWithThis(op, cx, f) {
        let cases = &f.entry::<CasesAndValue>(op.metadata).cases;
        let (base, this, name) = (f.reg(op.base), f.get(op.this), f.name(op.name));
        let value = operations::get_by_id_with_this(cx, f.code_block, cases, base, name, this)?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetByVal(op, cx, f) {
        let value = operations::get_by_val(cx, f.code_block, f.entry::<GetByVal>(op.metadata), f.get(op.base), f.get(op.key))?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    GetByValWithThis(op, cx, f) {
        let (base, key, this) = (f.get(op.base), f.get(op.key), f.get(op.this));
        let value = operations::get_by_val_with_this(cx, f.code_block, f.entry::<GetByVal>(op.metadata), base, key, this)?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    PutById(op, cx, f) {
        let operation = operation_for_put_by_id(op.flags);
        operation(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.name(op.name), f.get(op.value))?;
    }
    PutByIdWithThis(op, cx, f) {
        let mut slot = PutPropertySlot::new(f.get(op.this), op.strict);
        f.reg(op.base).put(cx, f.name(op.name), f.get(op.value), &mut slot)?;
    }
    PutByVal(op, cx, f) {
        let operation = if op.strict { operations::put_by_val::<true> } else { operations::put_by_val::<false> };
        operation(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.get(op.key), f.get(op.value))?;
    }
    PutByValDirect(op, cx, f) {
        let (base, key, value) = (f.get(op.base), f.get(op.key), f.get(op.value));
        operations::put_by_val_direct(cx, f.code_block, f.entry(op.metadata), base, key, value)?;
    }
    PutByValWithThis(op, cx, f) {
        let base = f.get(op.base);
        if base.is_undefined_or_null() {
            return Err(errors::throw_not_an_object(cx, base));
        }
        let key = f.get(op.key).to_property_key(cx)?;
        let mut slot = PutPropertySlot::new(f.get(op.this), op.strict);
        base.put(cx, key.name(), f.get(op.value), &mut slot)?;
    }
    DeleteById(op, cx, f) {
        let operation = if op.strict { operations::delete_by_id::<true> } else { operations::delete_by_id::<false> };
        f.set(op.dst, operation(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.name(op.name))?);
    }
    DeleteByVal(op, cx, f) {
        let operation = if op.strict { operations::delete_by_val::<true> } else { operations::delete_by_val::<false> };
        f.set(op.dst, operation(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.get(op.key))?);
    }
    InById(op, cx, f) {
        f.set(op.dst, operations::in_by_id(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.name(op.name))?);
    }
    InByVal(op, cx, f) {
        f.set(op.dst, operations::in_by_val(cx, f.code_block, f.entry(op.metadata), f.get(op.base), f.get(op.key))?);
    }
    GetPrototypeOf(op, cx, f) {
        f.set_profiled(op.dst, op.metadata, f.get(op.value).get_prototype_of(cx)?);
    }
    SetPrototype(op, cx, f) {
        let entry = f.entry::<SetPrototype>(op.metadata);
        entry.set_slow(cx, f.code_block, &f.cell::<JsObject>(op.object), f.get(op.prototype));
    }
    GetHasInstance(op, cx, f) {
        let constructor = f.get(op.constructor);
        if !constructor.is_object() {
            return Err(cx.throw_type_error("Right hand side of instanceof is not an object"));
        }
        let cache = &f.entry::<GetById>(op.metadata).cache;
        let value = operations::get_by_id(cx, f.code_block, cache, constructor, symbols::hasInstance)?;
        f.set_profiled(op.dst, op.metadata, value);
    }
    InstanceofCustom(op, cx, f) {
        let (value, method) = (f.get(op.value), f.reg(op.has_instance));
        let constructor = f.get(op.constructor).cast::<JsObject>();
        let is_default = method == cx.function_prototype_has_instance().into()
            && constructor.inline_flags().contains(TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE);
        if !is_default {
            f.entry::<Flags>(op.metadata).0.set(1);
            f.set(op.dst, constructor.has_instance_with(cx, value, method)?);
        } else if !value.is_object() {
            f.set(op.dst, false);
        }
        Next::jump_if(!is_default || !value.is_object())
    }
    Instanceof(op, cx, f) {
        let (value, prototype) = (f.get(op.value), f.reg(op.prototype));
        f.set(op.dst, operations::instance_of(cx, f.code_block, f.entry(op.metadata), value, prototype)?);
    }
    GetInternalField(op, cx, f) {
        let base = f.get(op.base).cast::<JsCell>();
        // SAFETY: only built-ins have the instruction, and they have checked the type.
        let value = unsafe { internal_field(&base, op.index) }.get();
        f.entry::<bun_engine_vm::ValueProfile>(op.metadata).record_bits(Value::bits_of(value));
        f.set_or_empty(op.dst, value);
    }
    PutInternalField(op, cx, f) {
        let base = f.get(op.base).cast::<JsCell>();
        // SAFETY: as above.
        unsafe { internal_field(&base, op.index).set(&base, f.get_or_empty(op.value)) };
    }
}
