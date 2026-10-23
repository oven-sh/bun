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

#[derive(Copy, Clone)]
enum NextNumber {
    Known(f64),
    PreviousPlusOne,
    Unknown,
}

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

    fn merge(self, other: KnownPrimitive) -> KnownPrimitive {
        if self == other {
            self
        } else {
            KnownPrimitive::Other
        }
    }

    fn add(self, other: KnownPrimitive) -> KnownPrimitive {
        if self == KnownPrimitive::String || other == KnownPrimitive::String {
            KnownPrimitive::String
        } else {
            KnownPrimitive::Other
        }
    }

    fn coalesce(self, other: KnownPrimitive) -> KnownPrimitive {
        match self {
            KnownPrimitive::Null | KnownPrimitive::Undefined => other,
            KnownPrimitive::String | KnownPrimitive::Other => self,
        }
    }
}

pub(super) fn compute_enum_member_values(
    file: &mut FileLowering<'_, '_, '_, '_>,
    declaration: EnumId,
) -> EnumMembers {
    let hir = file.hir;
    let mut members = EnumMembers::new();
    let mut next_number = NextNumber::Known(0.0);
    for member in hir[declaration].members.iter() {
        let data = hir[member];
        if data.computed_name.is_some() {
            continue;
        }
        let value = match (data.init.some(), next_number) {
            (Some(initializer), _) => classify_enum_initializer(file, member, initializer),
            (None, NextNumber::Known(number)) => EnumMemberValue::Number(number),
            (None, NextNumber::PreviousPlusOne) => EnumMemberValue::PreviousPlusOne,
            (None, NextNumber::Unknown) => EnumMemberValue::Missing,
        };
        next_number = match value {
            EnumMemberValue::Number(number) => NextNumber::Known(number + 1.0),
            EnumMemberValue::ComputedNumber(_) | EnumMemberValue::PreviousPlusOne => {
                NextNumber::PreviousPlusOne
            }
            _ => NextNumber::Unknown,
        };
        members.push((member, value));
    }
    members
}

fn to_constant(value: EnumValue) -> Constant {
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

fn find_transpiler_constant(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member: EnumMemberId,
) -> Option<TranspilerConstant> {
    match file.queries.enum_member_value(member) {
        Ok(constant) => {
            let constant = constant.filter(|constant| !constant.reads_other_file_or_variable)?;
            Some(match (constant.value, constant.rests_on_inexact_power) {
                (value, false) => TranspilerConstant::Known(to_constant(value)),
                (EnumValue::Number(_), true) => TranspilerConstant::NumberLeftToRunTime,
                (EnumValue::String(_), true) => TranspilerConstant::StringLeftToRunTime,
            })
        }
        Err(_) => {
            let initializer = file.hir[member].init.some()?;
            expression::find_constant(file, initializer).map(TranspilerConstant::Known)
        }
    }
}

fn classify_enum_initializer(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member: EnumMemberId,
    initializer: ExprId,
) -> EnumMemberValue {
    match find_transpiler_constant(file, member) {
        Some(TranspilerConstant::Known(Constant::Number(number))) => {
            EnumMemberValue::Number(number)
        }
        Some(TranspilerConstant::Known(Constant::String(text))) => EnumMemberValue::String(text),
        Some(TranspilerConstant::NumberLeftToRunTime) => {
            EnumMemberValue::ComputedNumber(initializer)
        }
        Some(TranspilerConstant::StringLeftToRunTime) => {
            EnumMemberValue::ComputedString(initializer)
        }
        Some(TranspilerConstant::Known(
            Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::BigInt(_),
        ))
        | None => match find_known_primitive(file, initializer) {
            KnownPrimitive::String => EnumMemberValue::ComputedString(initializer),
            KnownPrimitive::Null | KnownPrimitive::Undefined | KnownPrimitive::Other => {
                EnumMemberValue::Computed(initializer)
            }
        },
    }
}

fn find_known_primitive(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> KnownPrimitive {
    if file.queries.is_stack_low() {
        return KnownPrimitive::Other;
    }
    match file.decisions().decision(expression) {
        Decision::Constant(constant) => return KnownPrimitive::of_constant(constant),
        Decision::Unknown
        | Decision::GlobalPath(_)
        | Decision::Data(_)
        | Decision::DeferredData => {}
    }
    match file.hir[expression].kind {
        ExprKind::String(_) | ExprKind::Template { .. } => KnownPrimitive::String,
        ExprKind::Null => KnownPrimitive::Null,
        ExprKind::Unary { op, .. } => match op {
            UnOp::Typeof => KnownPrimitive::String,
            UnOp::Void => KnownPrimitive::Undefined,
            _ => KnownPrimitive::Other,
        },
        ExprKind::Binary { op, left, right } => find_binary_primitive(file, op, left, right),
        ExprKind::Assign {
            op: None, value, ..
        } => find_known_primitive(file, value),
        ExprKind::Cond { branches, .. } => {
            let branches = file.hir.branches(branches);
            find_either_primitive(file, branches.yes, branches.no)
        }
        ExprKind::As { expr, .. }
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::NonNull(expr)
        | ExprKind::Instantiation { expr, .. } => find_known_primitive(file, expr),
        ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
            match find_inlined_enum_member(file, expression) {
                Some(TranspilerConstant::Known(constant)) => KnownPrimitive::of_constant(constant),
                Some(TranspilerConstant::StringLeftToRunTime) => KnownPrimitive::String,
                Some(TranspilerConstant::NumberLeftToRunTime) | None => KnownPrimitive::Other,
            }
        }
        ExprKind::Missing
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::TaggedTemplate(_)
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Call(_)
        | ExprKind::New(_)
        | ExprKind::Assign { op: Some(_), .. }
        | ExprKind::Spread(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => KnownPrimitive::Other,
    }
}

fn find_binary_primitive(
    file: &mut FileLowering<'_, '_, '_, '_>,
    op: BinOp,
    left: ExprId,
    right: ExprId,
) -> KnownPrimitive {
    match op {
        BinOp::Add => {
            let left = find_known_primitive(file, left);
            left.add(find_known_primitive(file, right))
        }
        BinOp::Comma => find_known_primitive(file, right),
        BinOp::And | BinOp::Or => find_either_primitive(file, left, right),
        BinOp::Nullish if file.decisions().is_dead_expr(right) => find_known_primitive(file, left),
        BinOp::Nullish => {
            let left = find_known_primitive(file, left);
            left.coalesce(find_known_primitive(file, right))
        }
        _ => KnownPrimitive::Other,
    }
}

fn find_either_primitive(
    file: &mut FileLowering<'_, '_, '_, '_>,
    first: ExprId,
    second: ExprId,
) -> KnownPrimitive {
    let decisions = file.decisions();
    match (
        decisions.is_dead_expr(first),
        decisions.is_dead_expr(second),
    ) {
        (true, _) => find_known_primitive(file, second),
        (false, true) => find_known_primitive(file, first),
        (false, false) => {
            let first = find_known_primitive(file, first);
            first.merge(find_known_primitive(file, second))
        }
    }
}

fn find_inlined_enum_member(
    file: &mut FileLowering<'_, '_, '_, '_>,
    reference: ExprId,
) -> Option<TranspilerConstant> {
    if !matches!(file.hir[reference].kind, ExprKind::Ident(_)) {
        let member = file
            .queries
            .accessed_enum_member(reference)
            .ok()
            .flatten()?;
        return find_transpiler_constant(file, member);
    }
    let bound = file.bound;
    let symbol = match bound.binding(reference) {
        Binding::Symbol(symbol) => symbol,
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => return None,
    };
    match *bound.symbol(symbol).decls {
        [Decl::EnumMember(member)] => find_transpiler_constant(file, member),
        _ => None,
    }
}
