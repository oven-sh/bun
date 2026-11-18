//! Tests of the types of references.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{Access, AccessFlags, Heap, Type, Value};
use bun_engine_wasm_format::{HeapType, RefType, Rtt, TypeIndex, ValType};

use super::control::{Target, Way};
use super::references::Fact;
use super::translator::{Operand, Translator};
use crate::abi::{Callable, INT32_TAG, InstanceLayout, NULL, ObjectType, Trap, object};
use crate::cast::{Cast, Check, NOT_CELL_MASK, Null, ObjectCheck, RttCheck, Source};

/// What a condition tells about a reference.
#[derive(Clone, Copy)]
pub(super) struct Test {
    condition: Value,
    if_holds: Operand,
    otherwise: Operand,
}

impl Test {
    pub(super) fn outcome(self, holds: bool) -> Operand {
        if holds { self.if_holds } else { self.otherwise }
    }
}

impl Translator<'_> {
    pub(super) fn note_test(
        &mut self,
        condition: Value,
        operand: Operand,
        if_holds: ValType,
        otherwise: ValType,
    ) {
        let with = |ty| Operand { ty, ..operand };
        self.last_test = (!self.b.op(condition).is_constant()).then(|| Test {
            condition,
            if_holds: with(if_holds),
            otherwise: with(otherwise),
        });
    }

    pub(super) fn note_negation(&mut self, condition: Value, negated: Value) {
        if let Some(test) = self.test_behind(condition) {
            let (if_holds, otherwise) = (test.otherwise, test.if_holds);
            self.note_test(negated, if_holds, if_holds.ty, otherwise.ty);
        }
    }

    #[inline]
    pub(super) fn test_behind(&self, condition: Value) -> Option<Test> {
        (self.last_test).filter(|test| test.condition == condition)
    }

    /// Returns whether the check holds. `fail_if` leaves, so that what follows can be read. The `Rtt` lives as long as
    /// `owner`.
    pub(super) fn check_rtt(
        &mut self,
        rtt: Value,
        owner: Value,
        check: RttCheck,
        fail_if: impl FnOnce(&mut Self, Value),
    ) -> Value {
        let load = |this: &mut Self, ty, address, offset| {
            let loaded = this.load_immutable(ty, address, offset);
            this.keep_alive(owner, Some(loaded));
            loaded
        };
        match check {
            RttCheck::Is { expected } => self.b.equal(rtt, expected),
            RttCheck::InlineEntryIs { offset, expected } => {
                let entry = load(self, Type::I64, rtt, offset);
                self.b.equal(entry, expected)
            }
            RttCheck::LongEntryIs { depth, expected } => {
                let actual = load(self, Type::I32, rtt, Rtt::DEPTH_OFFSET);
                let is_shallow = self.b.below(actual, depth);
                fail_if(self, is_shallow);
                let display = self.load_immutable(Type::I64, rtt, Rtt::LONG_DISPLAY_OFFSET);
                let entry = load(self, Type::I64, display, depth as i32 * 8);
                self.b.equal(entry, expected)
            }
        }
    }

    /// The type that the value has, and none below it. That of an operand is no more than a bound.
    fn exact_type(&self, value: Value) -> Option<HeapType> {
        if let Some(bits) = self.b.constant_bits(value) {
            // The only reference constants are a null and a tagged `i31`.
            return (bits >= INT32_TAG).then_some(HeapType::I31);
        }
        let ty = match self.facts.of(value)? {
            Fact::NewStruct(ty) | Fact::NewArray { ty, .. } => ty,
            Fact::Function(func) => {
                // An import is only declared: what it is given can be below its type.
                self.module.code_index(func)?;
                self.module.func_type_index(func)
            }
        };
        Some(self.types.heap_type(ty))
    }

    fn pop_for_cast(&mut self, to: RefType) -> (Operand, Cast) {
        let operand = self.pop();
        let from = operand.reference_type();
        let is_below = |exact, bound: RefType| self.types.is_heap_subtype(exact, bound.heap_type());
        let exact = self.exact_type(operand.value);
        let Some(exact) = exact.filter(|&exact| is_below(exact, from)) else {
            return (operand, Cast::new(self.types, from, to));
        };
        let check = match is_below(exact, to) {
            true => Check::Passes,
            false => Check::Fails,
        };
        let (ty, null) = (exact.non_null().into(), Null::Impossible);
        (Operand { ty, ..operand }, Cast { null, check })
    }

    fn function_rtt(&self) -> i32 {
        self.env.host.function_callable + Callable::RTT
    }

    fn load_immutable_byte(&mut self, address: Value, offset: i32) -> Value {
        let access = Access::new(Heap::NOTHING, AccessFlags::IMMUTABLE);
        (self.b).load_narrow(Size::S8, Sign::Unsigned, address, offset, access)
    }

    fn is_object(&mut self, cell: Value) -> Value {
        let kind = self.load_immutable_byte(cell, self.env.host.cell_kind);
        self.b.equal(kind, i32::from(self.env.host.object_kind))
    }

    fn is_number_of(&mut self, number: Value, ty: TypeIndex) -> Value {
        let header = self.env.layout.object_header(ty);
        let expected = self.load_fixed(Type::I32, self.instance, header);
        self.b.equal(number, expected)
    }

    fn object_type(&mut self, number: Value) -> Value {
        let types = InstanceLayout::object_types(self.env.host);
        let types = self.load_fixed(Type::I64, self.instance, types);
        let number = self.b.zero_extend(number);
        self.b.add(types, number)
    }

    fn is_no_cell(&mut self, source: Source, value: Value) -> Value {
        match source {
            Source::Any => self.b.and(value, NOT_CELL_MASK),
            Source::Eq => self.b.less_than(value, 0),
            Source::Object => self.b.const32(0),
        }
    }

    /// Returns whether the value has the type. `leave_if` leaves with an outcome if a condition settles it early.
    fn decide_cast(
        &mut self,
        cast: Cast,
        value: Value,
        type_flags: AccessFlags,
        mut leave_if: impl FnMut(&mut Self, Value, bool),
    ) -> Value {
        if self.b.is_int_constant(value, NULL.into()) {
            return self.b.boolean(cast.null == Null::Passes);
        }
        match (cast.null, cast.check) {
            (Null::Passes, Check::Fails) => return self.b.equal(value, NULL),
            (Null::Fails, Check::Passes) => return self.b.not_equal(value, NULL),
            (Null::Impossible, _)
            | (_, Check::Passes)
            | (
                Null::Fails,
                Check::Fails | Check::IsI31(_) | Check::IsEq | Check::IsObject(Source::Any, _),
            ) => {}
            (null, _) => {
                let is_null = self.b.equal(value, NULL);
                leave_if(self, is_null, null == Null::Passes);
            }
        }
        let type_access = Access::new(Heap::NOTHING, AccessFlags::IMMUTABLE | type_flags);
        match cast.check {
            Check::Passes => self.b.boolean(true),
            Check::Fails => self.b.boolean(false),
            Check::IsI31(Source::Any) => self.b.above_or_equal(value, INT32_TAG),
            Check::IsI31(_) => self.b.less_than(value, 0),
            Check::IsEq => {
                let is_i31 = self.b.above_or_equal(value, INT32_TAG);
                leave_if(self, is_i31, true);
                let is_no_cell = self.is_no_cell(Source::Any, value);
                leave_if(self, is_no_cell, false);
                self.is_object(value)
            }
            Check::IsObject(source, check) => {
                let is_no_cell = self.is_no_cell(source, value);
                leave_if(self, is_no_cell, false);
                if source == Source::Any && !matches!(check, ObjectCheck::Is { .. }) {
                    let is_object = self.is_object(value);
                    let is_other = self.b.is_zero(is_object);
                    leave_if(self, is_other, false);
                }
                let number = (self.b).load(Type::I32, value, object::TYPE_NUMBER, type_access);
                match check {
                    ObjectCheck::Is { expected } => self.is_number_of(number, expected),
                    ObjectCheck::EntryIs { offset, expected } => {
                        let actual = self.object_type(number);
                        let entry = self.load_immutable(Type::I32, actual, offset);
                        self.is_number_of(entry, expected)
                    }
                    ObjectCheck::Rtt(check) => {
                        let actual = self.object_type(number);
                        let rtt = self.load_immutable(Type::I64, actual, ObjectType::RTT);
                        self.check_rtt(rtt, value, check, |this, fails| {
                            leave_if(this, fails, false)
                        })
                    }
                    ObjectCheck::KindIs(expected) => {
                        let actual = self.object_type(number);
                        let kind = self.load_immutable_byte(actual, ObjectType::KIND);
                        self.b.equal(kind, expected as i32)
                    }
                }
            }
            Check::IsFunction(check) => {
                let rtt = (self.b).load(Type::I64, value, self.function_rtt(), type_access);
                self.check_rtt(rtt, value, check, |this, fails| {
                    leave_if(this, fails, false)
                })
            }
        }
    }

    /// With the values on top of the stack.
    fn leave_for(&mut self, target: Target, condition: Value, count: usize) -> Target {
        if self.b.is_int_constant(condition, 0) {
            return target;
        }
        self.unused_comparison = Value::NONE;
        let stays = self.b.is_zero(condition);
        let edge = self.fork(stays, None);
        self.arrive(target, Way::Edge(edge), count)
    }

    fn after_cast(cast: Cast, operand: Operand, to: RefType) -> Operand {
        let from = operand.reference_type();
        let heap_type = match cast.check {
            Check::Passes => from.heap_type(),
            Check::Fails => HeapType::of(from.heap_type().abstract_type().bottom()),
            _ => to.heap_type(),
        };
        let ty = RefType::new(heap_type, from.is_nullable() && to.is_nullable()).into();
        Operand { ty, ..operand }
    }

    fn after_failed_cast(operand: Operand, to: RefType) -> Operand {
        if to.is_nullable() {
            operand.non_null()
        } else {
            operand
        }
    }

    pub(super) fn test_type(&mut self, to: RefType) {
        let (operand, cast) = self.pop_for_cast(to);
        let mut done = Target::UNREACHED;
        let flags = AccessFlags::empty();
        let holds = self.decide_cast(cast, operand.value, flags, |this, condition, outcome| {
            let outcome = this.b.boolean(outcome);
            this.push(outcome, ValType::I32);
            done = this.leave_for(done, condition, 1);
            this.pop();
        });
        self.push_comparison(holds);
        if done.is_reached() {
            done = self.arrive(done, self.here(), 1);
            self.pop();
            self.meet(done, &[ValType::I32]);
        }
        let result = self.stack[self.stack.len() - 1].value;
        let if_holds = Self::after_cast(cast, operand, to).ty;
        let otherwise = Self::after_failed_cast(operand, to).ty;
        self.note_test(result, operand, if_holds, otherwise);
    }

    pub(super) fn cast(&mut self, to: RefType) {
        let (operand, mut cast) = self.pop_for_cast(to);
        let mut flags = AccessFlags::empty();
        if cast.null == Null::Fails && to.heap_type().index().is_some() {
            match cast.check {
                Check::IsObject(Source::Object, _) => {
                    flags = self.flags_for_access(operand, object::TYPE_NUMBER);
                }
                Check::IsFunction(_) => flags = self.flags_for_access(operand, self.function_rtt()),
                _ => self.check_not_null(operand, Trap::NullReference),
            }
            cast.null = Null::Impossible;
        }
        let result = Self::after_cast(cast, operand, to);
        self.stack.push(result);
        if !self.is_live {
            return;
        }
        let mut done = Target::UNREACHED;
        let holds = self.decide_cast(cast, operand.value, flags, |this, condition, outcome| {
            if outcome {
                done = this.leave_for(done, condition, 0);
            } else {
                this.trap_if(condition, Trap::CastFailure);
            }
        });
        let fails = self.b.is_zero(holds);
        self.trap_if(fails, Trap::CastFailure);
        if done.is_reached() {
            done = self.arrive(done, self.here(), 0);
            self.meet(done, &[]);
        }
        self.refine(result);
    }

    /// Branches if the outcome is `taken_on`.
    pub(super) fn branch_on_cast(&mut self, position: usize, to: RefType, taken_on: bool) {
        let (operand, cast) = self.pop_for_cast(to);
        let after = |outcome| match outcome {
            true => Self::after_cast(cast, operand, to),
            false => Self::after_failed_cast(operand, to),
        };
        let mut targets = [Target::UNREACHED; 2];
        let flags = AccessFlags::empty();
        let holds = self.decide_cast(cast, operand.value, flags, |this, condition, outcome| {
            let target = &mut targets[usize::from(outcome == taken_on)];
            *target = this.leave_for(*target, condition, 0);
        });
        let [mut next, mut taken] = targets;
        let is_taken = if taken_on {
            holds
        } else {
            self.b.is_zero(holds)
        };
        if self.b.is_int_constant(is_taken, 1) {
            taken = self.arrive(taken, self.here(), 0);
        } else {
            taken = self.leave_for(taken, is_taken, 0);
            next = self.arrive(next, self.here(), 0);
        }
        self.meet(taken, &[]);
        if self.is_live {
            self.refine(after(taken_on));
            self.stack.push(after(taken_on));
            self.jump_to(position);
            self.pop();
        }
        self.meet(next, &[]);
        if self.is_live {
            self.refine(after(!taken_on));
            self.stack.push(after(!taken_on));
        }
    }

    pub(super) fn branch_on_null(&mut self, position: usize) {
        let operand = self.pop();
        let is_null = self.is_null(operand);
        let is_not_null = self.b.is_zero(is_null);
        self.branch_unless(is_not_null, position, None);
        self.refine(operand.non_null());
        self.stack.push(operand.non_null());
    }

    pub(super) fn branch_on_non_null(&mut self, position: usize) {
        let operand = self.pop();
        let is_null = self.is_null(operand);
        self.stack.push(operand.non_null());
        self.refine_for(Some(operand.non_null()), |this| {
            this.branch_unless(is_null, position, None);
        });
        self.pop();
    }
}
