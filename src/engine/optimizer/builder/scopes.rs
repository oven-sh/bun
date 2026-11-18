//! Variables that are not in registers.

use bun_engine_bytecode::{Instruction, MetadataKind, Operand, Register, op};
use bun_engine_codegen::ir::{Heap, State, Type, Value as Ssa};
use bun_engine_vm::code::metadata::{GetGlobal, GetImport, GlobalAccess, ResolveDynamic};
use bun_engine_vm::{
    Environment, Gc, GlobalObject, JsFunction, ModuleEnvironment, ScopeTemplate,
    SpeculatedType as T, Value,
};
use smallvec::SmallVec;

use super::Builder;
use super::frame::Frame;
use crate::graph::{ExitKind, Kind, ShapeSet, heaps};

impl Builder<'_> {
    pub(super) fn scope_of(&mut self, callee: Ssa) -> Ssa {
        if let Some(function) = self.constant_cell::<JsFunction>(callee) {
            return self.cell(function.scope());
        }
        if self.graph.kind(self.graph.root(callee)) == Some(Kind::NewFunction) {
            return self.graph.operand(self.graph.root(callee), 0);
        }
        let callee = self.alias(callee);
        self.load_immutable(Type::I64, callee, JsFunction::OFFSET_OF_SCOPE)
    }

    pub(super) fn enter_function(&mut self, op: op::Enter) {
        let frame = self.frame();
        let (mut callee, executable) = (frame.get(Register::CALLEE), frame.code_block.executable());
        if let Some(function) = executable.downcast::<bun_engine_vm::FunctionExecutable>()
            && self.constant_value(callee).is_none()
            && let Some(only) = function.singleton()
            && self.watch(function.singleton_watchpoints())
        {
            callee = self.cell(only.cell());
        }
        let scope = self.scope_of(callee);
        self.graph.predict(scope, T::OTHER_CELL);
        self.graph.declare(scope, T::CELL);
        self.set(Register::SCOPE, scope);
        let undefined = self.undefined();
        (1..=op.variables).for_each(|index| self.set(Register::local(index), undefined));
    }

    fn outer_scope(&mut self, scope: Register, depth: u32) -> Ssa {
        let mut scope = self.get(scope);
        for _ in 0..depth {
            scope = match self.constant_cell::<Environment>(scope) {
                Some(environment) => self.cell(environment.parent()),
                None if self.graph.kind(scope) == Some(Kind::NewScope) => {
                    self.graph.operand(scope, 0)
                }
                None => self.load_immutable(Type::I64, scope, Environment::OFFSET_OF_PARENT),
            };
        }
        scope
    }

    fn slot(&mut self, slot: u32) -> (i32, Heap) {
        (
            (Environment::OFFSET_OF_SLOTS + slot as usize * 8) as i32,
            self.heap_member(heaps::Family::ScopeSlot, slot as usize),
        )
    }

    fn settled_variable(&mut self, scope: Ssa, slot: u32) -> Option<Value> {
        let environment = self.constant_cell::<Environment>(scope)?;
        self.settled_value(environment, slot)
    }

    fn settled_value(&mut self, environment: Gc<Environment>, slot: u32) -> Option<Value> {
        let value = environment.settled_value(slot)?;
        (self.watch(environment.template().foreign_write_watchpoints())).then_some(value)
    }

    /// Without metadata it is nothing that scripts can name.
    pub(super) fn get_scoped(
        &mut self,
        dst: Register,
        scope: Register,
        depth: u32,
        slot: u32,
        metadata: Option<u32>,
    ) -> Option<Ssa> {
        let scope = self.outer_scope(scope, depth);
        let value = match self.settled_variable(scope, slot) {
            Some(value) => self.value(value),
            None => {
                let prediction = match metadata {
                    Some(metadata) => self.prediction_or_exit(metadata)?,
                    None => T::BYTECODE_TOP,
                };
                let (offset, heap) = self.slot(slot);
                let value = self.load_value(scope, offset, heap, prediction);
                metadata.inspect(|&metadata| self.note_profile(value, metadata));
                value
            }
        };
        self.set(dst, value);
        Some(value)
    }

    pub(super) fn get_initialized(
        &mut self,
        dst: Register,
        scope: Register,
        depth: u32,
        slot: u32,
        metadata: u32,
    ) {
        if let Some(value) = self.get_scoped(dst, scope, depth, slot, Some(metadata)) {
            self.assume_type(value, T::HEAP_TOP);
        }
    }

    pub(super) fn get_scoped_checked(
        &mut self,
        dst: Register,
        scope: Register,
        depth: u32,
        slot: u32,
        metadata: u32,
    ) {
        self.state();
        if let Some(value) = self.get_scoped(dst, scope, depth, slot, Some(metadata)) {
            self.check_type_or(value, T::HEAP_TOP, ExitKind::Uninitialized);
        }
    }

    pub(super) fn put_scoped(&mut self, scope: Register, depth: u32, slot: u32, value: Operand) {
        let (scope, value) = (self.outer_scope(scope, depth), self.get(value));
        let (offset, heap) = self.slot(slot);
        self.store_value(scope, scope, offset, heap, value);
    }

    fn scope_allocation(&mut self, template: &ScopeTemplate) -> Option<u32> {
        if template.singleton_watchpoints().is_still_valid() {
            return None;
        }
        let size = Environment::allocation_size(template.slot_count());
        self.allocation(self.global().environment_shape(), size)
    }

    /// Going by the order of the code.
    fn likely_template_in(&self, register: Register) -> Option<Gc<ScopeTemplate>> {
        let Frame {
            code_block, offset, ..
        } = *self.frame();
        let (mut found, mut at) = (None, 0);
        while at < offset {
            let (instruction, size) = Instruction::read(code_block.body().instructions(), at);
            if let Instruction::CreateScope(op) = instruction
                && op.dst == register
            {
                found = Some(op.scope);
            }
            at += size;
        }
        Some(code_block.scope_template(self.vm, found?))
    }

    pub(super) fn copy_scope(&mut self, op: op::CopyScope) {
        let template =
            (self.likely_template_in(op.scope)).filter(|_| !self.has_exited(ExitKind::BadIdentity));
        let Some((template, data)) =
            template.and_then(|it| Some((it, self.scope_allocation(&it)?)))
        else {
            return self.interpret();
        };
        let (old, expected) = (self.get(op.scope), self.cell(template.cell()));
        let found = self.load_immutable(Type::I64, old, Environment::OFFSET_OF_TEMPLATE);
        self.check_identical(found, expected);
        let data_of_type = self.graph.intern_type(T::CELL);
        let old = self.insert_node(Kind::Refine, &[old], data_of_type, State::NONE);
        let slots: SmallVec<[_; 8]> = (0..template.slot_count())
            .map(|slot| {
                let (offset, heap) = self.slot(slot);
                (offset, heap, self.load(Type::I64, old, offset, heap))
            })
            .collect();
        let parent = self.outer_scope(op.scope, 1);
        let scope = self.node(Kind::NewScope, &[parent, expected], data);
        for (offset, heap, value) in slots {
            let value = self.graph.root(value);
            self.initialize(scope, offset, heap, value);
        }
        self.set(op.scope, scope);
    }

    pub(super) fn create_scope(&mut self, op: op::CreateScope) {
        let template = self.frame().code_block.scope_template(self.vm, op.scope);
        let Some(data) = self.scope_allocation(&template) else {
            return self.interpret_if_it_recurs();
        };
        let operands = [self.get(op.parent), self.cell(template.cell())];
        let scope = self.node(Kind::NewScope, &operands, data);
        for slot in 0..template.slot_count() {
            let value = if slot < template.undefined_slots() {
                self.undefined()
            } else {
                self.empty()
            };
            let (offset, heap) = self.slot(slot);
            self.initialize(scope, offset, heap, value);
        }
        self.set(op.dst, scope);
    }

    /// The environment that declares the binding, and the index of its slot.
    fn import_target(&mut self, op: op::GetImport, entry: &GetImport) -> Option<(Ssa, u32)> {
        if !entry.varies() {
            let (environment, slot) = entry.target(self.vm)?;
            return Some((self.cell(environment.cell()), slot));
        }
        let likely = (entry.likely_index()).filter(|_| !self.has_exited(ExitKind::BadIdentity))?;
        let module = self.outer_scope(op.scope, op.depth);
        if let Some(module) = self.constant_cell::<ModuleEnvironment>(module) {
            let (environment, slot) = module.import_target(op.slot)?;
            return Some((self.cell(environment.cell()), slot));
        }
        let place = Environment::allocation_size(op.slot);
        let index = self.load_immutable(Type::I64, module, place + size_of::<u64>());
        let expected = self.value(Value::int32(likely as i32));
        let differs = self.ir().not_equal(index, expected);
        self.exit_if(differs, ExitKind::BadIdentity);
        let environment = self.load_immutable(Type::I64, module, place);
        let cell = self.graph.intern_type(T::CELL);
        let checked = self.insert_node(Kind::Refine, &[environment], cell, State::NONE);
        Some((checked, likely))
    }

    pub(super) fn get_import(&mut self, op: op::GetImport) {
        let code_block = self.frame().code_block;
        let code_block = code_block.anchor();
        let entry = code_block.checked_metadata::<GetImport>(MetadataKind::GetImport, op.metadata);
        let Some((environment, slot)) = self.import_target(op, entry) else {
            return self.interpret_or_exit(op.metadata);
        };
        if let Some(value) = self.settled_variable(environment, slot) {
            let value = self.value(value);
            return self.set(op.dst, value);
        }
        let Some(prediction) = self.prediction_or_exit(op.metadata) else {
            return;
        };
        let (offset, heap) = self.slot(slot);
        let value = self.load_value(environment, offset, heap, prediction);
        self.note_profile(value, op.metadata);
        self.check_type_or(value, T::HEAP_TOP, ExitKind::Uninitialized);
        self.set(op.dst, value);
    }

    pub(super) fn resolve_dynamic(&mut self, op: op::ResolveDynamic) {
        let code_block = self.frame().code_block;
        let entry = code_block
            .checked_metadata::<ResolveDynamic>(MetadataKind::ResolveDynamic, op.metadata);
        let name = code_block.identifier(op.name);
        let Some(watchpoints) =
            (self.vm.eval_variable_watchpoints(name)).filter(|_| entry.epoch.get() != 0)
        else {
            return self.interpret();
        };
        self.watch_shared(watchpoints);
        let holder = match entry.depth.get() {
            ResolveDynamic::GLOBAL => self.cell(self.global().cell()),
            depth => self.outer_scope(op.scope, depth),
        };
        self.set(op.dst, holder);
    }

    /// The slot of an environment that the access has gone to, once it is checked that it goes there again.
    fn slot_in_holder(&mut self, holder: Ssa, access: &GlobalAccess) -> Option<u32> {
        let shape = self.global().environment_shape();
        if access.shape.get() != shape.id() || self.has_exited(ExitKind::BadShape) {
            return None;
        }
        let shapes = ShapeSet::single(self.shape(shape));
        self.check_shapes(holder, shapes);
        let offset = access.byte_offset.get() as usize - Environment::OFFSET_OF_SLOTS;
        Some((offset / size_of::<u64>()) as u32)
    }

    pub(super) fn get_dynamic(&mut self, op: op::GetDynamic) {
        let (code_block, holder) = (self.frame().code_block, self.get(op.holder));
        let code_block = code_block.anchor();
        let access = &code_block
            .checked_metadata::<GetGlobal>(MetadataKind::GetDynamic, op.metadata)
            .access;
        let name = code_block.identifier(op.name);
        if self.constant_cell::<GlobalObject>(holder).is_some() {
            return self.get_from_global(op.dst, name, access, op.metadata);
        }
        if !self.has_exited(ExitKind::BadType)
            && let Some(slot) = self.slot_in_holder(holder, access)
        {
            self.get_scoped_checked(op.dst, op.holder, 0, slot, op.metadata);
            return;
        }
        if access.shape.get().is_none() || self.has_exited(ExitKind::BadShape) {
            return self.interpret_or_exit(op.metadata);
        }
        let shape = self.cached_shape(access.shape.get());
        if !shape.instance_type().is_object() {
            return self.interpret_or_exit(op.metadata);
        }
        let shapes = ShapeSet::single(self.shape(shape));
        let object = self.check_shapes(holder, shapes);
        if let Some(value) =
            self.load_own(object, shapes, name, access.byte_offset.get(), op.metadata)
        {
            self.set(op.dst, value);
        }
    }

    pub(super) fn put_dynamic(&mut self, op: op::PutDynamic) {
        let (code_block, holder) = (self.frame().code_block, self.get(op.holder));
        let access = (code_block.anchor())
            .checked_metadata::<GlobalAccess>(MetadataKind::PutDynamic, op.metadata);
        if self.constant_cell::<GlobalObject>(holder).is_some() {
            return self.put_to_global(code_block.anchor().identifier(op.name), op.value);
        }
        if self.has_exited(ExitKind::BadType) {
            return self.interpret();
        }
        let Some(slot) = self.slot_in_holder(holder, access) else {
            return self.interpret();
        };
        let (offset, heap) = self.slot(slot);
        let old = self.load_value(holder, offset, heap, T::BYTECODE_TOP);
        self.check_type(old, T::HEAP_TOP);
        self.put_scoped(op.holder, 0, slot, op.value);
    }

    pub(super) fn get_dynamic_this(&mut self, op: op::GetDynamicThis) {
        let holder = self.get(op.holder);
        if self.constant_cell::<GlobalObject>(holder).is_none() {
            return self.interpret();
        }
        let undefined = self.undefined();
        self.set(op.dst, undefined);
    }
}
