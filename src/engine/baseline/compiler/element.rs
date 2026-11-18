//! Properties whose key is a value.

use core::mem::offset_of;

use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{Operand, op};
use bun_engine_vm::code::metadata::{ArrayAccess, GetByVal};
use bun_engine_vm::ic::{AccessCases, CaseList, InlineLoad, KeyedCase};
use bun_engine_vm::{ArrayModes, ArrayProfile, CodeBlock};

use super::{Cold, Compiler, metadata};
use crate::emit::{at, shape_id};
use crate::ic::abi::{BASE, KEY, VALUE};
use crate::ic::{Absent, Elements, has_element, load_element, store_element};
use crate::registers::*;

impl Compiler<'_> {
    fn check_index(&mut self, is_int32: bool, other: Label) {
        self.m.branch_if_not_cell(BASE, other);
        if !is_int32 {
            self.m.branch_if_not_int32(KEY, other);
        }
        self.m.sign_extend32_to_64(T3, KEY);
    }

    /// It is a surprise once there is a better choice than `kind`.
    fn cold_access_to(&mut self, kind: Elements, writes: bool, done: Label) -> Label {
        fn count_and_access<const BETTER: u32>(c: &mut Compiler<'_>, cold: &Cold) {
            const WEIGHT: i32 = 2;
            let (modes, access, enough) = (c.modes_of_access(), c.m.new_label(), c.m.new_label());
            let counter = at(CODE_BLOCK, CodeBlock::OFFSET_OF_SURPRISE_COUNTER);
            (c.m).branch_test32(TestCond::Zero, modes, BETTER, access);
            (c.m).branch_add32_to_memory(ResultCond::NonNegative, counter, WEIGHT, enough);
            c.m.bind(access);
            c.both_steps(cold);
            c.m.bind(enough);
            c.m.move32(ARGUMENTS[2], cold.offset);
            c.m.jump_address(c.thunks.leave);
        }
        const INT32: u32 = ArrayModes::INT32.bits();
        const DOUBLE: u32 = ArrayModes::DOUBLE.bits();
        const CONTIGUOUS: u32 = ArrayModes::CONTIGUOUS.bits();
        let emit = match kind {
            _ if !self.is_provisional => return self.cold_access(done),
            Elements::Int32 if writes => count_and_access::<{ DOUBLE | CONTIGUOUS }>,
            Elements::Int32 => count_and_access::<DOUBLE>,
            Elements::Double => count_and_access::<CONTIGUOUS>,
            Elements::Contiguous if writes => count_and_access::<INT32>,
            _ => return self.cold_access(done),
        };
        self.cold_alone(done, emit)
    }

    pub(super) fn record_shape(&mut self, profile: Address) {
        if self.records {
            self.m.load32(T4, shape_id(BASE));
            (self.m).store32(profile.plus(ArrayProfile::OFFSET_OF_LAST_SHAPE as i32), T4);
        }
    }

    /// Goes on if the site has a case for the key, with the id of the shape in `T0`. Returns where it is.
    fn find_keyed_case(&mut self, cases: Address, other: Label) -> Address {
        let keyed = |field: usize| at(T5, CaseList::OFFSET_OF_KEYED + field);
        self.m.load64(T5, cases);
        (self.m).branch64(Cond::Lt, T5, AccessCases::FIRST_ADDRESS as i32, other);
        (self.m).branch64(Cond::Ne, KEY, keyed(KeyedCase::OFFSET_OF_KEY), other);
        self.load_shape_of_base(other);
        keyed(KeyedCase::OFFSET_OF_CASE)
    }

    fn load_keyed_case(&mut self, kind: InlineLoad, cases: Address, found: Label) {
        let other = self.cold_access(found);
        let case = self.find_keyed_case(cases, other);
        self.load_inline_case(kind, case, other);
    }

    /// With the operands in their registers. The caller binds `found` next.
    pub(super) fn read_by_value(
        &mut self,
        read: fn(&mut MacroAssembler, Elements, Label, Absent),
        (modes, profile): (ArrayModes, Address),
        is_int32: bool,
        found: Label,
    ) {
        let Some(kind) = Elements::likely(&self.m, modes) else {
            return self.call_access(found);
        };
        let other = self.cold_access_to(kind, false, found);
        self.check_index(is_int32, other);
        read(&mut self.m, kind, other, Absent::both(other));
        self.record_shape(profile);
    }

    pub(super) fn write_by_value(
        &mut self,
        (modes, profile): (ArrayModes, Address),
        is_int32: bool,
        value: Operand,
    ) {
        let end = self.end();
        let kind = match Elements::likely(&self.m, modes) {
            None | Some(Elements::String | Elements::ScopedArguments) => {
                return self.call_access(end);
            }
            Some(kind) => kind,
        };
        let other = self.cold_access_to(kind, true, end);
        self.check_index(is_int32, other);
        let modes = profile.plus(ArrayProfile::OFFSET_OF_MODES as i32);
        store_element(&mut self.m, kind, modes, other, Absent::both(other), other);
        self.record_shape(profile);
        if let Elements::Contiguous | Elements::Values | Elements::DirectArguments = kind {
            self.barrier_for(value, VALUE);
        }
    }

    pub(super) fn get_by_val(&mut self, op: op::GetByVal) {
        let found = self.m.new_label();
        self.load(BASE, op.base);
        self.load(KEY, op.key);
        let profile = metadata(op.metadata, offset_of!(GetByVal, access.array));
        let seen = (self.profiles.get_by_val(op.metadata), profile);
        match self.profiles.keyed_load(op.metadata) {
            Some(kind) if seen.0.is_empty() => {
                let cases = metadata(op.metadata, offset_of!(GetByVal, access.cases));
                self.load_keyed_case(kind, cases, found);
            }
            _ => {
                let is_int32 = self.int32_constant(op.key).is_some();
                self.read_by_value(load_element, seen, is_int32, found);
            }
        }
        self.m.bind(found);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn get_by_val_with_this(&mut self, op: op::GetByValWithThis) {
        let found = self.m.new_label();
        self.load(BASE, op.base);
        self.load(KEY, op.key);
        self.load(VALUE, op.this);
        self.call_access(found);
        self.m.bind(found);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn put_by_val(
        &mut self,
        [base, key, value]: [Operand; 3],
        word: u32,
        is_direct: bool,
    ) {
        self.load(BASE, base);
        self.load(KEY, key);
        self.load(VALUE, value);
        let mut modes = self.profiles.array_access(word);
        if let Some(kind) = self
            .profiles
            .keyed_access(word)
            .filter(|_| modes.is_empty())
        {
            let end = self.end();
            let other = self.cold_access(end);
            let case = self.find_keyed_case(metadata(word, offset_of!(ArrayAccess, cases)), other);
            return self.store_inline_case(kind, case, Some(value), other);
        }
        if is_direct {
            modes -= ArrayModes::TYPED_ARRAYS | ArrayModes::DIRECT_ARGUMENTS;
        }
        let profile = metadata(word, offset_of!(ArrayAccess, array));
        self.write_by_value((modes, profile), self.int32_constant(key).is_some(), value);
    }

    pub(super) fn in_by_val(&mut self, op: op::InByVal) {
        let found = self.m.new_label();
        self.load(BASE, op.base);
        self.load(KEY, op.key);
        let modes = self.profiles.array_access(op.metadata) - ArrayModes::STRING;
        let profile = metadata(op.metadata, offset_of!(ArrayAccess, array));
        match self.profiles.keyed_access(op.metadata) {
            Some(kind) if modes.is_empty() => {
                let cases = metadata(op.metadata, offset_of!(ArrayAccess, cases));
                self.load_keyed_case(kind, cases, found);
            }
            _ => {
                let is_int32 = self.int32_constant(op.key).is_some();
                self.read_by_value(has_element, (modes, profile), is_int32, found);
            }
        }
        self.m.bind(found);
        self.store_result(op.dst);
        self.carries_boolean = true;
    }
}
