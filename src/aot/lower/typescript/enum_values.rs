use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl};
use bun_sema::fold::{Constant, Decision};
use bun_sema::hir::{BinOp, EnumId, EnumMemberId, ExprId, ExprKind, UnOp};
use bun_sema::types::EnumValue;
use smallvec::SmallVec;

use crate::lower::{FileLowering, expression};

#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) enum EnumMemberValue {
    Number(f64),
    String(Atom),
    Computed(ExprId),
    ComputedNumber(ExprId),
    ComputedString(ExprId),
    PreviousPlusOne,
    Missing,
}

pub(super) type EnumMembers = SmallVec<[(EnumMemberId, EnumMemberValue); 8]>;

#[derive(Copy, Clone, PartialEq, Eq)]
enum KnownPrimitive {
    String,
    Null,
    Undefined,
    Other,
}

impl KnownPrimitive {
    fn of_constant(constant: Constant) -> KnownPrimitive {
        match constant {
            Constant::String(_) => KnownPrimitive::String,
            Constant::Null => KnownPrimitive::Null,
            Constant::Undefined => KnownPrimitive::Undefined,
            Constant::Boolean(_) | Constant::Number(_) | Constant::BigInt(_) => {
                KnownPrimitive::Other
            }
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn compute_enum_member_values(&mut self, declaration: EnumId) -> EnumMembers {
        let hir = self.hir;
        let mut members = EnumMembers::new();
        for member in hir[declaration].members.iter() {
            let data = hir[member];
            if data.computed_name.is_some() {
                continue;
            }
            let value = match data.init.some() {
                Some(initializer) => self.classify_enum_initializer(member, initializer),
                None => match members.last().map(|previous| previous.1) {
                    None => EnumMemberValue::Number(0.0),
                    Some(EnumMemberValue::Number(number)) => EnumMemberValue::Number(number + 1.0),
                    Some(EnumMemberValue::ComputedNumber(_) | EnumMemberValue::PreviousPlusOne) => {
                        EnumMemberValue::PreviousPlusOne
                    }
                    Some(
                        EnumMemberValue::String(_)
                        | EnumMemberValue::Computed(_)
                        | EnumMemberValue::ComputedString(_)
                        | EnumMemberValue::Missing,
                    ) => EnumMemberValue::Missing,
                },
            };
            members.push((member, value));
        }
        members
    }

    fn find_transpiler_constant(&mut self, member: EnumMemberId) -> Option<TranspilerConstant> {
        match self.queries.enum_member_value(member) {
            Ok(constant) => {
                let constant =
                    constant.filter(|constant| !constant.reads_other_file_or_variable)?;
                Some(match (constant.value, constant.rests_on_inexact_power) {
                    (value, false) => TranspilerConstant::Known(to_constant(value)),
                    (EnumValue::Number(_), true) => TranspilerConstant::NumberLeftToRunTime,
                    (EnumValue::String(_), true) => TranspilerConstant::StringLeftToRunTime,
                })
            }
            Err(_) => {
                let initializer = self.hir[member].init.some()?;
                expression::find_constant(self, initializer).map(TranspilerConstant::Known)
            }
        }
    }

    fn classify_enum_initializer(
        &mut self,
        member: EnumMemberId,
        initializer: ExprId,
    ) -> EnumMemberValue {
        match self.find_transpiler_constant(member) {
            Some(TranspilerConstant::Known(Constant::Number(number))) => {
                EnumMemberValue::Number(number)
            }
            Some(TranspilerConstant::Known(Constant::String(text))) => {
                EnumMemberValue::String(text)
            }
            Some(TranspilerConstant::NumberLeftToRunTime) => {
                EnumMemberValue::ComputedNumber(initializer)
            }
            Some(TranspilerConstant::StringLeftToRunTime) => {
                EnumMemberValue::ComputedString(initializer)
            }
            Some(TranspilerConstant::Known(
                Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::BigInt(_),
            ))
            | None => match self.find_known_primitive(initializer) {
                KnownPrimitive::String => EnumMemberValue::ComputedString(initializer),
                KnownPrimitive::Null | KnownPrimitive::Undefined | KnownPrimitive::Other => {
                    EnumMemberValue::Computed(initializer)
                }
            },
        }
    }

    fn find_known_primitive(&mut self, expression: ExprId) -> KnownPrimitive {
        if self.queries.is_stack_low() {
            return KnownPrimitive::Other;
        }
        match self.decisions().decision(expression) {
            Decision::Constant(constant) => return KnownPrimitive::of_constant(constant),
            Decision::Unknown
            | Decision::GlobalPath(_)
            | Decision::Data(_)
            | Decision::DeferredData => {}
        }
        match self.hir[expression].kind {
            ExprKind::String(_) | ExprKind::Template { .. } => KnownPrimitive::String,
            ExprKind::Null => KnownPrimitive::Null,
            ExprKind::Unary { op, .. } => match op {
                UnOp::Typeof => KnownPrimitive::String,
                UnOp::Void => KnownPrimitive::Undefined,
                _ => KnownPrimitive::Other,
            },
            ExprKind::Binary { op, left, right } => self.find_binary_primitive(op, left, right),
            ExprKind::Assign {
                op: None, value, ..
            } => self.find_known_primitive(value),
            ExprKind::Cond { branches, .. } => {
                let branches = self.hir.branches(branches);
                self.find_either_primitive(branches.yes, branches.no)
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.find_known_primitive(expr),
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                match self.find_inlined_enum_member(expression) {
                    Some(TranspilerConstant::Known(constant)) => {
                        KnownPrimitive::of_constant(constant)
                    }
                    Some(TranspilerConstant::StringLeftToRunTime) => KnownPrimitive::String,
                    Some(TranspilerConstant::NumberLeftToRunTime) | None => KnownPrimitive::Other,
                }
            }
            _ => KnownPrimitive::Other,
        }
    }

    fn find_binary_primitive(&mut self, op: BinOp, left: ExprId, right: ExprId) -> KnownPrimitive {
        match op {
            BinOp::Add => {
                let sides = [left, right].map(|side| self.find_known_primitive(side));
                match sides.contains(&KnownPrimitive::String) {
                    true => KnownPrimitive::String,
                    false => KnownPrimitive::Other,
                }
            }
            BinOp::Comma => self.find_known_primitive(right),
            BinOp::And | BinOp::Or => self.find_either_primitive(left, right),
            BinOp::Nullish if self.decisions().is_dead_expr(right) => {
                self.find_known_primitive(left)
            }
            BinOp::Nullish => {
                let [left, right] = [left, right].map(|side| self.find_known_primitive(side));
                match left {
                    KnownPrimitive::Null | KnownPrimitive::Undefined => right,
                    KnownPrimitive::String | KnownPrimitive::Other => left,
                }
            }
            _ => KnownPrimitive::Other,
        }
    }

    fn find_either_primitive(&mut self, first: ExprId, second: ExprId) -> KnownPrimitive {
        let decisions = self.decisions();
        match (
            decisions.is_dead_expr(first),
            decisions.is_dead_expr(second),
        ) {
            (true, _) => self.find_known_primitive(second),
            (false, true) => self.find_known_primitive(first),
            (false, false) => {
                let first = self.find_known_primitive(first);
                match first == self.find_known_primitive(second) {
                    true => first,
                    false => KnownPrimitive::Other,
                }
            }
        }
    }

    fn find_inlined_enum_member(&mut self, reference: ExprId) -> Option<TranspilerConstant> {
        if !matches!(self.hir[reference].kind, ExprKind::Ident(_)) {
            let member = self.queries.accessed_enum_member(reference);
            return self.find_transpiler_constant(member.ok().flatten()?);
        }
        let bound = self.bound;
        let symbol = match bound.binding(reference) {
            Binding::Symbol(symbol) => symbol,
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => return None,
        };
        match *bound.symbol(symbol).decls {
            [Decl::EnumMember(member)] => self.find_transpiler_constant(member),
            _ => None,
        }
    }
}

pub(in crate::lower) fn to_constant(value: EnumValue) -> Constant {
    match value {
        EnumValue::String(text) => Constant::String(text),
        EnumValue::Number(bits) => Constant::Number(f64::from_bits(bits)),
    }
}

#[derive(Copy, Clone)]
enum TranspilerConstant {
    Known(Constant),
    NumberLeftToRunTime,
    StringLeftToRunTime,
}
