//! What is found by way of the shape of an object.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{Access, AccessFlags, Type, Value as Ssa};
use bun_engine_vm::heap::{Allocator, shape_base};
use bun_engine_vm::{
    CellType, FunctionRareData, JsCell, JsFunction, JsObject, Shape, SpeculatedType as T, TypeFlags,
};

use super::ways::Detour;
use super::{Lowering, Odds};
use crate::graph::{ExitKind, heaps};
use crate::runtime::operations::objects;

const FIXED: Access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);

impl Lowering<'_> {
    pub(super) fn shape_of(&mut self, cell: Ssa) -> Ssa {
        let id = self.shape_id(cell);
        let id = self.ir().zero_extend(id);
        self.ir().add(id, shape_base())
    }

    pub(super) fn kept_names(&mut self, object: Ssa, offset: usize) -> Ssa {
        let (shape, heap) = (self.shape_of(object), heaps::OTHER_FIELDS);
        let rare_data = self.load(Type::I64, shape, Shape::OFFSET_OF_RARE_DATA, heap);
        let has_none = self.ir().is_zero(rare_data);
        let load = |this: &mut Self| this.load(Type::I64, rare_data, offset, heap);
        self.choose(has_none, Odds::Low, Type::I64, |_| rare_data, load)
    }

    fn prototype_in_shape(&mut self, object: Ssa) -> Ssa {
        let shape = self.shape_of(object);
        (self.ir()).load(Type::I64, shape, Shape::OFFSET_OF_PROTOTYPE as i32, FIXED)
    }

    pub(super) fn load_prototype(&mut self, object: Ssa) -> Ssa {
        let is_exotic = self.has_flag(object, TypeFlags::OVERRIDES_GET_PROTOTYPE);
        self.exit_if(is_exotic, ExitKind::ExoticObject);
        self.prototype_in_shape(object)
    }

    pub(super) fn inherits_from(&mut self, object: Ssa, wanted: Ssa) -> Ssa {
        let meeting = self.part(Type::I32);
        let heir = self.begin_loop(object);
        let prototype = self.load_prototype(heir);
        let is_found = self.ir().equal(prototype, wanted);
        self.answer_if(meeting, is_found, Odds::Even, true);
        let goes_on = self.has_type(prototype, T::OBJECT, T::OBJECT | T::NULL);
        self.repeat_if(goes_on, heir, prototype);
        let no = self.int32(0);
        self.give(meeting, no);
        self.meet(meeting)
    }

    pub(super) fn generic_get_prototype_of(&mut self, value: Ssa) -> Ssa {
        let (meeting, mut slow) = (self.part(Type::I64), Detour::default());
        let is_primitive = self.has_type(value, !T::OBJECT, T::HEAP_TOP);
        self.detour_if(is_primitive, Odds::Even, &mut slow);
        let is_exotic = self.has_flag(value, TypeFlags::OVERRIDES_GET_PROTOTYPE);
        self.detour_if(is_exotic, Odds::Even, &mut slow);
        let prototype = self.prototype_in_shape(value);
        self.give(meeting, prototype);
        self.meet_after(meeting, slow, |this| {
            this.call_operation(objects::GET_PROTOTYPE_OF, &[value])
        })
    }

    fn detour_unless_of_type(&mut self, cell: Ssa, wanted: CellType, detour: &mut Detour) {
        let holds = self.has_cell_type(cell, wanted);
        let fails = self.not(holds);
        self.detour_if(fails, Odds::Low, detour);
    }

    /// From an allocator that is known only now.
    fn bump_or_detour(&mut self, allocator: Ssa, detour: &mut Detour) -> Ssa {
        // Among what all that can collect is taken to write.
        let heap = heaps::STRING_FIBER;
        let cell = self.load(Type::I64, allocator, Allocator::OFFSET_OF_START, heap);
        let end = self.load(Type::I64, allocator, Allocator::OFFSET_OF_END, heap);
        let is_full = self.ir().above_or_equal(cell, end);
        self.detour_if(is_full, Odds::Low, detour);
        let mut ir = self.ir();
        let size = ir.load(
            Type::I32,
            allocator,
            Allocator::OFFSET_OF_CELL_SIZE as i32,
            FIXED,
        );
        let size = ir.zero_extend(size);
        let next = ir.add(cell, size);
        self.store(next, allocator, Allocator::OFFSET_OF_START, heap);
        cell
    }

    pub(super) fn create_this(&mut self, new_target: Ssa, capacity: u32) -> Ssa {
        let (meeting, mut slow) = (self.part(Type::I64), Detour::default());
        self.detour_unless_of_type(new_target, CellType::Function, &mut slow);
        let (offset, heap) = (JsFunction::OFFSET_OF_EXECUTABLE, heaps::FUNCTION_TARGET);
        let rare_data = self.load(Type::I64, new_target, offset, heap);
        self.detour_unless_of_type(rare_data, CellType::FunctionRareData, &mut slow);
        let [allocator, shape] = [
            FunctionRareData::OFFSET_OF_OBJECT_ALLOCATOR,
            FunctionRareData::OFFSET_OF_OBJECT_SHAPE,
        ]
        .map(|offset| self.load(Type::I64, rare_data, offset, heaps::OTHER_FIELDS));
        let has_none = self.ir().is_zero(allocator);
        self.detour_if(has_none, Odds::Low, &mut slow);
        let object = self.bump_or_detour(allocator, &mut slow);

        let mut ir = self.ir();
        let id = ir.sub(shape, shape_base());
        let rest = ir.load(
            Type::I32,
            shape,
            Shape::OFFSET_OF_INSTANCE_HEADER as i32,
            FIXED,
        );
        let rest = ir.zero_extend(rest);
        let rest = ir.shl(rest, JsCell::OFFSET_OF_INDEXING_MODE * 8);
        let header = ir.or(id, rest);
        let offset = Shape::OFFSET_OF_INLINE_CAPACITY as i32;
        let slots = ir.load_narrow(Size::S8, Sign::Unsigned, shape, offset, FIXED);
        let slots = ir.zero_extend(slots);
        self.store(header, object, 0, heaps::SHAPE);
        // The word before the first slot is the storage.
        let (left, empty) = (self.begin_loop(slots), self.word(0));
        let mut ir = self.ir();
        let distance = ir.shl(left, 3);
        let address = ir.add(object, distance);
        ir.store(
            empty,
            address,
            JsObject::OFFSET_OF_STORAGE as i32,
            heaps::OBJECTS,
        );
        let (next, goes_on) = (ir.sub(left, 1), ir.is_not_zero(left));
        self.repeat_if(goes_on, left, next);
        self.give(meeting, object);
        self.meet_after(meeting, slow, |this| {
            let capacity = this.int32(capacity as i32);
            this.call_operation(objects::CREATE_THIS, &[new_target, capacity])
        })
    }
}

const _: () = assert!(JsObject::OFFSET_OF_STORAGE + size_of::<u64>() == size_of::<JsObject>());
