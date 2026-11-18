//! Variables that are not in the frame.

use core::mem::offset_of;

use bun_engine_asm::Argument;
use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{IdentifierIndex, Instruction, Operand, Register, Unresolved, op};
use bun_engine_vm::code::metadata::{GetGlobal, GetImport, GlobalAccess, ResolveDynamic};
use bun_engine_vm::ic::operations;
use bun_engine_vm::{
    CellKind, CellType, CustomGetterSetter, Environment, GlobalBinding, GlobalObject,
    InlineWatchpointSet, RealmSlot, ScopeTemplate, Vm,
};

use super::{Cold, Compiler, metadata};
use crate::emit::{Emit, UNDEFINED, at, shape_id};
use crate::ic::load_custom_function;
use crate::registers::*;

impl Compiler<'_> {
    /// The one that has the slot at `index`.
    fn load_scope(&mut self, dst: Gpr, (scope, depth, index): (Register, u32, u32)) {
        self.load(dst, scope);
        for _ in 0..depth {
            self.m.load64(dst, at(dst, Environment::OFFSET_OF_PARENT));
        }
        if cfg!(debug_assertions) {
            let (wrong, right) = (self.m.new_label(), self.m.new_label());
            (self.m).branch_unless_type_in(dst, Environment::CLASS.types(), T5, wrong);
            self.m.load64(T5, at(dst, Environment::OFFSET_OF_TEMPLATE));
            let count = at(T5, ScopeTemplate::OFFSET_OF_SLOT_COUNT);
            self.m.branch32(Cond::Above, count, index, right);
            self.m.bind(wrong);
            self.m.breakpoint();
            self.m.bind(right);
        }
    }

    pub(super) fn get_scoped(
        &mut self,
        dst: Register,
        place: (Register, u32, u32),
        profile: Option<u32>,
        is_checked: bool,
    ) {
        self.load_scope(T0, place);
        (self.m).load64(T0, at(T0, Environment::allocation_size(place.2)));
        if is_checked {
            let slow = self.slow();
            self.m.branch_if_empty(T0, slow);
        }
        match profile {
            Some(word) => self.store_profiled_result(dst, word),
            None => self.store_result(dst),
        }
    }

    pub(super) fn put_scoped(&mut self, place: (Register, u32, u32), value: Operand) {
        self.load_scope(T1, place);
        self.load(T0, value);
        (self.m).store64(at(T1, Environment::allocation_size(place.2)), T0);
        self.barrier_for(value, T0);
        self.keep(value);
    }

    pub(super) fn get_import(&mut self, op: op::GetImport) {
        let (slow, found) = (self.slow(), self.m.new_label());
        let varies = self.cold_until(found, |c, cold| {
            let Instruction::GetImport(op) = c.instruction(cold.offset) else {
                unreachable!()
            };
            c.m.branch_if_zero64(T0, cold.slow);
            c.load_scope(T1, (op.scope, op.depth, op.slot + 1));
            (c.m).load_pair64(T0, T1, at(T1, Environment::allocation_size(op.slot)));
            c.m.branch_if_not_int32(T1, cold.slow);
            c.m.zero_extend32(T1, T1);
            let slots = Environment::OFFSET_OF_SLOTS as i32;
            (c.m).compute_address(T0, Address::indexed(T0, T1, Scale::Eight, slots));
            c.m.jump(cold.resume);
        });
        (self.m).load64(T0, metadata(op.metadata, offset_of!(GetImport, slot)));
        (self.m).branch64(Cond::BelowEq, T0, GetImport::VARIES, varies);
        self.m.bind(found);
        self.m.load64(T0, at(T0, 0));
        self.m.branch_if_empty(T0, slow);
        self.store_profiled_result(op.dst, op.metadata);
    }

    /// Leaves the address of the slot in `T2`, and the global object in `T1`.
    fn find_global_property(&mut self, access: Address, otherwise: Label) {
        let field = |offset: usize| access.plus(offset as i32);
        self.m.load_global(T1);
        self.m.load32(T2, shape_id(T1));
        (self.m).branch32(
            Cond::Ne,
            T2,
            field(offset_of!(GlobalAccess, shape)),
            otherwise,
        );
        (self.m).load32_signed64(T3, field(offset_of!(GlobalAccess, byte_offset)));
        self.m.slot_base(T2, T1, T3);
        self.m.add64(T2, T2, T3);
    }

    /// Leaves its address in `dst`.
    fn find_global_binding(&mut self, dst: Gpr, access: Address, otherwise: Label) {
        let field = |offset: usize| access.plus(offset as i32);
        (self.m).branch_if_not_zero32(field(offset_of!(GlobalAccess, shape)), otherwise);
        self.m.load64(dst, field(offset_of!(GlobalAccess, pointer)));
        self.m.branch_if_zero64(dst, otherwise);
    }

    fn call_get_global(&mut self, cold: &Cold) {
        let Instruction::GetGlobal(op) = self.instruction(cold.offset) else {
            unreachable!()
        };
        let function = match op.unresolved {
            Unresolved::Throw => operations::get_global::<true>,
            Unresolved::Undefined => operations::get_global::<false>,
        };
        let access = Argument::AddressOf(metadata(op.metadata, offset_of!(GetGlobal, access)));
        let arguments = [CODE_BLOCK.into(), access, self.name_address(op.name).into()];
        self.call_operation(function as *const () as usize, &arguments);
        self.m.jump(cold.resume);
    }

    fn call_custom_getter_of_global(
        &mut self,
        access: Address,
        name: IdentifierIndex,
        other: Label,
    ) {
        let (field, is_value) = (
            |offset: usize| access.plus(offset as i32),
            self.m.new_label(),
        );
        self.m.load_global(T4);
        self.m.load32(T0, shape_id(T4));
        self.m.xor32(T0, T0, field(offset_of!(GlobalAccess, shape)));
        self.m.move64(T1, T4);
        (self.m).branch32(Cond::Eq, T0, GlobalAccess::CUSTOM_VALUE_TAG, is_value);
        (self.m).branch32(Cond::Ne, T0, GlobalAccess::CUSTOM_ACCESSOR_TAG, other);
        (self.m).load64(
            T1,
            at(T4, GlobalObject::offset_of_slot(RealmSlot::global_this)),
        );
        self.m.bind(is_value);
        (self.m).load32_signed64(T3, field(offset_of!(GlobalAccess, byte_offset)));
        self.m.slot_base(T0, T4, T3);
        self.m.load64(T0, Address::indexed(T0, T3, Scale::One, 0));
        load_custom_function(&mut self.m, T0, CustomGetterSetter::OFFSET_OF_GETTER, other);
        self.call_custom_accessor(self.name_address(name).into(), None);
    }

    pub(super) fn get_global(&mut self, op: op::GetGlobal) {
        let access = metadata(op.metadata, offset_of!(GetGlobal, access));
        let (loaded, found) = (self.m.new_label(), self.m.new_label());
        let call = self.cold_alone(found, |c, cold| c.call_get_global(cold));
        let (is_property, is_plain) = self.profiles.reads_global_property(op.metadata);
        if is_property && !is_plain {
            self.call_custom_getter_of_global(access, op.name, call);
        } else if is_property {
            self.find_global_property(access, call);
            self.m.load64(T0, at(T2, 0));
        } else {
            let property = self.cold_with(loaded, call, |c, cold| {
                let word = c.raw(cold.offset).metadata;
                c.find_global_property(metadata(word, offset_of!(GetGlobal, access)), cold.slow);
                c.m.load64(T0, at(T2, 0));
                c.m.jump(cold.resume);
            });
            self.find_global_binding(T0, access, property);
            self.m.load64(T0, at(T0, GlobalBinding::OFFSET_OF_VALUE));
        }
        self.m.bind(loaded);
        self.m.branch_if_empty(T0, call);
        self.m.bind(found);
        self.store_profiled_result(op.dst, op.metadata);
    }

    /// The value in `T0`, into the one in `T2`.
    fn store_in_global_binding(&mut self, otherwise: Label) {
        let watchpoints = at(T2, GlobalBinding::OFFSET_OF_WATCHPOINTS);
        let invalidated = InlineWatchpointSet::THIN_INVALIDATED;
        (self.m).branch64(Cond::Ne, watchpoints, invalidated, otherwise);
        self.m.store64(at(T2, GlobalBinding::OFFSET_OF_VALUE), T0);
    }

    pub(super) fn put_global(&mut self, op: op::PutGlobal) {
        let (access, slow) = (metadata(op.metadata, 0), self.slow());
        self.load(T0, op.value);
        if self.profiles.writes_global_property(op.metadata) {
            self.find_global_property(access, slow);
            self.m.store64(at(T2, 0), T0);
        } else {
            let stored = self.m.new_label();
            let property = self.cold_until(stored, |c, cold| {
                let access = metadata(c.raw(cold.offset).metadata, 0);
                c.find_global_property(access, cold.slow);
                c.m.store64(at(T2, 0), T0);
                c.m.jump(cold.resume);
            });
            self.find_global_binding(T2, access, property);
            self.store_in_global_binding(slow);
            if !self.is_never_cell(op.value) {
                self.m.load_global(T1);
            }
            self.m.bind(stored);
        }
        self.barrier_for(op.value, T0);
        self.keep(op.value);
    }

    pub(super) fn resolve_dynamic(&mut self, op: op::ResolveDynamic) {
        let slow = self.slow();
        self.load(T1, op.scope);
        self.m.compute_address(T2, metadata(op.metadata, 0));
        self.m.call_address(self.thunks.resolve_dynamic);
        self.m.branch_if_zero64(T0, slow);
        self.store_result(op.dst);
    }

    /// Leaves the holder in `T1` and the address of the slot in `T2`, or goes to `binding`.
    fn find_slot_in_holder(&mut self, holder: Register, access: Address, binding: Label) {
        let field = |offset: usize| access.plus(offset as i32);
        self.load(T1, holder);
        self.m.load32(T2, shape_id(T1));
        (self.m).branch32(
            Cond::Ne,
            T2,
            field(offset_of!(GlobalAccess, shape)),
            binding,
        );
        (self.m).load32_signed64(T3, field(offset_of!(GlobalAccess, byte_offset)));
        self.m.slot_base(T2, T1, T3);
        self.m.add64(T2, T2, T3);
    }

    /// Leaves its address in `T2`.
    fn find_binding_in_holder(&mut self, access: Address, otherwise: Label) {
        (self.m).branch_if_not_type(T1, CellType::GlobalObject, otherwise);
        (self.m).load64(T2, access.plus(offset_of!(GlobalAccess, pointer) as i32));
        self.m.branch_if_zero64(T2, otherwise);
    }

    pub(super) fn get_dynamic(&mut self, op: op::GetDynamic) {
        const ACCESS: usize = offset_of!(GetGlobal, access);
        let (slow, found) = (self.slow(), self.m.new_label());
        let binding = self.cold_until(found, |c, cold| {
            c.find_binding_in_holder(metadata(c.raw(cold.offset).metadata, ACCESS), cold.slow);
            c.m.jump(cold.resume);
        });
        self.find_slot_in_holder(op.holder, metadata(op.metadata, ACCESS), binding);
        self.m.bind(found);
        self.m.load64(T0, at(T2, 0));
        self.m.branch_if_empty(T0, slow);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn put_dynamic(&mut self, op: op::PutDynamic) {
        let (slow, stored) = (self.slow(), self.m.new_label());
        let binding = self.cold_until(stored, |c, cold| {
            c.find_binding_in_holder(metadata(c.raw(cold.offset).metadata, 0), cold.slow);
            c.m.move64(T0, T4);
            c.store_in_global_binding(cold.slow);
            c.m.load_global(T1);
            c.m.jump(cold.resume);
        });
        self.load(T4, op.value);
        self.find_slot_in_holder(op.holder, metadata(op.metadata, 0), binding);
        self.m.branch_if_empty(at(T2, 0), slow);
        self.m.store64(at(T2, 0), T4);
        self.m.bind(stored);
        self.barrier_for(op.value, T4);
    }

    pub(super) fn get_dynamic_this(&mut self, op: op::GetDynamicThis) {
        let done = self.m.new_label();
        self.load(T1, op.holder);
        self.m.move32(T0, UNDEFINED);
        self.m.branch_if_not_type(T1, CellType::WithScope, done);
        self.m.load64(T0, at(T1, Environment::allocation_size(0)));
        self.m.bind(done);
        self.store_result(op.dst);
    }
}

/// `depth` parents up from the scope in `T1`, into `T0`.
fn load_outer_scope(m: &mut MacroAssembler, depth: Gpr) {
    let done = m.new_label();
    m.move64(T0, T1);
    m.branch_if_zero32(depth, done);
    let next = m.here();
    m.load64(T0, at(T0, Environment::OFFSET_OF_PARENT));
    m.branch_sub32(ResultCond::NonZero, depth, depth, 1, next);
    m.bind(done);
}

/// From the scope in `T1` and the entry at `T2`. Returns the holder, or zero.
pub(crate) fn emit_resolve_dynamic(m: &mut MacroAssembler) {
    let [changed, by_depth, global, no_variables, miss] = core::array::from_fn(|_| m.new_label());
    let entry = |field: usize| at(T2, field);
    let (depth, variables) = (
        offset_of!(ResolveDynamic, depth),
        ResolveDynamic::VARIABLES as i32,
    );
    m.load32(T0, at(VM, Vm::OFFSET_OF_EVAL_VARIABLES_EPOCH));
    m.branch32(
        Cond::Ne,
        T0,
        entry(offset_of!(ResolveDynamic, epoch)),
        changed,
    );
    m.bind(by_depth);
    m.load32(T3, entry(depth));
    m.branch32(Cond::Eq, T3, ResolveDynamic::GLOBAL as i32, global);
    load_outer_scope(m, T3);
    m.ret();
    m.bind(global);
    m.load_global(T0);
    m.ret();

    m.bind(changed);
    m.load32(T4, entry(offset_of!(ResolveDynamic, shape)));
    m.branch_if_zero32(T4, miss);
    m.load16(T3, entry(offset_of!(ResolveDynamic, variables_depth)));
    load_outer_scope(m, T3);
    m.load16(T3, entry(offset_of!(ResolveDynamic, variables_slot)));
    let slots = Environment::OFFSET_OF_SLOTS as i32;
    m.load64(T0, Address::indexed(T0, T3, Scale::Eight, slots));
    m.branch_if_empty(T0, no_variables);
    m.branch32(Cond::Ne, T4, shape_id(T0), miss);
    m.branch32(Cond::Ne, entry(depth), variables, by_depth);
    m.ret();
    m.bind(no_variables);
    m.branch32(Cond::Ne, entry(depth), variables, by_depth);
    m.bind(miss);
    m.move32(T0, 0);
    m.ret();
}
