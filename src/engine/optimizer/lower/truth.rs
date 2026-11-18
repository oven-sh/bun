//! Questions about one value of any type. What is expected is answered in line, and the rest out of the way.

use bun_engine_asm::FloatCond;
use bun_engine_codegen::ir::{Access, AccessFlags, Type, Value as Ssa};
use bun_engine_text::StringImpl;
use bun_engine_vm::{CellType, JsBigInt, JsCell, SpeculatedType as T, TypeFlags, Value};

use super::ways::Meeting;
use super::{Lowering, Odds};
use crate::graph::{TypeCheck, TypeName, heaps};
use crate::runtime::{operations, operators};

const OTHERS: T = T::BOOLEAN.union(T::NULLISH);
const TRUTHY: T = T::CELL.difference(T::STRING).difference(T::BIGINT);

/// That a value is `wanted`, given what else is expected of it.
fn odds_of(wanted: T, expected: T) -> Odds {
    if !wanted.intersects(expected) {
        Odds::Low
    } else if wanted.contains(expected) {
        Odds::High
    } else {
        Odds::Even
    }
}

/// What a value can still be, and what of that is expected.
#[derive(Clone, Copy)]
pub(super) struct Left {
    pub(super) known: T,
    pub(super) expected: T,
}

impl Left {
    pub(super) fn of(check: TypeCheck) -> Self {
        let known = check.known & T::HEAP_TOP;
        let expected = check.wanted & known;
        Self { known, expected }
    }

    pub(super) fn only(self, ty: T) -> Self {
        Self {
            known: self.known & ty,
            expected: self.expected & ty,
        }
    }

    pub(super) fn odds_of(self, ty: T) -> Odds {
        odds_of(ty, self.expected)
    }
}

impl Lowering<'_> {
    /// The result is what `then` gives if the value is of the type, which it is not from here on. Returns true if
    /// nothing is left.
    pub(super) fn give_for(
        &mut self,
        meeting: Meeting,
        value: Ssa,
        left: &mut Left,
        ty: T,
        then: impl FnOnce(&mut Self, Left) -> Ssa,
    ) -> bool {
        let part = left.only(ty);
        if part.known == left.known {
            let given = then(self, part);
            self.give(meeting, given);
            return true;
        }
        if !part.known.is_empty() {
            let holds = self.has_type(value, part.known, left.known);
            self.give_if(meeting, holds, left.odds_of(ty), |this| then(this, part));
            *left = left.only(!ty);
        }
        false
    }

    fn any_to_boolean(&mut self, value: Ssa) -> Ssa {
        let global = self.global();
        self.call_leaf(operations::TO_BOOLEAN, &[global, value], Type::I32)
    }

    pub(super) fn has_flag(&mut self, cell: Ssa, flags: TypeFlags) -> Ssa {
        let found = self.load_byte(cell, JsCell::OFFSET_OF_FLAGS, heaps::SHAPE);
        let common = self.ir().and(found, flags.bits() as i32);
        self.ir().is_not_zero(common)
    }

    /// No rope is empty.
    fn has_characters(&mut self, string: Ssa) -> Ssa {
        let fiber = self.fiber(string);
        let is_rope = self.is_rope(fiber);
        let of_flat = |this: &mut Self| {
            let (offset, heap) = (StringImpl::OFFSET_OF_LENGTH, heaps::STRING_FIBER);
            let length = this.load(Type::I32, fiber, offset, heap);
            this.ir().is_not_zero(length)
        };
        self.choose(is_rope, Odds::Low, Type::I32, |this| this.int32(1), of_flat)
    }

    fn cell_to_boolean(&mut self, cell: Ssa, mut left: Left) -> Ssa {
        let meeting = self.part(Type::I32);
        let is_done = left.expected.intersects(T::STRING)
            && self.give_for(meeting, cell, &mut left, T::STRING, |this, _| {
                this.has_characters(cell)
            });
        if is_done {
            return self.meet(meeting);
        }
        let given = if TRUTHY.contains(left.known) {
            self.int32(1)
        } else {
            if left.known.intersects(TRUTHY) {
                let cell_type = self.cell_type(cell);
                let is_truthy = self.ir().above(cell_type, i32::from(CellType::BigInt.0));
                self.answer_if(meeting, is_truthy, left.odds_of(TRUTHY), true);
            }
            if left.known.intersects(T::STRING) {
                self.any_to_boolean(cell)
            } else {
                let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
                let offset = JsBigInt::OFFSET_OF_LENGTH as i32;
                let digits = self.ir().load(Type::I32, cell, offset, access);
                self.ir().is_not_zero(digits)
            }
        };
        self.give(meeting, given);
        self.meet(meeting)
    }

    fn part_to_boolean(&mut self, value: Ssa, ty: T, left: Left) -> Ssa {
        match ty {
            T::CELL => self.cell_to_boolean(value, left),
            T::INT32 => {
                let int32 = self.ir().wrap(value);
                self.ir().is_not_zero(int32)
            }
            OTHERS if T::NULLISH.contains(left.known) => self.int32(0),
            OTHERS => self.ir().equal(value, Value::TRUE.to_bits()),
            _ => {
                let (double, zero) = (self.untag_double(value), self.graph.function.const_f64(0.0));
                self.ir().float_compare(FloatCond::Ne, double, zero)
            }
        }
    }

    /// No object poses as undefined.
    pub(super) fn plain_to_boolean(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        const PARTS: [T; 4] = [T::CELL, T::INT32, OTHERS, T::BOXED_DOUBLE];
        let (meeting, mut left) = (self.part(Type::I32), Left::of(check));
        for ty in PARTS {
            if left.expected.intersects(ty)
                && self.give_for(meeting, value, &mut left, ty, |this, left| {
                    this.part_to_boolean(value, ty, left)
                })
            {
                return self.meet(meeting);
            }
        }
        let given = match PARTS[1..].iter().find(|ty| ty.contains(left.known)) {
            Some(&ty) => self.part_to_boolean(value, ty, left),
            None => self.any_to_boolean(value),
        };
        self.give(meeting, given);
        self.meet(meeting)
    }

    pub(super) fn generic_to_boolean(&mut self, value: Ssa) -> Ssa {
        let is_other = (self.ir()).below_or_equal(value, Value::UNDEFINED.to_bits());
        self.choose(
            is_other,
            Odds::Even,
            Type::I32,
            |this| this.ir().equal(value, Value::TRUE.to_bits()),
            |this| this.any_to_boolean(value),
        )
    }

    pub(super) fn generic_equal_null(&mut self, value: Ssa) -> Ssa {
        let global = self.global();
        self.call_leaf(operations::EQUAL_NULL, &[global, value], Type::I32)
    }

    fn is_cell_callable(&mut self, cell: Ssa, left: Left) -> Ssa {
        let meeting = self.part(Type::I32);
        let cell_type = self.cell_type(cell);
        let (first, last) = (CellType::FUNCTIONS.first.0, CellType::FUNCTIONS.last.0);
        let distance = self.ir().sub(cell_type, i32::from(first));
        let is_function = (self.ir()).below_or_equal(distance, i32::from(last - first));
        let odds = left.odds_of(T::FUNCTION | T::OTHER_OBJECT);
        self.answer_if(meeting, is_function, odds, true);
        let may_be = self.has_flag(cell, TypeFlags::OVERRIDES_CALL_DATA);
        self.give_if(meeting, may_be, Odds::Low, |this| {
            this.call_leaf(operators::IS_CALLABLE, &[cell], Type::I32)
        });
        let no = self.int32(0);
        self.give(meeting, no);
        self.meet(meeting)
    }

    pub(super) fn is_callable(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        let (meeting, mut left) = (self.part(Type::I32), Left::of(check));
        let of_cell = |this: &mut Self, left| this.is_cell_callable(value, left);
        if !self.give_for(meeting, value, &mut left, T::CELL, of_cell) {
            let no = self.int32(0);
            self.give(meeting, no);
        }
        self.meet(meeting)
    }

    pub(super) fn has_object_type_name(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        let (meeting, mut left) = (self.part(Type::I32), Left::of(check));
        let of_object = |this: &mut Self, left| {
            let is_callable = this.is_cell_callable(value, left);
            let (no, yes) = (|it: &mut Self| it.int32(0), |it: &mut Self| it.int32(1));
            this.choose(is_callable, Odds::Even, Type::I32, no, yes)
        };
        let of_cell = |this: &mut Self, mut left| {
            let meeting = this.part(Type::I32);
            if !this.give_for(meeting, value, &mut left, T::OBJECT, of_object) {
                let no = this.int32(0);
                this.give(meeting, no);
            }
            this.meet(meeting)
        };
        if !self.give_for(meeting, value, &mut left, T::CELL, of_cell) {
            let is_null = self.has_type(value, T::NULL, left.known);
            self.give(meeting, is_null);
        }
        self.meet(meeting)
    }

    pub(super) fn generic_typeof(&mut self, value: Ssa) -> Ssa {
        let global = self.global();
        self.call_leaf(operators::TYPE_OF, &[global, value], Type::I64)
    }

    fn type_name(&mut self, name: TypeName) -> Ssa {
        self.word(self.graph.type_names[name as usize])
    }

    fn type_name_of_object(&mut self, object: Ssa, left: Left) -> Ssa {
        if !left.known.intersects(TypeName::MAY_BE_CALLABLE) {
            return self.type_name(TypeName::Object);
        }
        let is_callable = self.is_cell_callable(object, left);
        self.choose(
            is_callable,
            Odds::Even,
            Type::I64,
            |this| this.type_name(TypeName::Function),
            |this| this.type_name(TypeName::Object),
        )
    }

    fn type_name_among(&mut self, value: Ssa, mut left: Left, names: &[(T, TypeName)]) -> Ssa {
        let meeting = self.part(Type::I64);
        let expected = left.expected;
        let (likely, unlikely) = (
            names.iter().filter(|it| it.0.intersects(expected)),
            names.iter().filter(|it| !it.0.intersects(expected)),
        );
        let is_done = likely.chain(unlikely).any(|&(ty, name)| {
            self.give_for(meeting, value, &mut left, ty, |this, left| match ty {
                T::OBJECT => this.type_name_of_object(value, left),
                _ => this.type_name(name),
            })
        });
        assert!(is_done);
        self.meet(meeting)
    }

    /// No object poses as undefined.
    pub(super) fn plain_typeof(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        const OF_CELLS: [(T, TypeName); 4] = [
            (T::STRING, TypeName::String),
            (T::OBJECT, TypeName::Object),
            (T::SYMBOL, TypeName::Symbol),
            (T::BIGINT, TypeName::BigInt),
        ];
        const OF_OTHERS: [(T, TypeName); 4] = [
            (T::BOXED_NUMBER, TypeName::Number),
            (T::UNDEFINED, TypeName::Undefined),
            (T::BOOLEAN, TypeName::Boolean),
            (T::NULL, TypeName::Object),
        ];
        let (meeting, mut left) = (self.part(Type::I64), Left::of(check).only(!T::OTHER_CELL));
        let of_cell = |this: &mut Self, left| this.type_name_among(value, left, &OF_CELLS);
        if !self.give_for(meeting, value, &mut left, T::CELL, of_cell) {
            let name = self.type_name_among(value, left, &OF_OTHERS);
            self.give(meeting, name);
        }
        self.meet(meeting)
    }
}
