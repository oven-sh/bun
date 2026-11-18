//! Objects: what they look like, and how they are made.

use bun_engine_codegen::ir::{
    Action, EffectFlags, Effects, Heap, Input, Output, Type, Value as Ssa,
};
use bun_engine_vm::{CellType, Environment, FunctionRareData, JsCell, JsFunction, JsObject};

use smallvec::SmallVec;

use super::emit::Site;
use super::operations::while_collecting;
use super::validate::Allocated;
use super::{Lowering, Odds};
use crate::graph::{ExitKind, ShapeSet, Transition, heaps};
use crate::runtime::operations;

impl Lowering<'_> {
    pub(super) fn shape_id(&mut self, cell: Ssa) -> Ssa {
        self.load(Type::I32, cell, JsCell::OFFSET_OF_SHAPE_ID, heaps::SHAPE)
    }

    pub(super) fn check_shape(&mut self, cell: Ssa, set: u32) {
        let id = self.shape_id(cell);
        let mut differs = None;
        for position in 0..self.graph.shapes.members(ShapeSet(set)).len() {
            let shape = self.graph.shapes.members(ShapeSet(set))[position];
            let expected = self.graph.shapes[shape].id.bits() as i32;
            let is_other = self.ir().not_equal(id, expected);
            differs = Some(differs.map_or(is_other, |so_far| self.ir().and(so_far, is_other)));
        }
        let differs = differs.unwrap_or_else(|| self.int32(1));
        self.exit_if(differs, ExitKind::BadShape);
    }

    pub(super) fn check_identical(&mut self, value: Ssa, expected: Ssa) {
        let differs = self.ir().not_equal(value, expected);
        self.exit_if(differs, ExitKind::BadIdentity);
    }

    pub(super) fn check_executable(&mut self, function: Ssa, expected: Ssa) {
        let offset = JsFunction::OFFSET_OF_EXECUTABLE;
        let target = self.load(Type::I64, function, offset, heaps::FUNCTION_TARGET);
        let differs = self.ir().not_equal(target, expected);
        self.when(differs, Odds::Low, |this| {
            let forwards = this.has_cell_type(target, CellType::FunctionRareData);
            let is_final = this.not(forwards);
            this.exit_if(is_final, ExitKind::BadExecutable);
            let offset = FunctionRareData::OFFSET_OF_EXECUTABLE;
            let target = this.load(Type::I64, target, offset, heaps::FUNCTION_TARGET);
            let differs = this.ir().not_equal(target, expected);
            this.exit_if(differs, ExitKind::BadExecutable);
        });
    }

    pub(super) fn load_executable(&mut self, function: Ssa) -> Ssa {
        let (offset, heap) = (JsFunction::OFFSET_OF_EXECUTABLE, heaps::FUNCTION_TARGET);
        let target = self.load(Type::I64, function, offset, heap);
        let forwards = self.has_cell_type(target, CellType::FunctionRareData);
        let offset = FunctionRareData::OFFSET_OF_EXECUTABLE;
        let forwarded = |this: &mut Self| this.load(Type::I64, target, offset, heap);
        self.choose(forwards, Odds::Low, Type::I64, forwarded, |_| target)
    }

    fn search(&mut self, site: Site, effects: Effects) -> Ssa {
        let mut data = self.patchpoint(Action::Custom, site, effects);
        data.scratch_gprs = 2;
        let operands = self.operands().into_iter();
        let inputs: SmallVec<[_; 4]> = operands.map(|it| (it, Input::LateRegister)).collect();
        let result = (Type::I64, Output::EarlyRegister);
        let found = self.ir().patchpoint(&data, &inputs, &[result]);
        let has_failed = self.ir().is_zero(found);
        self.exit_if(has_failed, ExitKind::ExoticObject);
        found
    }

    pub(super) fn search_and_load(&mut self, search: u32) -> Ssa {
        let mut effects = Effects::with_flags(EffectFlags::CONTROL_DEPENDENT);
        effects.reads = heaps::OBJECTS;
        self.search(Site::SearchAndLoad(search), effects)
    }

    pub(super) fn search_for_store(&mut self, search: u32) -> Ssa {
        let effects = while_collecting(heaps::LAYOUT);
        self.search(Site::SearchForStore(search), effects)
    }

    pub(super) fn set_shape(&mut self, object: Ssa, transition: u32) {
        let Transition { to, .. } = self.graph.transitions[transition as usize];
        let id = self.int32(self.graph.shapes[to].id.bits() as i32);
        self.store(id, object, JsCell::OFFSET_OF_SHAPE_ID, heaps::SHAPE);
    }

    pub(super) fn grow_slots(&mut self, object: Ssa, transition: u32) -> Ssa {
        let Transition { from, to } = self.graph.transitions[transition as usize];
        let [old, new] =
            [from, to].map(|it| self.int32(self.graph.shapes[it].out_of_line_capacity as i32));
        self.call_operation(operations::GROW_SLOTS, &[object, old, new])
    }

    pub(super) fn allocate_memory(&mut self, allocator: i32, cell_size: u32) -> Ssa {
        let site = Site::Allocate(allocator, cell_size);
        let mut data = self.patchpoint(Action::Custom, site, while_collecting(Heap::NOTHING));
        data.scratch_gprs = 1;
        (self.ir()).patchpoint(&data, &[], &[(Type::I64, Output::Register)])
    }

    /// To all of so many bytes, before the collector has a chance.
    pub(super) fn expect_stores(&mut self, address: Ssa, size: u32, owner: Ssa) {
        if cfg!(debug_assertions) {
            self.allocated.push(Allocated {
                address,
                size,
                owner,
            });
        }
    }

    pub(super) fn header_for(&mut self, allocation: u32) -> Ssa {
        let shape = self.graph.allocations[allocation as usize].shape;
        self.word(self.graph.shapes[shape].header)
    }

    /// With its header.
    pub(super) fn allocate(&mut self, allocation: u32) -> Ssa {
        let (facts, header) = (
            self.graph.allocations[allocation as usize],
            self.header_for(allocation),
        );
        let cell = self.allocate_memory(facts.allocator, facts.cell_size);
        self.expect_stores(cell, facts.size, Ssa::NONE);
        self.store(header, cell, 0, heaps::SHAPE);
        cell
    }

    pub(super) fn allocate_object(&mut self, allocation: u32) -> Ssa {
        let (object, none) = (self.allocate(allocation), self.word(0));
        self.store(none, object, JsObject::OFFSET_OF_STORAGE, heaps::STORAGE);
        object
    }

    pub(super) fn new_object(&mut self, allocation: u32) -> Ssa {
        let (object, empty) = (self.allocate_object(allocation), self.word(0));
        let size = self.graph.allocations[allocation as usize].size as usize;
        for offset in (size_of::<JsObject>()..size).step_by(8) {
            self.store(empty, object, offset, heaps::NAMED);
        }
        object
    }

    pub(super) fn new_scope(&mut self, parent: Ssa, template: Ssa, allocation: u32) -> Ssa {
        let (scope, heap) = (self.allocate(allocation), heaps::OTHER_FIELDS);
        self.store(parent, scope, Environment::OFFSET_OF_PARENT, heap);
        self.store(template, scope, Environment::OFFSET_OF_TEMPLATE, heap);
        scope
    }

    pub(super) fn new_function(&mut self, scope: Ssa, executable: Ssa, allocation: u32) -> Ssa {
        let function = self.allocate_object(allocation);
        let (heap, offset) = (heaps::FUNCTION_TARGET, JsFunction::OFFSET_OF_EXECUTABLE);
        self.store(
            scope,
            function,
            JsFunction::OFFSET_OF_SCOPE,
            heaps::OTHER_FIELDS,
        );
        self.store(executable, function, offset, heap);
        function
    }
}
