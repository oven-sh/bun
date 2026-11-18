//! Properties that the instruction names.

use core::mem::offset_of;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Argument, Sign};
use bun_engine_bytecode::{Operand, Register, Specialization, op};
use bun_engine_vm::code::metadata::{
    GetById, GetLength, GetPrivateName, PutPrivateName, SetPrototype,
};
use bun_engine_vm::ic::{
    InlineCase, InlineKind, InlineLoad, InlineStore, LoadCache, LookupEpoch, StoreCache,
};
use bun_engine_vm::{
    ArrayModes, ArrayProfile, CallFrame, CellType, CustomGetterSetter, GetterSetter, GlobalObject,
    JsArrayBufferView, JsFunction, JsObject, JsSymbol, OFFSET_OF_INTERNAL_FIELDS, RealmSlot, Shape,
    TypeFlags, Vm, call,
};

use super::call::{ENTRY, frame_words, new_frame};
use super::{Compiler, metadata};
use crate::emit::{Emit, FALSE, UNDEFINED, WORD, at, shape_id, storage};
use crate::ic::abi::{BASE, KEY, OPERATION, VALUE};
use crate::ic::{load_array_length, load_custom_function, load_first_answer};
use crate::registers::*;

const LOAD_CACHE: usize = offset_of!(GetById, cache);
const _: () = assert!(LOAD_CACHE == offset_of!(GetLength, cache));
const _: () = assert!(LOAD_CACHE == offset_of!(GetPrivateName, cache));
const INLINE_LOAD: usize = LOAD_CACHE + LoadCache::OFFSET_OF_INLINE;
const INLINE_PRIVATE_STORE: usize =
    offset_of!(PutPrivateName, cache) + StoreCache::OFFSET_OF_INLINE;

impl Compiler<'_> {
    /// With the id of the shape in `T0`. Goes on if the inline case is for it, is of that kind and holds.
    fn check_inline_case(&mut self, kind: impl InlineKind, key: Address, other: Label) {
        if kind.is_checked() {
            let epoch = Vm::OFFSET_OF_LOOKUP_EPOCH + LookupEpoch::offset_of_key(kind);
            self.m.xor64(T0, T0, at(VM, epoch));
            return self.m.branch64(Cond::Ne, T0, key, other);
        }
        if kind.tag() != 0 {
            self.m.xor32(T0, T0, kind.tag());
        }
        self.m.branch32(Cond::Ne, T0, key, other);
    }

    /// Into `T0`.
    fn load_slot(&mut self, byte_offset: Address) {
        self.m.load32_signed64(T0, byte_offset);
        self.m.slot_base(T3, BASE, T0);
        self.m.load64(T0, Address::indexed(T3, T0, Scale::One, 0));
    }

    /// Into `T0`, from the `GetterSetter` in a slot of the object.
    fn load_own_accessor(&mut self, byte_offset: Address, which: usize, other: Label) {
        self.load_slot(byte_offset);
        self.m.load64(T0, at(T0, which));
        self.m.branch_if_zero64(T0, other);
        (self.m).branch_unless_type_in(T0, CellType::FUNCTIONS, T3, other);
    }

    /// The function in `T0`, in a frame below this one.
    fn call_accessor(&mut self, argument: Option<Gpr>) {
        let count = 1 + u32::from(argument.is_some());
        let frame = self.body.locals() + frame_words(count);
        (self.m).compute_address(SP, new_frame(frame, CallFrame::LINKAGE_SIZE));
        (self.m).load64(EXECUTABLE, at(T0, JsFunction::OFFSET_OF_EXECUTABLE));
        self.fill_header(frame, count, Specialization::Call);
        if let Some(argument) = argument {
            (self.m).store64(new_frame(frame, CallFrame::OFFSET_OF_ARGUMENTS), argument);
        }
        self.m.call_indirect(ENTRY);
        self.return_point();
    }

    fn name_argument(&self) -> Argument {
        match self.name_of_access() {
            Some(name) => name.into(),
            None => Argument::Load64(at(KEY, JsSymbol::OFFSET_OF_NAME)),
        }
    }

    /// The function in `T0`.
    pub(super) fn call_custom_accessor(&mut self, name: Argument, argument: Option<Gpr>) {
        self.m.move64(OPERATION, T0);
        match argument {
            Some(argument) => self.prepare_operation(&[BASE.into(), argument.into(), name]),
            None => self.prepare_operation(&[BASE.into(), name]),
        }
        self.m.call_indirect(OPERATION);
        let throw = self.m.external_address(call::throw_from_frame());
        (self.m).branch_if_not_zero64(at(VM, Vm::OFFSET_OF_EXCEPTION), throw);
        if argument.is_none() {
            self.m.move32(T1, UNDEFINED);
            self.m.select_test64(TestCond::Zero, T0, T0, -1, T1, T0);
        }
    }

    /// `check_inline_case`, followed by the load.
    pub(super) fn load_inline_case(&mut self, kind: InlineLoad, case: Address, other: Label) {
        let field = |offset: usize| case.plus(offset as i32);
        let byte_offset = field(InlineCase::OFFSET_OF_LOADED_SLOT);
        let constant = field(InlineCase::OFFSET_OF_OPERAND);
        self.check_inline_case(kind, field(InlineCase::OFFSET_OF_KEY), other);
        match kind {
            InlineLoad::InObject => {
                self.m.load32_signed64(T0, byte_offset);
                (self.m).load64(T0, Address::indexed(BASE, T0, Scale::One, 0));
            }
            InlineLoad::InStorage => {
                self.m.load32_signed64(T0, byte_offset);
                self.m.load64(T3, storage(BASE));
                self.m.load64(T0, Address::indexed(T3, T0, Scale::One, 0));
            }
            InlineLoad::OwnGetter => {
                self.load_own_accessor(byte_offset, GetterSetter::OFFSET_OF_GETTER, other);
                self.call_accessor(None);
            }
            InlineLoad::Constant => self.m.load64(T0, constant),
            InlineLoad::TypedArrayLength => {
                (self.m).load64(T0, at(BASE, JsArrayBufferView::OFFSET_OF_LENGTH));
                self.m.branch64(Cond::Above, T0, i32::MAX, other);
                self.m.box_int32(T0, T0);
            }
            InlineLoad::Getter => {
                self.m.load64(T0, constant);
                self.call_accessor(None);
            }
            InlineLoad::CustomGetter => {
                self.m.load64(T0, constant);
                self.call_custom_accessor(self.name_argument(), None);
            }
            InlineLoad::CustomGetterInSlot => {
                self.load_slot(byte_offset);
                load_custom_function(&mut self.m, T0, CustomGetterSetter::OFFSET_OF_GETTER, other);
                self.call_custom_accessor(self.name_argument(), None);
            }
            InlineLoad::InheritedInObject => {
                self.m.load64(T0, constant);
                self.m.load64(T0, at(T0, 0));
            }
            InlineLoad::InheritedInStorage => {
                let shift = InlineLoad::OFFSET_SHIFT as u8;
                self.m.load64(T0, constant);
                self.m.sar64(T3, T0, shift);
                (self.m).extract_bits(Sign::Unsigned, Width::W64, T0, T0, 0, shift);
                self.m.load64(T0, storage(T0));
                self.m.load64(T0, Address::indexed(T0, T3, Scale::Eight, 0));
            }
        }
    }

    /// The same for a store, with the barrier. `value` is where `VALUE` comes from, unless it is no cell.
    pub(super) fn store_inline_case(
        &mut self,
        kind: InlineStore,
        case: Address,
        value: Option<Operand>,
        other: Label,
    ) {
        let field = |offset: usize| case.plus(offset as i32);
        let byte_offset = field(InlineCase::OFFSET_OF_STORED_SLOT);
        self.check_inline_case(kind, field(InlineCase::OFFSET_OF_KEY), other);
        match kind {
            InlineStore::InObject | InlineStore::AddInObject => {
                self.m.load32_signed64(T0, byte_offset);
                (self.m).store64(Address::indexed(BASE, T0, Scale::One, 0), VALUE);
            }
            InlineStore::InStorage | InlineStore::AddInStorage => {
                self.m.load32_signed64(T0, byte_offset);
                self.m.load64(T3, storage(BASE));
                (self.m).store64(Address::indexed(T3, T0, Scale::One, 0), VALUE);
            }
            InlineStore::OwnSetter => {
                self.load_own_accessor(byte_offset, GetterSetter::OFFSET_OF_SETTER, other);
                return self.call_accessor(Some(VALUE));
            }
            InlineStore::Setter => {
                self.m.load64(T0, field(InlineCase::OFFSET_OF_OPERAND));
                return self.call_accessor(Some(VALUE));
            }
            InlineStore::CustomSetter => {
                self.m.load64(T0, field(InlineCase::OFFSET_OF_OPERAND));
                return self.call_custom_accessor(self.name_argument(), Some(VALUE));
            }
            InlineStore::CustomSetterInSlot => {
                self.load_slot(byte_offset);
                load_custom_function(&mut self.m, T0, CustomGetterSetter::OFFSET_OF_SETTER, other);
                return self.call_custom_accessor(self.name_argument(), Some(VALUE));
            }
        }
        if kind.is_checked() {
            self.m.load32(T0, field(InlineCase::OFFSET_OF_NEW_SHAPE));
            self.m.store32(shape_id(BASE), T0);
            self.barrier();
        } else if let Some(value) = value {
            self.barrier_for(value, VALUE);
        }
    }

    pub(super) fn load_shape_of_base(&mut self, otherwise: Label) {
        self.m.branch_if_not_cell(BASE, otherwise);
        self.m.load32(T0, shape_id(BASE));
    }

    pub(super) fn get_by_id(&mut self, dst: Register, base: Operand, word: u32) {
        let found = self.m.new_label();
        self.load(BASE, base);
        match self.profiles.get_by_id(word) {
            Some(kind) => {
                let other = self.cold_access(found);
                self.load_shape_of_base(other);
                self.load_inline_case(kind, metadata(word, INLINE_LOAD), other);
            }
            None => self.call_access(found),
        }
        self.m.bind(found);
        self.store_profiled_result(dst, word);
    }

    pub(super) fn get_has_instance(&mut self, op: op::GetHasInstance) {
        self.slow_unless_object(op.constructor);
        self.incoming = op.constructor.as_register();
        let uses_incoming = self.uses_incoming;
        self.get_by_id(op.dst, op.constructor, op.metadata);
        self.uses_incoming = uses_incoming;
    }

    pub(super) fn get_length(&mut self, op: op::GetLength) {
        let (modes, inline) = self.profiles.get_length(op.metadata);
        let (found, slow) = (self.m.new_label(), self.slow());
        self.load(BASE, op.base);
        self.load_shape_of_base(slow);
        if self.records {
            let last_shape = offset_of!(GetLength, array) + ArrayProfile::OFFSET_OF_LAST_SHAPE;
            self.m.store32(metadata(op.metadata, last_shape), T0);
        }
        if modes.contains(ArrayModes::ARRAY) {
            let other = self.cold_access(found);
            load_array_length(&mut self.m, other);
            self.m.box_int32(T0, T0);
        } else if modes.contains(ArrayModes::STRING) {
            let other = self.cold_access(found);
            self.m.branch_if_not_type(BASE, CellType::String, other);
            self.m.load_string_length(T0, BASE);
            self.m.box_int32(T0, T0);
        } else if let Some(kind) = inline {
            let other = self.cold_access(found);
            self.load_inline_case(kind, metadata(op.metadata, INLINE_LOAD), other);
        } else {
            self.call_access(found);
        }
        self.m.bind(found);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn get_by_id_with_this(&mut self, op: op::GetByIdWithThis) {
        let found = self.m.new_label();
        self.load(BASE, op.base);
        self.load(VALUE, op.this);
        self.call_access(found);
        self.m.bind(found);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn put_by_id(&mut self, op: op::PutById) {
        let end = self.end();
        self.load(VALUE, op.value);
        self.load(BASE, op.base);
        let Some(kind) = self.profiles.put_by_id(op.metadata) else {
            return self.call_access(end);
        };
        let other = self.cold_access(end);
        self.load_shape_of_base(other);
        let case = metadata(op.metadata, StoreCache::OFFSET_OF_INLINE);
        self.store_inline_case(kind, case, Some(op.value), other);
    }

    pub(super) fn in_by_id(&mut self, op: op::InById) {
        if !self.profiles.has_first_answer(op.metadata) {
            return self.query(op.dst, op.base, None);
        }
        let found = self.m.new_label();
        let other = self.cold_access(found);
        self.load(BASE, op.base);
        self.load_shape_of_base(other);
        load_first_answer(&mut self.m, metadata(op.metadata, 0), other);
        self.m.bind(found);
        self.store_result(op.dst);
        self.carries_boolean = true;
    }

    /// `in`, `delete` and `instanceof`.
    pub(super) fn query(&mut self, dst: Register, base: Operand, key: Option<Operand>) {
        let found = self.m.new_label();
        self.load(BASE, base);
        if let Some(key) = key {
            self.load(KEY, key);
        }
        self.call_access(found);
        self.m.bind(found);
        self.store_result(dst);
        self.carries_boolean = true;
    }

    pub(super) fn get_prototype_of(&mut self, op: op::GetPrototypeOf) {
        self.slow_unless_object(op.value);
        let slow = self.slow();
        (self.m).branch_if_flag(T0, TypeFlags::OVERRIDES_GET_PROTOTYPE, slow);
        self.m.load32(T0, shape_id(T0));
        self.m.decode_shape(T0, T0);
        self.m.load64(T0, at(T0, Shape::OFFSET_OF_PROTOTYPE));
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn set_prototype(&mut self, op: op::SetPrototype) {
        let (slow, entry) = (self.slow(), |field: usize| metadata(op.metadata, field));
        self.load(VALUE, op.prototype);
        self.load(BASE, op.object);
        self.m.load32(T0, shape_id(BASE));
        (self.m).branch32(Cond::Ne, T0, entry(offset_of!(SetPrototype, from)), slow);
        self.m.load32(T0, entry(offset_of!(SetPrototype, to)));
        self.m.decode_shape(T2, T0);
        (self.m).branch64(Cond::Ne, VALUE, at(T2, Shape::OFFSET_OF_PROTOTYPE), slow);
        self.m.store32(shape_id(BASE), T0);
        self.barrier();
    }

    pub(super) fn instanceof_custom(&mut self, op: op::InstanceofCustom) {
        let (slow, done) = (self.slow(), self.target(op.done));
        self.load_both(op.has_instance.into(), op.constructor);
        self.m.load_global(T2);
        let default = GlobalObject::offset_of_slot(RealmSlot::function_prototype_has_instance);
        self.m.branch64(Cond::Ne, T0, at(T2, default), slow);
        (self.m).branch_unless_flag(T1, TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE, slow);
        let (primitive, end) = (self.m.new_label(), self.end());
        self.load(T0, op.value);
        self.m.branch_if_not_cell(T0, primitive);
        self.m.branch_if_cell_is_object(T0, end);
        self.m.bind(primitive);
        self.store(op.dst, FALSE);
        self.m.jump(done);
    }

    pub(super) fn instanceof(&mut self, op: op::Instanceof) {
        self.slow_unless_object(op.value);
        self.incoming = op.value.as_register();
        let uses_incoming = self.uses_incoming;
        self.query(op.dst, op.value, Some(op.prototype.into()));
        self.uses_incoming = uses_incoming;
    }

    pub(super) fn get_internal_field(&mut self, op: op::GetInternalField) {
        self.load(T0, op.base);
        let offset = OFFSET_OF_INTERNAL_FIELDS + op.index as usize * WORD as usize;
        self.m.load64(T0, at(T0, offset));
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn put_internal_field(&mut self, op: op::PutInternalField) {
        let offset = OFFSET_OF_INTERNAL_FIELDS + op.index as usize * WORD as usize;
        self.store_in_cell(op.base, offset, op.value);
    }

    pub(super) fn has_shape_with_flags(&mut self, op: op::HasShapeWithFlags) {
        self.load(T0, op.object);
        self.m.load32(T0, shape_id(T0));
        self.m.decode_shape(T0, T0);
        (self.m).test32(
            TestCond::NonZero,
            T0,
            at(T0, Shape::OFFSET_OF_FLAGS),
            op.flags,
        );
        self.store_boolean_result(op.dst);
    }

    // Private names

    /// Goes on, with the id of the shape in `T0`, if the inline case is for the symbol.
    fn check_private_name(&mut self, name: Address, other: Label) {
        self.load_shape_of_base(other);
        self.m.branch64(Cond::Ne, KEY, name, other);
    }

    pub(super) fn get_private_name(&mut self, op: op::GetPrivateName) {
        let found = self.m.new_label();
        self.load(KEY, op.name);
        self.load(BASE, op.base);
        match self.profiles.get_private_name(op.metadata) {
            Some(kind) => {
                let other = self.cold_access(found);
                let name = metadata(op.metadata, offset_of!(GetPrivateName, name));
                self.check_private_name(name, other);
                self.load_inline_case(kind, metadata(op.metadata, INLINE_LOAD), other);
            }
            None => self.call_access(found),
        }
        self.m.bind(found);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn check_private_brand(&mut self, op: op::CheckPrivateBrand) {
        let end = self.end();
        let other = self.cold_access(end);
        self.load(KEY, op.brand);
        self.load(BASE, op.base);
        let name = metadata(op.metadata, offset_of!(PutPrivateName, name));
        self.check_private_name(name, other);
        let key = INLINE_PRIVATE_STORE + InlineCase::OFFSET_OF_KEY;
        self.check_inline_case(InlineStore::InObject, metadata(op.metadata, key), other);
    }

    /// Without a value it sets a brand.
    pub(super) fn put_private_name(
        &mut self,
        base: Operand,
        symbol: Register,
        value: Option<Operand>,
        word: u32,
        usual: InlineStore,
    ) {
        match value {
            Some(value) => self.load(VALUE, value),
            None => (self.m).move64(VALUE, JsObject::PRIVATE_BRAND_VALUE.to_bits()),
        }
        self.load(KEY, symbol);
        self.load(BASE, base);
        let end = self.end();
        let other = self.cold_access(end);
        self.check_private_name(metadata(word, offset_of!(PutPrivateName, name)), other);
        let kind = self.profiles.put_private_name(word).unwrap_or(usual);
        self.store_inline_case(kind, metadata(word, INLINE_PRIVATE_STORE), value, other);
    }
}
