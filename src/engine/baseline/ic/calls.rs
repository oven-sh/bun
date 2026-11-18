//! The second step of an access.

use bun_engine_asm::RegOrImm;
use bun_engine_asm::prelude::*;
use bun_engine_bytecode::Specialization;
use bun_engine_text::{OFFSET_OF_SYMBOL_FLAGS, SymbolFlags};
use bun_engine_vm::caches::LoadEntry;
use bun_engine_vm::ic::{AccessCase, AccessKind, PrototypeLookup};
use bun_engine_vm::{
    Attributes, CallFrame, CellType, CustomGetterSetter, Executable, GetterSetter, GlobalObject,
    GlobalProxy, JsFunction, JsSymbol, NumberStrings, RealmSlot, Shape, Vm, call,
};

use super::abi::*;
use super::search::case;
use super::{Emitter, load_custom_function};
use crate::emit::{Emit, UNDEFINED, WORD, at, shape_id};
use crate::registers::*;

impl Emitter<'_> {
    pub(super) fn call_operation(&mut self) {
        let m = &mut *self.m;
        m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
        m.load_global(RESULT);
        m.move_arguments(&[RESULT, CODE_BLOCK, ENTRY, BASE, KEY, VALUE].map(Into::into));
        self.frames.enter(m);
        m.call_indirect(OPERATION);
        self.frames.leave(m);
        let throw = m.external_address(call::throw_from_frame());
        m.branch_if_zero64(RESULT, throw);
        m.ret();
    }

    /// `VALUE` is the receiver unless the case is a store.
    pub(super) fn call_case(&mut self, operation: Label) {
        self.m.branch_if_zero64(CASE, operation);
        self.m.load8(RESULT, case(AccessCase::OFFSET_OF_KIND));
        let [getter, setter, custom_getter, custom_setter] = self.labels();
        self.dispatch(
            RESULT,
            |_| operation,
            |e, kind| {
                match kind {
                    AccessKind::CallOwnGetter | AccessKind::CallOwnSetter => {
                        (e.m).load32_signed64(NAME, case(AccessCase::OFFSET_OF_POINTER));
                        e.m.slot_base(RESULT, BASE, NAME);
                        (e.m).load64(RESULT, Address::indexed(RESULT, NAME, Scale::One, 0));
                        e.m.jump(if kind == AccessKind::CallOwnGetter {
                            getter
                        } else {
                            setter
                        });
                    }
                    AccessKind::CallInheritedGetter => {
                        e.load_inherited(CASE, operation);
                        e.m.bind(getter);
                        e.call_accessor(false, operation);
                    }
                    AccessKind::CallInheritedSetter => {
                        e.load_inherited(CASE, operation);
                        e.m.bind(setter);
                        e.call_accessor(true, operation);
                    }
                    AccessKind::CallCustomAccessorGetter => {
                        e.load_holder_and_function(operation);
                        e.m.bind(custom_getter);
                        e.call_custom(&[VALUE, NAME]);
                    }
                    AccessKind::LoadKeptResult => {
                        e.load_holder_and_function(operation);
                        e.m.jump(custom_getter);
                    }
                    AccessKind::CallCustomValueGetter => {
                        e.load_holder_and_function(operation);
                        e.m.move64(VALUE, RESULT);
                        e.m.jump(custom_getter);
                    }
                    AccessKind::CallCustomAccessorSetter | AccessKind::CallCustomValueSetter => {
                        e.load_holder_and_function(operation);
                        e.m.jump(custom_setter);
                    }
                    AccessKind::CallCustomGetterInSlot => {
                        let (is_accessor, value) = (e.m.new_label(), AccessCase::IS_CUSTOM_VALUE);
                        let operand = case(AccessCase::OFFSET_OF_OPERAND);
                        (e.m).branch_test16(TestCond::Zero, operand, value.into(), is_accessor);
                        e.load_function_in_slot(CustomGetterSetter::OFFSET_OF_GETTER, operation);
                        e.m.move64(VALUE, BASE);
                        e.m.jump(custom_getter);
                        e.m.bind(is_accessor);
                        e.load_function_in_slot(CustomGetterSetter::OFFSET_OF_GETTER, operation);
                        e.m.jump(custom_getter);
                    }
                    AccessKind::CallCustomSetterInSlot => {
                        e.load_function_in_slot(CustomGetterSetter::OFFSET_OF_SETTER, operation);
                        e.m.bind(custom_setter);
                        e.call_custom(&[BASE, VALUE, NAME]);
                    }
                    AccessKind::CallMegamorphicAccessor => {
                        e.call_megamorphic_accessor(getter, custom_getter, operation);
                    }
                    AccessKind::ThroughGlobalProxy => {
                        e.call_accessor_of_global([getter, setter], operation);
                    }
                    AccessKind::ProxyGet | AccessKind::ProxySet | AccessKind::ProxyHas => {
                        e.call_proxy(kind, operation);
                    }
                    _ => return false,
                }
                true
            },
        );
    }

    /// With the `GetterSetter` in `RESULT`.
    fn call_accessor(&mut self, is_setter: bool, operation: Label) {
        if is_setter {
            self.m
                .load64(CASE, at(RESULT, GetterSetter::OFFSET_OF_SETTER));
            self.m.branch_if_zero64(CASE, operation);
            (self.m).branch_unless_type_in(CASE, CellType::FUNCTIONS, RESULT, operation);
            return self.tail_call(BASE, &[VALUE.into()]);
        }
        let none = self.m.new_label();
        self.m
            .load64(CASE, at(RESULT, GetterSetter::OFFSET_OF_GETTER));
        self.m.branch_if_zero64(CASE, none);
        (self.m).branch_unless_type_in(CASE, CellType::FUNCTIONS, RESULT, operation);
        self.tail_call(VALUE, &[]);
        self.m.bind(none);
        self.m.move32(RESULT, UNDEFINED);
        self.m.ret();
    }

    /// Of the function in `CASE`. The arguments are in none of `RESULT`, `NAME` and `SHAPE`.
    fn tail_call(&mut self, this: Gpr, arguments: &[RegOrImm]) {
        let (m, count) = (&mut *self.m, 1 + arguments.len());
        let words = (CallFrame::HEADER_WORDS + count).next_multiple_of(2);
        let room = words * WORD as usize - CallFrame::LINKAGE_SIZE;
        let has_return_address_on_stack = cfg!(target_arch = "x86_64");
        if has_return_address_on_stack {
            m.pop(SHAPE);
        }
        m.sub64(SP, SP, room);
        let header = |field: usize| at(SP, field - CallFrame::LINKAGE_SIZE);
        m.load64(EXECUTABLE, at(CASE, JsFunction::OFFSET_OF_EXECUTABLE));
        let code_block = Executable::offset_of_code_block(Specialization::Call);
        m.load64(RESULT, at(EXECUTABLE, code_block));
        m.store_pair64(header(CallFrame::OFFSET_OF_CODE_BLOCK), RESULT, CASE);
        m.store64(header(CallFrame::OFFSET_OF_ARGUMENT_COUNT), count);
        m.store64(header(CallFrame::OFFSET_OF_THIS), this);
        for (index, &argument) in arguments.iter().enumerate() {
            let offset = CallFrame::OFFSET_OF_ARGUMENTS + index * WORD as usize;
            m.store64(header(offset), argument);
        }
        if has_return_address_on_stack {
            m.push(SHAPE);
        }
        let entry = Executable::offset_of_entry(Specialization::Call);
        m.jump_indirect(at(EXECUTABLE, entry));
    }

    /// Into `RESULT` and `CASE`.
    fn load_holder_and_function(&mut self, operation: Label) {
        let [own, found] = self.labels();
        let m = &mut *self.m;
        m.load64(RESULT, case(AccessCase::OFFSET_OF_LOOKUP));
        m.branch_if_zero64(RESULT, own);
        m.load64(RESULT, at(RESULT, PrototypeLookup::OFFSET_OF_HOLDER));
        m.branch_if_not_zero64(RESULT, found);
        m.jump(operation);
        m.bind(own);
        m.move64(RESULT, BASE);
        m.bind(found);
        m.load64(CASE, case(AccessCase::OFFSET_OF_POINTER));
    }

    /// The same.
    fn load_function_in_slot(&mut self, which: usize, operation: Label) {
        (self.m).load32_signed64(CASE, case(AccessCase::OFFSET_OF_POINTER));
        self.m.slot_base(RESULT, BASE, CASE);
        (self.m).load64(CASE, Address::indexed(RESULT, CASE, Scale::One, 0));
        load_custom_function(self.m, CASE, which, operation);
        self.m.move64(RESULT, BASE);
    }

    /// The function in `CASE`, in the realm of the object in `RESULT`.
    fn call_custom(&mut self, arguments: &[Gpr]) {
        let m = &mut *self.m;
        m.load32(RESULT, shape_id(RESULT));
        m.decode_shape(RESULT, RESULT);
        m.load64(RESULT, at(RESULT, Shape::OFFSET_OF_GLOBAL));
        m.load_global(KEY);
        m.select_test64(TestCond::Zero, RESULT, RESULT, -1, KEY, RESULT);
        m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
        m.move64(OPERATION, CASE);
        let arguments = core::iter::once(&RESULT).chain(arguments);
        m.move_arguments(&arguments.map(|&it| it.into()).collect::<Vec<_>>());
        self.frames.enter(m);
        m.call_indirect(OPERATION);
        self.frames.leave(m);
        let (throw, done) = (m.external_address(call::throw_from_frame()), m.new_label());
        m.branch_if_not_zero64(at(VM, Vm::OFFSET_OF_EXCEPTION), throw);
        m.branch_if_not_zero64(RESULT, done);
        m.move32(RESULT, UNDEFINED);
        m.bind(done);
        m.ret();
    }

    /// The first step has checked the shape of the target.
    fn call_accessor_of_global(&mut self, [getter, setter]: [Label; 2], operation: Label) {
        self.m.load8(RESULT, case(AccessCase::OFFSET_OF_OPERAND));
        for (kind, call) in [
            (AccessKind::CallOwnGetter, getter),
            (AccessKind::CallOwnSetter, setter),
        ] {
            let other = self.m.new_label();
            self.m.branch32(Cond::Ne, RESULT, kind as i32, other);
            (self.m).load32_signed64(NAME, case(AccessCase::OFFSET_OF_POINTER));
            (self.m).load64(CASE, at(BASE, GlobalProxy::OFFSET_OF_TARGET));
            self.m.slot_base(RESULT, CASE, NAME);
            (self.m).load64(RESULT, Address::indexed(RESULT, NAME, Scale::One, 0));
            self.m.jump(call);
            self.m.bind(other);
        }
        self.m.jump(operation);
    }

    fn call_megamorphic_accessor(&mut self, getter: Label, custom_getter: Label, operation: Label) {
        let [custom, value] = self.labels();
        let load_accessor = |m: &mut MacroAssembler, dst: Gpr, offset: Gpr| {
            m.load32_signed64(offset, case(LoadEntry::OFFSET_OF_BYTE_OFFSET));
            m.load64(CASE, case(LoadEntry::OFFSET_OF_HOLDER));
            m.select_test64(TestCond::Zero, CASE, CASE, -1, BASE, CASE);
            m.slot_base(dst, CASE, offset);
            m.load64(
                dst,
                Address::indexed(dst, offset, Scale::One, -LoadEntry::IS_SPECIAL),
            );
        };
        let (m, kind) = (&mut *self.m, case(LoadEntry::OFFSET_OF_ACCESSOR_KIND));
        m.branch8(Cond::Ne, kind, Attributes::ACCESSOR.bits() as i32, custom);
        load_accessor(m, RESULT, NAME);
        m.branch_if_type(RESULT, CellType::GetterSetter, getter);
        m.jump(operation);
        m.bind(custom);
        m.branch64(Cond::Ne, VALUE, BASE, operation);
        m.branch8(
            Cond::Eq,
            kind,
            Attributes::CUSTOM_VALUE.bits() as i32,
            value,
        );
        for is_value in [false, true] {
            if is_value {
                m.bind(value);
            }
            load_accessor(m, RESULT, VALUE);
            m.move64(VALUE, BASE);
            m.branch_if_not_cell(RESULT, operation);
            m.branch_if_not_type(RESULT, CellType::CustomGetterSetter, operation);
            // Another object of the shape can have had another accessor.
            let inherited = m.new_label();
            m.branch64(Cond::Ne, CASE, BASE, inherited);
            let class = at(RESULT, CustomGetterSetter::OFFSET_OF_REQUIRED_CLASS);
            m.branch_if_not_zero64(class, operation);
            m.bind(inherited);
            m.load64(RESULT, at(RESULT, CustomGetterSetter::OFFSET_OF_GETTER));
            m.branch_if_zero64(RESULT, operation);
            if is_value {
                m.move64(VALUE, CASE);
            }
            m.swap(RESULT, CASE);
            m.jump(custom_getter);
        }
    }

    fn call_proxy(&mut self, kind: AccessKind, operation: Label) {
        let [has_key, number] = self.labels();
        let m = &mut *self.m;
        m.load64(NAME, case(AccessCase::OFFSET_OF_POINTER));
        m.branch_if_not_zero64(NAME, has_key);
        m.move64(NAME, KEY);
        m.branch_if_not_cell(NAME, number);
        m.branch_if_type(NAME, CellType::String, has_key);
        m.branch_if_not_type(NAME, CellType::Symbol, operation);
        m.load64(RESULT, at(NAME, JsSymbol::OFFSET_OF_NAME));
        let flags = at(RESULT, OFFSET_OF_SYMBOL_FLAGS);
        m.branch_test32(TestCond::Zero, flags, SymbolFlags::PRIVATE, has_key);
        m.jump(operation);
        m.bind(number);
        m.sub64(NAME, NAME, NUMBER_TAG);
        m.branch64(Cond::AboveEq, NAME, NumberStrings::SMALL_COUNT, operation);
        let strings = Vm::OFFSET_OF_NUMBER_STRINGS + NumberStrings::OFFSET_OF_SMALL;
        m.load64(
            NAME,
            Address::indexed(VM, NAME, Scale::Eight, strings as i32),
        );
        m.branch_if_zero64(NAME, operation);
        m.bind(has_key);
        m.load16(RESULT, case(AccessCase::OFFSET_OF_OPERAND));
        let slot = match kind {
            AccessKind::ProxyGet => RealmSlot::private_proxy_get,
            AccessKind::ProxySet => RealmSlot::private_proxy_set,
            _ => RealmSlot::private_proxy_has,
        };
        m.load_global(CASE);
        m.load64(CASE, at(CASE, GlobalObject::offset_of_slot(slot)));
        m.move64(KEY, NAME);
        match kind {
            AccessKind::ProxyGet => self.tail_call(BASE, &[KEY.into(), VALUE.into()]),
            AccessKind::ProxySet => {
                m.box_boolean(ENTRY, RESULT);
                self.tail_call(BASE, &[KEY.into(), BASE.into(), VALUE.into(), ENTRY.into()]);
            }
            _ => self.tail_call(BASE, &[KEY.into()]),
        }
    }
}
