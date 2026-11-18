//! Making objects.

use core::ptr;

use bun_engine_bytecode::{MetadataKind, op};
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::code::metadata::{NewObject, WeakCell};
use bun_engine_vm::heap::Allocator;
use bun_engine_vm::{Gc, JsFinalObject, JsFunction, JsObject, Shape, SpeculatedType as T};

use super::Builder;
use crate::graph::{Allocation, ExitKind, Kind, ShapeSet, Vector, heaps};

impl Builder<'_> {
    /// The data of a node that makes a cell, unless that is too large for the allocators.
    pub(super) fn allocation(&mut self, shape: Gc<Shape>, size: usize) -> Option<u32> {
        let allocator = self.vm.heap.cells.allocator_for(size)?;
        Some(self.allocation_from(allocator, shape, size))
    }

    pub(super) fn allocation_from(
        &mut self,
        allocator: &Allocator,
        shape: Gc<Shape>,
        size: usize,
    ) -> u32 {
        let shape = self.shape(shape);
        let distance = ptr::from_ref(allocator).addr() - ptr::from_ref(self.vm).addr();
        self.graph.allocations.push(Allocation {
            shape,
            size: size as u32,
            allocator: distance as i32,
            cell_size: allocator.cell_size() as u32,
            vector: Vector::default(),
        });
        self.graph.allocations.len() as u32 - 1
    }

    pub(super) fn final_object_allocation(&mut self, shape: Gc<Shape>) -> Option<u32> {
        let size = JsFinalObject::allocation_size(shape.inline_capacity());
        self.allocation(shape, size)
    }

    pub(super) fn new_final_object(&mut self, allocation: u32) -> Ssa {
        let object = self.node(Kind::NewObject, &[], allocation);
        let shapes = ShapeSet::single(self.graph.allocations[allocation as usize].shape);
        self.knowledge
            .learn_shapes(&self.graph, object, shapes, object);
        object
    }

    /// The caller initializes it.
    pub(super) fn new_instance(&mut self, allocation: u32) -> Ssa {
        let object = self.node(Kind::NewInstance, &[], allocation);
        let shapes = ShapeSet::single(self.graph.allocations[allocation as usize].shape);
        let ty = self.graph.shapes.type_of(shapes);
        self.graph.declare(object, ty);
        self.graph.predict(object, ty);
        (self.knowledge).learn_shapes(&self.graph, object, shapes, object);
        object
    }

    fn profiled_allocation(&mut self, metadata: u32) -> Option<u32> {
        let code_block = self.frame().code_block;
        let entry = code_block.checked_metadata::<NewObject>(MetadataKind::NewObject, metadata);
        if entry.allocator.get().is_null() {
            return None;
        }
        let shape = self.cached_shape(entry.shape.get());
        self.final_object_allocation(shape)
    }

    pub(super) fn new_object(&mut self, op: op::NewObject) {
        let Some(allocation) = self.profiled_allocation(op.metadata) else {
            return self.interpret_if_it_recurs();
        };
        let object = self.new_final_object(allocation);
        self.set(op.dst, object);
    }

    pub(super) fn new_object_literal(&mut self, op: op::NewObjectLiteral) {
        let Some(allocation) = self.profiled_allocation(op.metadata) else {
            return self.interpret_if_it_recurs();
        };
        let code_block = self.frame().code_block;
        let object = self.new_final_object(allocation);
        for (index, name) in code_block.code().name_lists[op.names.index()]
            .iter()
            .enumerate()
        {
            let heap = self.heap_member(heaps::Family::Named, name.name().address());
            let value = self
                .graph
                .root(self.frame().get(op.first.nth(index as u32)));
            self.initialize(
                object,
                (size_of::<JsObject>() + index * 8) as i32,
                heap,
                value,
            );
        }
        self.set(op.dst, object);
    }

    pub(super) fn create_this(&mut self, op: op::CreateThis) {
        let new_target = self.get(op.new_target);
        let code_block = self.frame().code_block;
        let seen = code_block
            .checked_metadata::<WeakCell>(MetadataKind::CachedCallee, op.metadata)
            .get();
        let seen = seen
            .and_then(Gc::downcast)
            .filter(|_| !self.has_exited(ExitKind::BadIdentity));
        let function = self.constant_cell::<JsFunction>(new_target).or(seen);
        let known = function.and_then(|function| {
            let rare_data = function.rare_data()?;
            let shape = (rare_data.object_shape())
                .filter(|_| self.watch(rare_data.allocation_watchpoints()))?;
            Some((function, self.final_object_allocation(shape)?))
        });
        let Some((function, allocation)) = known else {
            let new_target = self.alias(new_target);
            let (kind, likely) = (Kind::CreateThis, T::FINAL_OBJECT);
            let object = self.profiled_node(kind, &[new_target], op.capacity, likely);
            return self.set(op.dst, object);
        };
        let expected = self.cell(function.cell());
        self.check_identical(new_target, expected);
        let object = self.new_final_object(allocation);
        self.set(op.dst, object);
    }

    pub(super) fn new_function(&mut self, op: op::NewFunction) {
        let executable = self.frame().code_block.function(self.vm, op.function);
        if executable.singleton_watchpoints().is_still_valid() {
            return self.interpret_if_it_recurs();
        }
        let shape = JsFunction::shape_for(self.vm, &self.global(), &executable);
        let Some(data) = self.allocation(shape, size_of::<JsFunction>()) else {
            return self.interpret();
        };
        self.global().absent_callee(self.vm);
        let operands = [self.get(op.scope), self.cell(executable.cell())];
        let function = self.node(Kind::NewFunction, &operands, data);
        self.set(op.dst, function);
    }
}
