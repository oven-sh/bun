//! Comparisons and tests. They give an I32.

use bun_engine_asm::Cond;
use bun_engine_bytecode::{CellType as NamedCellType, Operand};
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_text::{PropertyName, names};
use bun_engine_vm::{CellType, JsString, RealmWatchpoint, SpeculatedType as T};

use super::Builder;
use crate::graph::{ExitKind, InLine, Kind, Relation, TypeName};

const TYPE_NAMES: [PropertyName<'static>; TypeName::COUNT] = [
    names::undefined,
    names::object,
    names::function,
    names::boolean,
    names::number,
    names::string,
    names::symbol,
    names::bigint,
];

pub(super) fn type_name_at(address: usize) -> Option<TypeName> {
    let position = TYPE_NAMES.iter().position(|it| it.address() == address)?;
    Some(TypeName::from_data(position as u32))
}

impl Builder<'_> {
    fn both(&mut self, lhs: Operand, rhs: Operand) -> [Ssa; 2] {
        [lhs, rhs].map(|operand| {
            let value = self.get_value(operand);
            self.graph.root(value)
        })
    }

    fn may_be_primitives(&self, operands: [Ssa; 2]) -> bool {
        (operands.into_iter()).all(|it| self.may_be_primitive(it, self.expected(it)))
    }

    fn compare_anything(&mut self, kind: Kind, operands: [Ssa; 2], data: u32) -> Ssa {
        let expected = operands.map(|it| Some(self.expected(it)).filter(|it| !it.is_empty()));
        let in_line = InLine::for_operands(&expected.map(|it| it.unwrap_or(T::INT32)));
        let operands = operands.map(|it| self.alias(it));
        self.node(kind, &operands, data | in_line.bits())
    }

    pub(super) fn compare(&mut self, relation: Relation, lhs: Operand, rhs: Operand) -> Ssa {
        let operands = self.both(lhs, rhs);
        if self.may_be_primitives(operands) {
            self.node(Kind::Compare, &operands, relation as u32)
        } else {
            self.compare_anything(Kind::GenericCompare, operands, relation as u32)
        }
    }

    pub(super) fn loose_equal(&mut self, lhs: Operand, rhs: Operand) -> Ssa {
        let operands = self.both(lhs, rhs);
        if let Some(result) = self.compare_type_name(operands) {
            return result;
        }
        let are_objects = (operands.iter())
            .all(|&operand| (T::OBJECT | T::NULLISH).contains(self.expected(operand)));
        let failures = [ExitKind::Mixed, ExitKind::ExoticObject];
        if self.may_be_primitives(operands)
            || are_objects && !failures.into_iter().any(|kind| self.has_exited(kind))
        {
            self.node(Kind::LooseEqual, &operands, 0)
        } else {
            self.compare_anything(Kind::GenericLooseEqual, operands, 0)
        }
    }

    pub(super) fn strict_equal(&mut self, lhs: Operand, rhs: Operand) -> Ssa {
        let operands = self.both(lhs, rhs);
        (self.compare_type_name(operands))
            .or_else(|| self.compare_with_only_one_of_its_type(operands))
            .unwrap_or_else(|| self.node(Kind::StrictEqual, &operands, 0))
    }

    fn compare_with_only_one_of_its_type(&mut self, [lhs, rhs]: [Ssa; 2]) -> Option<Ssa> {
        [(lhs, rhs), (rhs, lhs)]
            .into_iter()
            .find_map(|(value, constant)| {
                let bits = self.graph.constant(constant)?;
                let ty = [
                    (0, T::EMPTY),
                    (bun_engine_vm::Value::UNDEFINED.to_bits(), T::UNDEFINED),
                    (bun_engine_vm::Value::NULL.to_bits(), T::NULL),
                ];
                let (_, ty) = ty.into_iter().find(|it| it.0 == bits)?;
                Some(self.is_type(value, ty))
            })
    }

    pub(super) fn identical(&mut self, lhs: Operand, rhs: Operand) -> Ssa {
        let [lhs, rhs] = [self.get(lhs), self.get(rhs)].map(|operand| self.graph.root(operand));
        if lhs == rhs {
            return self.int32(1);
        }
        (self.compare_with_only_one_of_its_type([lhs, rhs]))
            .unwrap_or_else(|| self.ir().equal(lhs, rhs))
    }

    pub(super) fn unsigned_compare(&mut self, cond: Cond, lhs: Operand, rhs: Operand) -> Ssa {
        let [lhs, rhs] = [self.get(lhs), self.get(rhs)].map(|operand| self.as_int32(operand));
        self.ir().compare(cond, lhs, rhs)
    }

    pub(super) fn test(&mut self, kind: Kind, value: Operand) -> Ssa {
        let value = self.get_value(value);
        let root = self.graph.root(value);
        self.node(kind, &[root], 0)
    }

    pub(super) fn test_type(&mut self, value: Operand, ty: T) -> Ssa {
        let value = self.get(value);
        self.is_type(value, ty)
    }

    pub(super) fn test_cell_type(&mut self, value: Operand, cell_type: NamedCellType) -> Ssa {
        let (value, ty) = (self.get(value), T::of_cell_type(CellType(cell_type.0)));
        if !ty.intersects(T::OTHER_OBJECT | T::OTHER_CELL) {
            return self.is_type(value, ty);
        }
        let root = self.graph.root(value);
        self.node(Kind::IsCellOfType, &[root], cell_type.0.into())
    }

    pub(super) fn truth(&mut self, value: Operand) -> Ssa {
        let value = self.get_value(value);
        self.to_boolean(value)
    }

    /// For a node that is told later what is known and expected of the operand.
    pub(super) fn inspect(&mut self, kind: Kind, value: Ssa) -> Ssa {
        let (alias, data) = (self.alias(value), self.graph.intern_type(T::HEAP_TOP));
        self.node(kind, &[alias], data)
    }

    pub(super) fn is_callable(&mut self, value: Ssa) -> Ssa {
        let known = self.knowledge.type_of(&self.graph, value);
        if T::FUNCTION.contains(known) || !known.intersects(TypeName::MAY_BE_CALLABLE) {
            return self.int32(T::FUNCTION.contains(known).into());
        }
        self.inspect(Kind::IsCallable, value)
    }

    pub(super) fn is_constructor(&mut self, value: Ssa) -> Ssa {
        match self.constant_value(value) {
            Some(constant) => self.int32(constant.is_constructor().into()),
            None => self.inspect(Kind::IsConstructor, value),
        }
    }

    // `typeof`

    pub(super) fn type_name(&mut self, name: TypeName) -> Ssa {
        self.cell(JsString::from_name(self.vm, TYPE_NAMES[name as usize]).cell())
    }

    pub(super) fn type_of(&mut self, value: Ssa) -> Ssa {
        if let Some(name) = TypeName::of(self.knowledge.type_of(&self.graph, value)) {
            return self.type_name(name);
        }
        if self.graph.type_names[0] == 0 {
            for position in 0..TypeName::COUNT {
                let string = self.type_name(TypeName::from_data(position as u32));
                self.graph.type_names[position] = self.graph.constant(string).unwrap();
            }
        }
        if self.watch_realm(RealmWatchpoint::NoObjectMasqueradesAsUndefined) {
            self.inspect(Kind::PlainTypeof, value)
        } else {
            self.inspect(Kind::GenericTypeof, value)
        }
    }

    pub(super) fn has_type_name(&mut self, value: Ssa, name: TypeName) -> Ssa {
        let is_at_stake = matches!(
            name,
            TypeName::Undefined | TypeName::Object | TypeName::Function
        );
        if is_at_stake
            && !self.is(value, !T::OTHER_OBJECT)
            && !self.watch_realm(RealmWatchpoint::NoObjectMasqueradesAsUndefined)
        {
            let (found, wanted) = (self.type_of(value), self.type_name(name));
            return self.ir().equal(found, wanted);
        }
        match name {
            TypeName::Function => self.is_callable(value),
            TypeName::Object if !self.is(value, !TypeName::MAY_BE_CALLABLE | T::FUNCTION) => {
                self.inspect(Kind::HasObjectTypeName, value)
            }
            _ => self.is_type(value, name.types()),
        }
    }

    pub(super) fn test_type_name(&mut self, value: Operand, name: TypeName) -> Ssa {
        let value = self.get_value(value);
        self.has_type_name(value, name)
    }

    /// If one is the result of `typeof` and the other is a constant.
    fn compare_type_name(&mut self, [lhs, rhs]: [Ssa; 2]) -> Option<Ssa> {
        [(lhs, rhs), (rhs, lhs)]
            .into_iter()
            .find_map(|(found, constant)| {
                let value = self.graph.inside(found, Kind::PlainTypeof)?;
                let atom = self.graph.text_of_constant(constant)?.atom?;
                Some(match type_name_at(atom) {
                    Some(name) => self.has_type_name(value, name),
                    None => self.int32(0),
                })
            })
    }
}
