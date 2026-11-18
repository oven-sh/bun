//! Conversions, and putting strings together.

use bun_engine_bytecode::{Operand, Register, op};
use bun_engine_codegen::ir::{Heap, Value as Ssa};
use bun_engine_text::StringRef;
use bun_engine_vm::{JsRopeString, JsString, SpeculatedType as T};
use smallvec::SmallVec;

use super::Builder;
use crate::graph::{Conversion, ExitKind, Kind};

const MOST_FIBERS: usize = 3;

impl Builder<'_> {
    fn string_of_constant(&mut self, value: Ssa) -> Option<Ssa> {
        let constant = self.constant_value(value).filter(|it| !it.is_cell())?;
        let string = JsString::from_immediate(self.vm, constant);
        self.dependencies.keep(string.cell());
        Some(self.cell(string.cell()))
    }

    /// Exits if it is an object.
    pub(super) fn primitive_to_string(&mut self, value: Ssa, likely: T) -> Ssa {
        if self.is(value, T::STRING) {
            return self.alias(value);
        }
        self.string_of_constant(value).unwrap_or_else(|| {
            let (root, data) = (self.graph.root(value), self.graph.intern_type(likely));
            self.node(Kind::ToString, &[root], data)
        })
    }

    /// Of a string that is certain to have just one.
    pub(super) fn only_unit(&mut self, value: Ssa) -> Option<Ssa> {
        let made_from = (self.graph).inside(self.graph.root(value), Kind::StringFromUnit);
        made_from.or_else(|| {
            let text = (self.graph.text_of_constant(value)).filter(|it| it.length == 1)?;
            Some(self.int32(text.first_unit?.into()))
        })
    }

    pub(super) fn string_length(&mut self, string: Ssa) -> Ssa {
        /// In place of an offset.
        const LENGTH: i32 = -1;
        let root = self.graph.root(string);
        if let Some(text) = self.graph.text_of_constant(root) {
            return self.int32(text.length as i32);
        }
        if self.graph.kind(root) == Some(Kind::StringFromUnit) {
            return self.int32(1);
        }
        (self.knowledge.field(root, LENGTH, Heap::NOTHING)).unwrap_or_else(|| {
            let length = self.node(Kind::StringLength, &[string], 0);
            (self.knowledge).learn_field(root, LENGTH, Heap::NOTHING, length);
            length
        })
    }

    fn join_constants(&mut self, first: Ssa, second: Ssa) -> Option<Ssa> {
        const LONGEST: u32 = 1000;
        let [first, second] = [first, second].map(|it| self.constant_cell::<JsString>(it));
        let [first, second] = [first?.try_view()?, second?.try_view()?];
        if first.text().len() + second.text().len() > LONGEST as usize {
            return None;
        }
        let both = StringRef::try_concat(&[first.text(), second.text()]).ok()?;
        let both = JsString::new(self.vm, both);
        self.dependencies.keep(both.cell());
        Some(self.cell(both.cell()))
    }

    pub(super) fn prepare_for_ropes(&mut self) {
        if self.graph.rope_allocation.is_none() {
            let (shape, allocator) = (
                self.vm.shapes.string(),
                &self.vm.heap.rope_strings.allocator,
            );
            let allocation = self.allocation_from(allocator, shape, size_of::<JsRopeString>());
            self.graph.rope_allocation = Some(allocation);
        }
    }

    fn rope_of(&mut self, fibers: &[Ssa]) -> Ssa {
        self.prepare_for_ropes();
        self.node(Kind::Concatenate, fibers, 0)
    }

    /// Of values with what they are likely to be. Exits if there is an object among them.
    pub(super) fn concatenate(&mut self, values: impl Iterator<Item = (Ssa, T)>) -> Ssa {
        let mut fibers: SmallVec<[Ssa; MOST_FIBERS]> = SmallVec::new();
        for (value, likely) in values {
            let string = self.primitive_to_string(value, likely);
            if (self.graph.text_of_constant(string)).is_some_and(|it| it.length == 0) {
                continue;
            }
            if let Some(last) = fibers.last_mut()
                && let Some(both) = self.join_constants(*last, string)
            {
                *last = both;
                continue;
            }
            if fibers.len() == MOST_FIBERS {
                let so_far = self.rope_of(&fibers);
                fibers.clear();
                fibers.push(so_far);
            }
            fibers.push(string);
        }
        match fibers[..] {
            [] => self.cell(self.vm.small_strings.empty().cell()),
            [only] => only,
            _ => self.rope_of(&fibers),
        }
    }

    pub(super) fn concatenate_run(&mut self, op: op::Concatenate) {
        let values: SmallVec<[Ssa; 8]> = (0..op.count)
            .map(|index| self.get(op.first.nth(index)))
            .collect();
        for &value in &values {
            self.assume_type(value, Conversion::ToPrimitive.fixed());
        }
        let result = self.concatenate(values.into_iter().map(|it| (it, T::empty())));
        self.set(op.dst, result);
    }

    pub(super) fn convert(&mut self, conversion: Conversion, dst: Register, value: Operand) {
        let (value, fixed) = (self.get_value(value), conversion.fixed());
        let expected = self.expected(value);
        let result = if self.is(value, fixed) {
            value
        } else if conversion == Conversion::ToString && self.may_be_primitive(value, expected) {
            self.primitive_to_string(value, expected)
        } else if fixed.contains(expected) && !self.has_exited(ExitKind::Inconvertible) {
            self.check_type_or(value, fixed, ExitKind::Inconvertible)
        } else if conversion == Conversion::ToPropertyKey
            && !expected.intersects(T::OBJECT | T::SYMBOL)
            && !self.has_exited(ExitKind::ExoticObject)
        {
            self.check_type_or(value, !T::SYMBOL, ExitKind::ExoticObject);
            self.primitive_to_string(value, expected)
        } else {
            let alias = self.alias(value);
            let result = self.node(Kind::Convert, &[alias], conversion as u32);
            self.graph.declare(result, fixed);
            self.graph.predict(result, expected & fixed | T::STRING);
            result
        };
        self.set(dst, result);
    }

    pub(super) fn to_object(&mut self, op: op::ToObject) {
        let value = self.get_value(op.value);
        let result = if self.is(value, T::OBJECT)
            || T::OBJECT.contains(self.expected(value)) && !self.has_exited(ExitKind::BadType)
        {
            self.check_type(value, T::OBJECT)
        } else {
            let Some(prediction) = self.prediction_or_exit(op.metadata) else {
                return;
            };
            let message = self.frame().code_block.identifier(op.message).address();
            let operands = [self.alias(value), self.word(message)];
            self.profiled_node(Kind::ToObject, &operands, 0, prediction & T::OBJECT)
        };
        self.set(op.dst, result);
    }

    pub(super) fn to_this(&mut self, op: op::ToThis) {
        let value = self.get_value(op.this);
        let (ordinary, expected) = (T::OBJECT - T::OTHER_OBJECT, self.expected(value));
        let expects = |ty: T| {
            self.is(value, ty) || ty.contains(expected) && !self.has_exited(ExitKind::BadType)
        };
        let of_constant = (self.constant_value(value)).and_then(|it| it.as_object());
        if expects(ordinary) {
            self.check_type(value, ordinary);
            return;
        }
        if of_constant.is_some_and(|it| !it.is::<bun_engine_vm::GlobalObject>()) {
            return;
        }
        let is_nullish = expects(T::NULLISH);
        let global_this = self.cell(self.global().global_this().cell());
        if is_nullish {
            self.check_type(value, T::NULLISH);
            return self.set(op.this, global_this);
        }
        let seen = self.prediction_at(op.metadata) & T::OBJECT | expected & T::OBJECT;
        let operands = [self.alias(value), global_this];
        let this = self.profiled_node(Kind::ToThis, &operands, 0, seen);
        self.set(op.this, this);
    }
}
