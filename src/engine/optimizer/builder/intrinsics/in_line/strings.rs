use bun_engine_codegen::ir::{Heap, Type, Value as Ssa};
use bun_engine_vm::direct::Form;
use bun_engine_vm::{
    Gc, GlobalObject, JsObject, JsStringIterator, JsWrapperObject, RealmSlot, SpeculatedType as T,
    StringObject, Value,
};

use super::Checked;
use crate::builder::Builder;
use crate::builder::fork::Odds;
use crate::builder::frame::Junction;
use crate::builder::iteration::internal_field;
use crate::graph::{ExitKind, Kind, heaps};

const INTERNAL_VALUE: usize = JsWrapperObject::OFFSET_OF_INTERNAL_VALUE;
const INDEX: i32 = internal_field(JsStringIterator::INDEX);
const ITERATED_STRING: i32 = internal_field(JsStringIterator::ITERATED_STRING);

impl Builder<'_> {
    pub(super) fn string_in_line(&mut self, call: Checked<'_>) -> Option<Ssa> {
        use Form::*;
        Some(match (call.form, call.passed) {
            (char_code_at_in_characters | char_code_at, &[string, index]) => {
                let code = |this: &mut Self, unit| this.box_int32(unit);
                self.at_index(call, [string, index], Kind::StringUnitAt, code, Value::NAN)
            }
            (code_point_at_in_characters | code_point_at, &[string, index]) => {
                let (kind, code) = (Kind::StringCodePointAt, |this: &mut Self, it| {
                    this.box_int32(it)
                });
                self.at_index(call, [string, index], kind, code, Value::UNDEFINED)
            }
            (char_at, &[string, index]) => {
                let empty = self.vm.small_strings.empty().into();
                self.at_index(
                    call,
                    [string, index],
                    Kind::StringUnitAt,
                    Self::string_of_unit,
                    empty,
                )
            }
            (at, &[string, position]) => {
                let (index, kind) = (
                    self.index_from_either_end(string, position),
                    Kind::StringUnitAt,
                );
                self.at_index(
                    call,
                    [string, index],
                    kind,
                    Self::string_of_unit,
                    Value::UNDEFINED,
                )
            }
            (from_char_code, &[code]) => {
                let unit = self.ir().and(code, i32::from(u16::MAX));
                self.string_of_unit(unit)
            }
            (string_of_int32 | int32_to_string, &[int32, ..]) => {
                self.node(Kind::Int32ToString, &[int32], 0)
            }
            (string_of_number | number_to_string, &[number, ..]) => {
                self.node(Kind::DoubleToString, &[number], 0)
            }
            (this_string_object | string_of_string_object, &[object]) => self.string_in(object),
            (new_string_object, &[string]) => {
                let slot = RealmSlot::string_object_shape;
                let object = self.new_instance_of::<StringObject>(call.realm, slot);
                let (offset, string) = (INTERNAL_VALUE as i32, self.graph.root(string));
                self.initialize(object, offset, heaps::OTHER_FIELDS, string);
                (self.knowledge).learn_field(object, offset, Heap::NOTHING, string);
                object
            }
            (string_iterator, &[string]) => {
                let slot = RealmSlot::string_iterator_shape;
                let iterator = self.new_instance_of::<JsStringIterator>(call.realm, slot);
                let (start, string) = (self.value(Value::ZERO), self.graph.root(string));
                self.initialize(iterator, INDEX, heaps::INTERNAL_FIELDS, start);
                self.initialize(iterator, ITERATED_STRING, heaps::INTERNAL_FIELDS, string);
                iterator
            }
            (string_iterator_next, &[iterator]) => self.next_code_point(iterator, call.realm),
            _ => return None,
        })
    }

    fn string_of_unit(&mut self, unit: Ssa) -> Ssa {
        self.node(Kind::StringFromUnit, &[unit], 0)
    }

    /// Of a `StringObject`.
    pub(in crate::builder::intrinsics) fn string_in(&mut self, object: Ssa) -> Ssa {
        let string = self.load_immutable(Type::I64, object, INTERNAL_VALUE);
        if self.graph.prediction(string).is_empty() {
            self.graph.predict(string, T::STRING);
        }
        self.assume_type(string, T::STRING);
        string
    }

    fn index_from_either_end(&mut self, string: Ssa, position: Ssa) -> Ssa {
        let constant = self.graph.function.int_constant(position);
        if constant.is_some_and(|it| it >= 0) {
            return position;
        }
        let length = self.string_length(string);
        let mut ir = self.ir();
        let (is_negative, from_end) = (ir.less_than(position, 0), ir.add(length, position));
        ir.select(is_negative, from_end, position)
    }

    /// What `finish` makes of what the node finds there, or `outside`.
    fn at_index(
        &mut self,
        call: Checked<'_>,
        [string, index]: [Ssa; 2],
        kind: Kind,
        finish: impl Fn(&mut Self, Ssa) -> Ssa,
        outside: Value,
    ) -> Ssa {
        if self.graph.function.is_int_constant(index, 0)
            && let Some(unit) = self.only_unit(string)
        {
            return finish(self, unit);
        }
        let length = self.string_length(string);
        let inside = |this: &mut Self, index| {
            let string = this.resolve_rope(string);
            let found = this.node(kind, &[string, index], 0);
            finish(this, found)
        };
        let was_outside = !outside.is_cell() && call.seen.contains(T::of(Some(outside)));
        if !was_outside && !self.has_exited(ExitKind::OutOfBounds) {
            let index = self.check_bounds(index, length);
            return inside(self, index);
        }
        let is_outside = self.ir().above_or_equal(index, length);
        let result = self.choose(is_outside, Odds::Low, |this, is_outside| {
            Some(if is_outside {
                this.value(outside)
            } else {
                let index = this.node(Kind::InBounds, &[index], 0);
                inside(this, index)
            })
        });
        result.expect("nothing ends")
    }

    fn next_code_point(&mut self, iterator: Ssa, realm: Gc<GlobalObject>) -> Ssa {
        let heap = heaps::INTERNAL_FIELDS;
        let index = self.load_value_of_type((iterator, INDEX, heap), T::INT32, T::INT32);
        let string =
            self.load_value_of_type((iterator, ITERATED_STRING, heap), T::STRING, T::STRING);
        let (index, fork) = (self.as_int32(index), self.fork_later());
        let (mut end, mut stepped) = (Junction::default(), Junction::default());
        let (value, length) = self.code_point_string(string, index, &mut end);
        let next = self.ir().add(index, length);
        let (next, no) = (self.box_int32(next), self.value(Value::FALSE));
        self.leave_with_values(&mut stepped, &[value, no, next]);
        if !end.edges.is_empty() {
            self.resume_at(&fork, &end);
            let ended = [Value::UNDEFINED, Value::TRUE, Value::int32(-1)].map(|it| self.value(it));
            self.leave_with_values(&mut stepped, &ended);
        }
        self.resume_at(&fork, &stepped);
        let [value, is_done, next] = stepped.values[..] else {
            unreachable!("three were passed")
        };
        let result = self.new_iterator_result(realm, value, is_done);
        let iterator = self.alias(iterator);
        self.store_value(iterator, iterator, INDEX, heap, next);
        result
    }

    /// CreateIteratorResultObject
    fn new_iterator_result(&mut self, realm: Gc<GlobalObject>, value: Ssa, is_done: Ssa) -> Ssa {
        use bun_engine_text::names;
        let allocation = self.final_object_allocation(realm.iterator_result_shape(self.vm));
        let result = self.new_final_object(allocation.expect("small"));
        let offsets = (size_of::<JsObject>() as i32..).step_by(size_of::<u64>());
        for ((name, it), offset) in [(names::value, value), (names::done, is_done)]
            .into_iter()
            .zip(offsets)
        {
            let (heap, it) = (self.named_heap(name), self.graph.root(it));
            self.initialize(result, offset, heap, it);
        }
        result
    }
}
