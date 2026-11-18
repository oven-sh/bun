//! `length` and the like, where they are not in a slot.

use bun_engine_asm::{Sign, Size};
use bun_engine_bytecode::{MetadataKind, op};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_text::names;
use bun_engine_vm::code::metadata::GetLength;
use bun_engine_vm::ic::AccessKind;
use bun_engine_vm::{
    ArrayModes, ElementKind, JsCell, MappedArguments, SpeculatedType as T, Storage, TypeFlags,
};

use super::{Access, Way};
use crate::builder::{Builder, Built};
use crate::graph::{Cache, ExitKind, Kind, ModeSet, heaps};

impl Builder<'_> {
    pub(in crate::builder) fn get_length(&mut self, op: op::GetLength) -> Built {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::GetLength);
        let entry = (code_block.anchor()).checked_metadata::<GetLength>(kind, op.metadata);
        let base = self.get(op.base);
        let seen = self.seen_of(base, entry.array.modes());
        let arrays = ModeSet::ARRAY.and(ModeSet::DENSE);
        let mut ways = self.likely_ways(base, seen, &[]);
        ways.retain(|way| !matches!(way, Way::Typed(_)));
        if self.knowledge.has_modes(&mut self.graph, base, arrays) {
            ways = [Way::Stored(arrays)].into_iter().collect();
        } else if self.is(base, T::ARRAY) {
            ways = [Way::Array].into_iter().collect();
        } else if seen.contains(ArrayModes::ARRAY) && !self.is(base, !T::ARRAY) {
            ways.insert(0, Way::Array);
        }
        if ways.is_empty() {
            return self.get_by_id(
                op.dst,
                op.base,
                names::length,
                (&entry.cache, Cache::GetById),
                op.metadata,
            );
        }
        let has_property = ArrayModes::NON_ARRAY | ArrayModes::TYPED_ARRAYS;
        let exit = self.exit_for_other_base(seen - ArrayModes::SPARSE);
        let exit = exit.filter(|_| !seen.intersects(has_property));
        let slowly = |this: &mut Self| {
            if let Some(length) = this.try_to_load_length(op, base, &entry.cache) {
                return length;
            }
            let operands = [base, this.name(names::length)];
            this.cached_load(Cache::GetById, &entry.cache, &operands, op.metadata)
        };
        let measure = |this: &mut Self, access: &mut Access, way, object| {
            let length = match way {
                Way::Stored(_) => {
                    let storage = this.storage(object);
                    this.dense_length(storage)
                }
                Way::Array => return Some(this.length_of_array(object)),
                Way::String => this.string_length(object),
                _ => this.length_of_arguments(access, object),
            };
            Some(this.box_int32(length))
        };
        let result = self.access_elements((base, Ssa::NONE, seen), &ways, exit, measure, slowly);
        result.inspect(|&result| self.set(op.dst, result));
        Ok(())
    }

    /// Exits if it is none.
    pub(in crate::builder) fn length_of_dense_array(&mut self, value: Ssa) -> Ssa {
        let (modes, exit) = (ModeSet::ARRAY.and(ModeSet::DENSE), ExitKind::BadElements);
        self.check_type_or(value, T::CELL, exit);
        let array = self.check_stored(value, modes, ArrayModes::empty(), false, exit);
        let storage = self.storage(array);
        self.dense_length(storage)
    }

    /// With its tag.
    fn length_of_array(&mut self, array: Ssa) -> Ssa {
        let storage = self.storage(array);
        if ModeSet::DENSE.contains(self.knowledge.modes_of(&self.graph, array)) {
            let length = self.dense_length(storage);
            return self.box_int32(length);
        }
        let length = self.public_length(storage);
        if self.has_exited(ExitKind::OutOfBounds) {
            let length = self.ir().zero_extend(length);
            return self.box_size(length, true);
        }
        let limit = self.int32(Storage::MAX_VECTOR_LENGTH as i32 + 1);
        let length = self.check_bounds(length, limit);
        let length = self.at_most(length, Storage::MAX_VECTOR_LENGTH);
        self.box_int32(length)
    }

    fn has_length_property(&mut self, arguments: Ssa) -> Ssa {
        if self.has_shape_as_made(arguments) {
            return self.int32(0);
        }
        let (mut ir, offset) = (self.ir(), JsCell::OFFSET_OF_FLAGS as i32);
        let flags = ir.load_narrow(Size::S8, Sign::Unsigned, arguments, offset, heaps::SHAPE);
        ir.and(flags, TypeFlags::PER_CELL_BIT.bits())
    }

    fn length_of_arguments(&mut self, access: &mut Access, arguments: Ssa) -> Ssa {
        let is_property = self.has_length_property(arguments);
        self.bail_if(access, is_property, ExitKind::ArgumentsEscaped, false);
        self.load_immutable(Type::I32, arguments, MappedArguments::OFFSET_OF_LENGTH)
    }

    /// Of a cell whose shape has been checked.
    pub(in crate::builder) fn count(&mut self, cell: Ssa, what: AccessKind) -> Ssa {
        let count = match what {
            AccessKind::StringLength => self.string_length(cell),
            AccessKind::CollectionSize => self.size_of_collection(cell),
            AccessKind::ArgumentsLength => {
                let is_property = self.has_length_property(cell);
                self.exit_if(is_property, ExitKind::ExoticObject);
                self.load_immutable(Type::I32, cell, MappedArguments::OFFSET_OF_LENGTH)
            }
            _ => return self.length_of_array(cell),
        };
        self.box_int32(count)
    }

    pub(in crate::builder) fn may_set_length(&self) -> bool {
        !self.has_exited(ExitKind::NotAnInteger) && !self.has_exited(ExitKind::OutOfBounds)
    }

    /// The elements are dense and can be written to.
    pub(in crate::builder) fn set_length(&mut self, array: Ssa, kind: ElementKind, length: Ssa) {
        let (length, storage) = (self.as_index(length), self.storage(array));
        self.node(Kind::SetLength, &[array, storage, length], kind as u32);
        let (root, offset) = (self.graph.root(array), Storage::OFFSET_OF_PUBLIC_LENGTH);
        (self.knowledge).learn_field(root, offset as i32, heaps::PUBLIC_LENGTH, length);
    }
}
