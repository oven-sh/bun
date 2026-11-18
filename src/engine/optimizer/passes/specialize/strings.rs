use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::SpeculatedType as T;

use super::Specializer;
use crate::graph::{ExitKind, Fibers, Kind, Relation};

impl Specializer<'_> {
    pub(super) fn to_string(&mut self, value: Ssa, seen: T) -> Ssa {
        let (failure, expected) = (ExitKind::Inconvertible, self.expected(value) | seen);
        let expects =
            |ty: T| self.is(value, ty) || ty.contains(expected) && !self.has_exited(failure);
        if expects(T::STRING) {
            self.check_type(value, T::STRING, failure)
        } else if expects(T::INT32) {
            let int32 = self.as_int32(value, failure);
            self.node(Kind::Int32ToString, &[int32], 0)
        } else if expects(T::FULL_DOUBLE | T::INT52) {
            let double = self.as_double(value, failure);
            self.node(Kind::DoubleToString, &[double], 0)
        } else {
            let checked = self.check_type(value, !T::OBJECT, ExitKind::ExoticObject);
            let mut description = self.description_of(value);
            description.wanted |= seen;
            let data = self.graph.type_check(description);
            self.node(Kind::PrimitiveToString, &[checked], data)
        }
    }

    pub(super) fn describe_fibers(&self) -> u32 {
        let describe = |(position, &operand)| {
            let mut fibers = Fibers::empty();
            fibers.set(Fibers::IS_FLAT, self.is(operand, !T::ROPE_STRING));
            let may_be_rope = self.expected(operand).intersects(T::ROPE_STRING);
            fibers.set(Fibers::MAY_WELL_BE_ROPE, may_be_rope);
            fibers.for_operand(position)
        };
        let operands = self.graph.function.operands(self.at).iter().enumerate();
        operands.map(describe).sum()
    }

    /// The code unit of a string that is known to have just one.
    fn only_unit(&mut self, value: Ssa) -> Option<Ssa> {
        let made_from = (self.graph).inside(self.graph.root(value), Kind::StringFromUnit);
        made_from.or_else(|| {
            let text = (self.graph.text_of_constant(value)).filter(|it| it.length == 1)?;
            Some(self.graph.function.const32(text.first_unit?.into()))
        })
    }

    pub(super) fn only_units(&mut self, lhs: Ssa, rhs: Ssa) -> Option<[Ssa; 2]> {
        Some([self.only_unit(lhs)?, self.only_unit(rhs)?])
    }

    /// Of two strings.
    pub(super) fn compare_with_unit(
        &mut self,
        relation: Relation,
        lhs: Ssa,
        rhs: Ssa,
    ) -> Option<Ssa> {
        let ways = [(lhs, rhs, relation), (rhs, lhs, relation.commuted())];
        ways.into_iter().find_map(|(string, other, relation)| {
            let operands = [string, self.only_unit(other)?];
            Some(self.node(Kind::CompareWithUnit, &operands, relation as u32))
        })
    }
}
