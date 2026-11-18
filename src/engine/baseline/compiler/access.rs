//! How a template gets to the cases of its site.

use core::mem::offset_of;

use bun_engine_asm::Argument;
use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{IdentifierIndex, Instruction as I, PutFlags};
use bun_engine_text::{names, symbols};
use bun_engine_vm::code::metadata::{
    ArrayAccess, CasesAndValue, ForIn, ForInGet, GetById, GetByVal, GetLength,
};
use bun_engine_vm::{ArrayModes, ArrayProfile, CodeBlock, Vm, call};

use smallvec::SmallVec;

use super::{Cold, Compiler, metadata};
use crate::emit::at;
use crate::ic::Steps;
use crate::ic::abi::{ENTRY, KEY, RESULT};
use crate::registers::*;

struct Access {
    steps: Steps<usize>,
    start: Address,
    /// The address, if it is a part of the instruction.
    name: Option<usize>,
    is_name_for_second_step_only: bool,
    may_call_accessor: bool,
}

impl Compiler<'_> {
    pub(super) fn name_address(&self, name: IdentifierIndex) -> usize {
        self.code.identifiers[name.index()].name().address()
    }

    fn access(&self) -> Access {
        let (entries, word) = (&self.thunks.entries, self.raw(self.offset).metadata);
        let load = |steps, cache, name| Access {
            steps,
            start: metadata(word, cache),
            name: Some(name),
            is_name_for_second_step_only: true,
            may_call_accessor: true,
        };
        let other = |steps, name: Option<IdentifierIndex>, may_call_accessor| Access {
            steps,
            start: metadata(word, 0),
            name: name.map(|it| self.name_address(it)),
            is_name_for_second_step_only: false,
            may_call_accessor,
        };
        let by_value = |steps, access| Access {
            start: metadata(word, access),
            ..other(steps, None, true)
        };
        let [load_element, store_element, define_element, has_element] = entries.by_index;
        let by_element = |steps: Steps<usize>, first, modes: ArrayModes| Steps {
            first: if modes.is_empty() { steps.first } else { first },
            ..steps
        };
        let [load_megamorphic, store_megamorphic, define_megamorphic] = entries.megamorphic;
        let by_id = |steps: Steps<usize>, megamorphic| Steps {
            first: if self.profiles.is_megamorphic_store(word) {
                megamorphic
            } else {
                steps.first
            },
            ..steps
        };
        let by_mode = |is_strict, strict, sloppy| if is_strict { strict } else { sloppy };
        let cache = offset_of!(GetById, cache);
        match self.instruction(self.offset) {
            I::GetById(op) => {
                let first = (self.profiles.first_load(word))
                    .and_then(|kind| entries.load_first_case[kind as usize])
                    .or_else(|| {
                        (self.profiles.is_megamorphic_load(word)).then_some(load_megamorphic)
                    })
                    .unwrap_or(entries.get_by_id.first);
                let steps = Steps {
                    first,
                    ..entries.get_by_id
                };
                load(steps, cache, self.name_address(op.name))
            }
            I::GetByIdDirect(op) => {
                load(entries.get_by_id_direct, cache, self.name_address(op.name))
            }
            I::GetHasInstance(_) => load(entries.get_by_id, cache, symbols::hasInstance.address()),
            I::GetLength(_) => {
                let cache = offset_of!(GetLength, cache);
                load(entries.get_length, cache, names::length.address())
            }
            I::GetByIdWithThis(op) => Access {
                start: metadata(word, offset_of!(CasesAndValue, cases)),
                ..other(entries.get_by_id_with_this, Some(op.name), true)
            },
            I::GetByVal(_) => {
                let modes = self.profiles.get_by_val(word);
                let steps = by_element(entries.get_by_val, load_element, modes);
                by_value(steps, offset_of!(GetByVal, access))
            }
            I::GetByValWithThis(_) => {
                by_value(entries.get_by_val_with_this, offset_of!(GetByVal, access))
            }
            I::ForInGet(_) => by_value(entries.get_by_val, offset_of!(ForInGet, for_in.access)),
            I::ForInPut(op) => {
                let steps = by_mode(op.strict, entries.put_by_val_strict, entries.put_by_val);
                by_value(steps, offset_of!(ForIn, access))
            }
            I::ForInHas(_) => by_value(entries.in_by_val, offset_of!(ForIn, access)),
            I::PutById(op) if op.flags.contains(PutFlags::DIRECT) => {
                let steps = by_id(entries.put_by_id_direct, define_megamorphic);
                other(steps, Some(op.name), false)
            }
            I::PutById(op) => {
                let is_strict = op.flags.contains(PutFlags::STRICT);
                let steps = by_mode(is_strict, entries.put_by_id_strict, entries.put_by_id);
                other(by_id(steps, store_megamorphic), Some(op.name), true)
            }
            I::PutByVal(op) => {
                let steps = by_mode(op.strict, entries.put_by_val_strict, entries.put_by_val);
                let modes = self.profiles.array_access(word);
                other(by_element(steps, store_element, modes), None, true)
            }
            I::PutByValDirect(_) => {
                let (steps, modes) = (entries.put_by_val_direct, self.profiles.array_access(word));
                other(by_element(steps, define_element, modes), None, false)
            }
            I::InById(op) => other(entries.in_by_id, Some(op.name), true),
            I::InByVal(_) => {
                let modes = self.profiles.array_access(word);
                other(
                    by_element(entries.in_by_val, has_element, modes),
                    None,
                    true,
                )
            }
            I::DeleteById(op) => {
                let steps = by_mode(op.strict, entries.delete_by_id_strict, entries.delete_by_id);
                other(steps, Some(op.name), false)
            }
            I::DeleteByVal(op) => {
                let (strict, sloppy) = (entries.delete_by_val_strict, entries.delete_by_val);
                other(by_mode(op.strict, strict, sloppy), None, false)
            }
            I::Instanceof(_) => other(entries.instance_of, None, false),
            I::GetPrivateName(_) => other(entries.get_private_name, None, false),
            I::PutPrivateName(_) => other(entries.put_private_name, None, false),
            I::DefinePrivateName(_) => other(entries.define_private_name, None, false),
            I::SetPrivateBrand(_) => other(entries.set_private_brand, None, false),
            I::CheckPrivateBrand(_) => other(entries.check_private_brand, None, false),
            I::HasPrivateName(_) | I::HasPrivateBrand(_) => {
                other(entries.has_private_name, None, false)
            }
            _ => unreachable!(),
        }
    }

    fn first_step(&mut self) {
        let access = self.access();
        if let Some(name) = access.name.filter(|_| !access.is_name_for_second_step_only) {
            self.m.move64(KEY, name);
        }
        self.m.compute_address(ENTRY, access.start);
        self.m.call_address(access.steps.first);
    }

    fn second_step(&mut self, cold: &Cold) {
        let access = self.access();
        if let Some(name) = access.name.filter(|_| access.is_name_for_second_step_only) {
            self.m.move64(KEY, name);
        }
        self.store_call_site();
        self.m.call_address(access.steps.second);
        if access.may_call_accessor {
            self.return_point();
        }
        self.m.jump(cold.resume);
    }

    /// Where to go, with the operands in the registers of `ic::abi`, if what the template does inline does not apply.
    /// It comes back to `done`, with the result.
    pub(super) fn cold_access(&mut self, done: Label) -> Label {
        self.cold_alone(done, |c, cold| c.both_steps(cold))
    }

    pub(super) fn both_steps(&mut self, cold: &Cold) {
        self.first_step();
        self.m.branch_if_not_zero64(RESULT, cold.resume);
        self.second_step(cold);
    }

    /// For a template that does nothing inline. The caller binds `done` next.
    pub(super) fn call_access(&mut self, done: Label) {
        let second = self.cold_alone(done, |c, cold| c.second_step(cold));
        self.first_step();
        self.m.branch_if_zero64(RESULT, second);
    }

    /// Of an access by value.
    pub(super) fn modes_of_access(&self) -> Address {
        let modes = offset_of!(ArrayAccess, array) + ArrayProfile::OFFSET_OF_MODES;
        self.access().start.plus(modes as i32)
    }

    pub(super) fn name_of_access(&self) -> Option<usize> {
        self.access().name
    }

    /// For the call of a function of the realm and `arguments`.
    pub(super) fn prepare_operation(&mut self, arguments: &[Argument]) {
        let realm = Argument::Load64(at(CODE_BLOCK, CodeBlock::OFFSET_OF_GLOBAL));
        let all: SmallVec<[Argument; 6]> = [realm].iter().chain(arguments).copied().collect();
        self.store_call_site();
        self.m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
        self.m.move_arguments(&all);
    }

    /// The result is in `T0`, and is zero if it has thrown.
    pub(super) fn call_unchecked_operation(&mut self, function: usize, arguments: &[Argument]) {
        self.prepare_operation(arguments);
        self.m.call_address(function);
    }

    pub(super) fn throw_if_zero(&mut self) {
        let throw = self.m.external_address(call::throw_from_frame());
        self.m.branch_if_zero64(T0, throw);
    }

    /// Does not go on if it has thrown.
    pub(super) fn call_operation(&mut self, function: usize, arguments: &[Argument]) {
        self.call_unchecked_operation(function, arguments);
        self.throw_if_zero();
    }
}
