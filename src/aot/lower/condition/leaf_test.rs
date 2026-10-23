use bun_sema::atom::{Atom, known};
use bun_sema::bind::{BindingInitializer, BindingKind, SymbolId};
use bun_sema::fold::Constant;
use bun_sema::hir::{BinOp, CallId, Chain, ExprId, ExprKind, UnOp};
use bun_sema::module_format::main_module_operand;

use crate::builtins::id::BuiltinId;
use crate::builtins::{Intrinsic, Resolved};
use crate::ir::{TypeId, TypeTable};
use crate::lower::expression::{find_constant, is_decided, skip_type_syntax};
use crate::lower::{FileLowering, FunctionLowering, call, operator, scope};

#[derive(Copy, Clone, Debug)]
pub(super) enum LeafTest {
    Truthiness,
    Type {
        operand: ExprId,
        is_typeof: bool,
        tested: TypeId,
        is_negated: bool,
    },
    TypeofObject {
        operand: ExprId,
        is_negated: bool,
    },
    NumberQuestion {
        question: BuiltinId,
        operand: ExprId,
    },
    Comparison {
        op: BinOp,
        left: ExprId,
        right: ExprId,
    },
}

#[derive(Copy, Clone)]
struct Equality {
    is_loose: bool,
    is_negated: bool,
}

pub(super) enum TypeofName {
    Type(TypeId),
    Object,
}

pub(super) fn classify_test(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> LeafTest {
    let file = &*lowering.file;
    let (op, left, right) = match file.hir[expression].kind {
        ExprKind::Call(site) => {
            return match call::find_number_question(file, expression) {
                Some((question, operand)) => LeafTest::NumberQuestion { question, operand },
                None => classify_type_test_call(file, site),
            };
        }
        ExprKind::Binary { op, left, right } => (op, left, right),
        _ => return LeafTest::Truthiness,
    };
    if !operator::is_comparison(op)
        || main_module_operand(file.hir, file.bound, expression).is_some()
    {
        return LeafTest::Truthiness;
    }
    match find_equality(op) {
        Some(equality) => classify_equality(lowering, op, equality, left, right),
        None => LeafTest::Comparison { op, left, right },
    }
}

fn find_equality(op: BinOp) -> Option<Equality> {
    let (is_loose, is_negated) = match op {
        BinOp::EqEq => (true, false),
        BinOp::NotEq => (true, true),
        BinOp::EqEqEq => (false, false),
        BinOp::NotEqEq => (false, true),
        _ => return None,
    };
    Some(Equality {
        is_loose,
        is_negated,
    })
}

fn classify_equality(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    op: BinOp,
    equality: Equality,
    left: ExprId,
    right: ExprId,
) -> LeafTest {
    let file = &*lowering.file;
    let is_negated = equality.is_negated;
    let sides = [(left, right), (right, left)];
    for (side, other) in sides {
        let Some(operand) = find_typeof_operand(lowering, side) else {
            continue;
        };
        let Some(Constant::String(name)) = find_constant(file, other) else {
            continue;
        };
        return match typeof_name(name) {
            Some(TypeofName::Type(tested)) => LeafTest::Type {
                operand,
                is_typeof: true,
                tested,
                is_negated,
            },
            Some(TypeofName::Object) => LeafTest::TypeofObject {
                operand,
                is_negated,
            },
            None => LeafTest::Comparison { op, left, right },
        };
    }
    for (side, other) in sides {
        let Some(tested) = find_nullish_type(file, side, equality.is_loose) else {
            continue;
        };
        if find_constant(file, other).is_none() {
            return LeafTest::Type {
                operand: other,
                is_typeof: false,
                tested,
                is_negated,
            };
        }
    }
    LeafTest::Comparison { op, left, right }
}

pub(in crate::lower) fn find_typeof_operand(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    side: ExprId,
) -> Option<ExprId> {
    let file = &*lowering.file;
    let node = skip_type_syntax(file, side);
    let node = find_kept_typeof(lowering, node).unwrap_or(node);
    let ExprKind::Unary {
        op: UnOp::Typeof,
        operand,
    } = file.hir[node].kind
    else {
        return None;
    };
    (!is_decided(file, node)).then_some(operand)
}

/// A local of the function that asks, past its dead zone, which has one value from there on. Not a `var`: that is undefined until its declaration runs.
fn find_unchanging_local(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    node: ExprId,
) -> Option<SymbolId> {
    let bound = lowering.file.bound;
    let ExprKind::Ident(_) = lowering.file.hir[node].kind else {
        return None;
    };
    let symbol = scope::find_tested_local(lowering, node)?;
    let has_no_value_before = matches!(
        bound.binding_kind(symbol),
        BindingKind::Const
            | BindingKind::Let
            | BindingKind::Parameter
            | BindingKind::SimpleCatchParameter
    );
    (has_no_value_before && bound.is_stable_binding(symbol)).then_some(symbol)
}

/// `const kind = typeof value`: `kind` is `typeof value` wherever neither changes.
fn find_kept_typeof(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    node: ExprId,
) -> Option<ExprId> {
    let file = &*lowering.file;
    let kind = find_unchanging_local(lowering, node)?;
    let BindingInitializer::Expression(initializer) =
        file.bound.binding_initializer(file.hir, kind)
    else {
        return None;
    };
    let initializer = skip_type_syntax(file, initializer);
    let ExprKind::Unary {
        op: UnOp::Typeof,
        operand,
    } = file.hir[initializer].kind
    else {
        return None;
    };
    find_unchanging_local(lowering, skip_type_syntax(file, operand)).map(|_| initializer)
}

fn find_nullish_type(
    file: &FileLowering<'_, '_, '_, '_>,
    side: ExprId,
    is_loose: bool,
) -> Option<TypeId> {
    match find_constant(file, side)? {
        Constant::Null | Constant::Undefined if is_loose => Some(TypeTable::NULLISH),
        Constant::Null => Some(TypeTable::NULL),
        Constant::Undefined => Some(TypeTable::UNDEFINED),
        Constant::Boolean(_) | Constant::Number(_) | Constant::String(_) | Constant::BigInt(_) => {
            None
        }
    }
}

pub(super) fn typeof_name(name: Atom) -> Option<TypeofName> {
    if name == known::undefined {
        Some(TypeofName::Type(TypeTable::UNDEFINED))
    } else if name == known::boolean {
        Some(TypeofName::Type(TypeTable::BOOLEAN))
    } else if name == known::number {
        Some(TypeofName::Type(TypeTable::NUMBER))
    } else if name == known::string {
        Some(TypeofName::Type(TypeTable::STRING))
    } else if name == known::symbol {
        Some(TypeofName::Type(TypeTable::SYMBOL))
    } else if name == known::bigint {
        Some(TypeofName::Type(TypeTable::BIGINT))
    } else if name == known::function {
        Some(TypeofName::Type(TypeTable::FUNCTION))
    } else if name == known::object {
        Some(TypeofName::Object)
    } else {
        None
    }
}

fn classify_type_test_call(file: &FileLowering<'_, '_, '_, '_>, site: CallId) -> LeafTest {
    let Some((intrinsic, operand)) = find_unary_intrinsic_call(file, site) else {
        return LeafTest::Truthiness;
    };
    let tested = match intrinsic {
        Intrinsic::IsNullish => TypeTable::NULLISH,
        Intrinsic::IsObject => TypeTable::OBJECT,
        Intrinsic::IsCallable => TypeTable::FUNCTION,
        _ => return LeafTest::Truthiness,
    };
    LeafTest::Type {
        operand,
        is_typeof: false,
        tested,
        is_negated: false,
    }
}

fn find_unary_intrinsic_call(
    file: &FileLowering<'_, '_, '_, '_>,
    site: CallId,
) -> Option<(Intrinsic, ExprId)> {
    let hir = file.hir;
    let call = hir[site];
    let callee = skip_type_syntax(file, call.callee);
    let intrinsic = match file.builtins.of_expr(callee) {
        Some(Resolved::Intrinsic(intrinsic)) => intrinsic,
        Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_)) | None => return None,
    };
    let mut arguments = hir.ids(call.args);
    let (Some(argument), None) = (arguments.next(), arguments.next()) else {
        return None;
    };
    let is_well_formed =
        call.chain == Chain::No && !matches!(hir[argument].kind, ExprKind::Spread(_));
    is_well_formed.then_some((intrinsic, argument))
}
