use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    CompilerOption, get_call_signatures_of_type, is_boolean_literal_type,
    is_compiler_option_enabled, is_strict_compiler_option_enabled, is_true_literal_type,
    union_constituents,
};
use bun_lint::types::utils::{
    find_truthiness_asserted_argument, find_type_guard_asserted_argument,
    get_constrained_type_at_location, get_constraint_info, get_constraint_of_type_parameter,
    get_type_name,
    get_type_of_property_of_name, get_value_of_literal_type, is_array_method_call_with_predicate,
    is_nullable_type, is_possibly_falsy, is_possibly_truthy, is_type_any_type, is_type_flag_set,
    is_type_unknown_type,
};
use bun_lint::types::{
    Literal, ObjectFlags, SymbolFlags, Type, TypeFlags, TypePredicateKind, TypeStructure,
};
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::eslint_utils::StaticValue;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Disallow conditionals where the type is always truthy or always falsy.
pub struct NoUnnecessaryCondition {
    allow_constant_loop_conditions: AllowConstantLoopConditions,
    allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing: bool,
    check_type_predicates: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum AllowConstantLoopConditions {
    Always,
    Never,
    OnlyAllowedLiterals,
}

pub struct State<'a> {
    /// The compiler options that the rule depends on.
    is_strict_null_checks: bool,
    is_no_unchecked_indexed_access: bool,
    /// [`is_only_used_for_truthiness`]
    only_used_for_truthiness: AncestorMemo<'a, bool>,
    /// tsgolint's `isAssertionArgument`, which it asks with `checkTypePredicates`.
    is_assertion_argument_checked: bool,
}

type Context<'a> = Cx<'a, NoUnnecessaryCondition>;

/// What has a condition is listened to in the order of the source, the outer one first, as upstream: a condition that is in
/// another one can be reported twice at one place.
const CONDITIONS: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).enter(
    NodeTags::CASE
        .exprs(&[ExprTag::Assign, ExprTag::Binary, ExprTag::Call, ExprTag::Cond])
        .stmts(&[StmtTag::If, StmtTag::DoWhile, StmtTag::For, StmtTag::While]),
);

const ALWAYS_FALSY: Message =
    Message::new("alwaysFalsy", "Unnecessary conditional, value is always falsy.");
const ALWAYS_FALSY_FUNC: Message = Message::new(
    "alwaysFalsyFunc",
    "This callback should return a conditional, but return is always falsy.",
);
const ALWAYS_NULLISH: Message = Message::new(
    "alwaysNullish",
    "Unnecessary conditional, left-hand side of `??` operator is always `null` or `undefined`.",
);
const ALWAYS_TRUTHY: Message =
    Message::new("alwaysTruthy", "Unnecessary conditional, value is always truthy.");
const ALWAYS_TRUTHY_FUNC: Message = Message::new(
    "alwaysTruthyFunc",
    "This callback should return a conditional, but return is always truthy.",
);
const COMPARISON_BETWEEN_LITERAL_TYPES: Message = Message::new(
    "comparisonBetweenLiteralTypes",
    "Unnecessary conditional, comparison is always {{trueOrFalse}}, since `{{left}} {{operator}} {{right}}` is {{trueOrFalse}}.",
);
const NEVER: Message = Message::new("never", "Unnecessary conditional, value is `never`.");
const NEVER_NULLISH: Message = Message::new(
    "neverNullish",
    "Unnecessary conditional, expected left-hand side of `??` operator to be possibly null or undefined.",
);
const NEVER_OPTIONAL_CHAIN: Message = Message::new(
    "neverOptionalChain",
    "Unnecessary optional chain on a non-nullish value.",
);
const NO_OVERLAP_BOOLEAN_EXPRESSION: Message = Message::new(
    "noOverlapBooleanExpression",
    "Unnecessary conditional, the types have no overlap.",
);
const NO_STRICT_NULL_CHECK: Message = Message::new(
    "noStrictNullCheck",
    "This rule requires the `strictNullChecks` compiler option to be turned on to function correctly.",
);
const SUGGEST_REMOVE_OPTIONAL_CHAIN: Message =
    Message::new("suggestRemoveOptionalChain", "Remove unnecessary optional chain");
const TYPE_GUARD_ALREADY_IS_TYPE: Message = Message::new(
    "typeGuardAlreadyIsType",
    "Unnecessary conditional, expression already has the type being checked by the {{typeGuardOrAssertionFunction}}.",
);

const NULLISH_FLAG: TypeFlags = TypeFlags::UNDEFINED.union(TypeFlags::NULL);
const NULLISH_OR_VOID_FLAG: TypeFlags = NULLISH_FLAG.union(TypeFlags::VOID);
const ANY_UNKNOWN_OR_TYPE_VARIABLE_FLAG: TypeFlags = TypeFlags::ANY
    .union(TypeFlags::UNKNOWN)
    .union(TypeFlags::TYPE_PARAMETER)
    .union(TypeFlags::TYPE_VARIABLE);

fn is_nullish_type(ty: Type) -> bool {
    ty.has_flags(NULLISH_FLAG)
}

fn is_always_nullish(ty: Type) -> bool {
    // tsgolint's `isAlwaysNullishType` asks the type itself: `void` is, a union is not.
    if ty.file().language().is_oxlint {
        return ty.has_flags(NULLISH_OR_VOID_FLAG);
    }
    union_constituents(ty).iter().all(is_nullish_type)
}

/// Unlike `is_nullable_type`, `any` and `unknown` are not.
fn is_possibly_nullish(ty: Type) -> bool {
    union_constituents(ty).iter().any(|t| t.has_flags(NULLISH_OR_VOID_FLAG))
}

fn is_possibly_non_nullish(ty: Type) -> bool {
    union_constituents(ty).iter().any(|t| !t.has_flags(NULLISH_OR_VOID_FLAG))
}

fn to_static_value(ty: Type<'_>) -> Option<StaticValue<'_>> {
    if is_boolean_literal_type(ty) {
        return Some(StaticValue::Bool(is_true_literal_type(ty)));
    }
    let flags = ty.flags();
    if flags == TypeFlags::UNDEFINED {
        return Some(StaticValue::Undefined);
    }
    if flags == TypeFlags::NULL {
        return Some(StaticValue::Null);
    }
    if !ty.is_literal() {
        return None;
    }
    Some(match get_value_of_literal_type(ty)? {
        Literal::String(value) => StaticValue::string(value),
        Literal::Number(value) => StaticValue::Number(value),
        Literal::BigInt { negative, base10 } => {
            let value: i128 = std::str::from_utf8(base10).ok()?.parse().ok()?;
            StaticValue::BigInt(if negative { -value } else { value })
        }
    })
}

/// `None` if a `bigint` in a string is too long to be compared.
fn boolean_comparison<'a>(left: &StaticValue<'a>, operator: BinOp, right: &StaticValue<'a>) -> Option<bool> {
    Some(match operator {
        BinOp::NotEq => !left.js_loose_equals(right)?,
        BinOp::NotEqEq => !left.js_strict_equals(right)?,
        BinOp::EqEq => left.js_loose_equals(right)?,
        BinOp::EqEqEq => left.js_strict_equals(right)?,
        BinOp::Lt => left.js_compare(right)? == Some(Ordering::Less),
        BinOp::Le => matches!(left.js_compare(right)?, Some(Ordering::Less | Ordering::Equal)),
        BinOp::Gt => left.js_compare(right)? == Some(Ordering::Greater),
        BinOp::Ge => matches!(left.js_compare(right)?, Some(Ordering::Greater | Ordering::Equal)),
        _ => return None,
    })
}

/// The same for two `bigint` literal types, one of which is too long for a [`StaticValue`].
fn big_int_comparison(left: Type, operator: BinOp, right: Type) -> Option<bool> {
    let (
        Literal::BigInt { negative: is_left_negative, base10: left },
        Literal::BigInt { negative: is_right_negative, base10: right },
    ) = (get_value_of_literal_type(left)?, get_value_of_literal_type(right)?)
    else {
        return None;
    };
    let magnitudes = left.len().cmp(&right.len()).then_with(|| left.cmp(right));
    let ordering = match (is_left_negative, is_right_negative) {
        (false, false) => magnitudes,
        (true, true) => magnitudes.reverse(),
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
    };
    Some(match operator {
        BinOp::EqEq | BinOp::EqEqEq => ordering.is_eq(),
        BinOp::NotEq | BinOp::NotEqEq => ordering.is_ne(),
        BinOp::Lt => ordering.is_lt(),
        BinOp::Le => ordering.is_le(),
        BinOp::Gt => ordering.is_gt(),
        BinOp::Ge => ordering.is_ge(),
        _ => return None,
    })
}

fn is_only_used_for_truthiness<'a>(
    node: Expr<'a>,
    known: &mut AncestorMemo<'a, bool>,
    is_assertion_argument_checked: bool,
) -> bool {
    let decide = |node: Node<'a>, parent: Node<'a>| match parent {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Cond { test, .. } => Some(Node::Expr(test) == node),
            ExprKind::Binary {
                op: BinOp::And,
                left,
                ..
            } if Node::Expr(left) == node => Some(true),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => None,
            ExprKind::Unary { op, .. } => Some(op == UnOp::Not),
            // tsgolint: the argument that a called function `asserts`.
            ExprKind::Call(_) if is_assertion_argument_checked => {
                Some(find_truthiness_asserted_argument(parent).map(Node::Expr) == Some(node))
            }
            _ => Some(false),
        },
        Node::Stmt(parent) => Some(match parent.kind() {
            StmtKind::DoWhile { test, .. }
            | StmtKind::If { test, .. }
            | StmtKind::While { test, .. } => Node::Expr(test) == node,
            StmtKind::For { test, .. } => test.map(Node::Expr) == Some(node),
            _ => false,
        }),
        _ => Some(false),
    };
    known.find(Node::Expr(node), decide).unwrap_or(false)
}

/// `node` is any expression as ESLint has it: the whole of an optional chain is a
/// `ChainExpression` there, which is no `MemberExpression`.
fn is_array_index_expression(node: Expr) -> bool {
    let ExprKind::Index { obj, index, .. } = node.kind() else {
        return false;
    };
    // For ESLint it is a `ChainExpression`, for tsgolint the access itself.
    if node.is_chain_root() && !node.file().language().is_oxlint {
        return false;
    }
    // For tsgolint only an index that is written as a number.
    let is_literal_index = match node.file().language().is_oxlint {
        true => index.tag() == ExprTag::Number,
        false => ast_utils::is_literal(index),
    };
    let parts = union_constituents(get_constrained_type_at_location(obj));
    parts.iter().any(|part| part.is_array_type())
        // A literal index into a tuple has a sound type.
        || !is_literal_index && parts.iter().any(|part| part.is_tuple_type())
}

/// A conditional is always necessary if it involves `any`, `unknown` or a naked type variable.
fn is_conditional_always_necessary(ty: Type) -> bool {
    union_constituents(ty).iter().any(|part| {
        is_type_any_type(part)
            || is_type_unknown_type(part)
            || part.has_flags(TypeFlags::TYPE_VARIABLE)
            || part.is_unresolved()
    })
}

/// `String(type.value)` of a string or a number literal type.
fn property_name_of_literal_type(ty: Type<'_>) -> Option<Cow<'_, [u8]>> {
    if !ty.is_string_literal() && !ty.is_number_literal() {
        return None;
    }
    match ty.value()? {
        Literal::String(value) => Some(Cow::Borrowed(value)),
        Literal::Number(value) => StaticValue::Number(value).to_js_string(),
        Literal::BigInt { .. } => None,
    }
}

fn is_nullable_property_type<'a>(obj_type: Type<'a>, property_type: Type<'a>) -> bool {
    if property_type.is_union() {
        return property_type.types().iter().any(|ty| is_nullable_property_type(obj_type, ty));
    }
    if let Some(name) = property_name_of_literal_type(property_type)
        && let Some(prop_type) = get_type_of_property_of_name(obj_type, &name, None)
    {
        // tsgolint's `isNullishType`: a property that is `any` or `unknown` is not.
        return match obj_type.file().language().is_oxlint {
            true => is_possibly_nullish(prop_type),
            false => is_nullable_type(prop_type),
        };
    }
    let type_name = get_type_name(property_type);
    obj_type.get_index_infos().any(|info| get_type_name(info.key_type()) == type_name)
}

/// `node` is a member access.
fn is_nullable_member_expression(node: Expr) -> bool {
    match node.kind() {
        ExprKind::Index { obj, index, .. } => is_nullable_property_type(obj.ty(), index.ty()),
        ExprKind::Dot { obj, name, .. } => {
            // As it is written, which for `this.#prop` is the name of the symbol.
            let property_name = node.file().slice(name.span());
            let mut properties = obj.ty().get_properties().iter();
            properties.find(|prop| prop.name() == property_name).is_some_and(|prop| prop.has_flags(SymbolFlags::OPTIONAL))
        }
        _ => false,
    }
}

/// `checker.getIndexTypeOfType(type, keyType)`: what an index signature gives for a key of `key_type`.
fn get_index_type_of_type<'a>(object_type: Type<'a>, key_type: Type<'a>) -> Option<Type<'a>> {
    if key_type.has_flags(TypeFlags::NUMBER_LIKE)
        && let Some(number_index_type) = object_type.get_number_index_type()
    {
        return Some(number_index_type);
    }
    match key_type.has_flags(TypeFlags::STRING_LIKE | TypeFlags::NUMBER_LIKE) {
        true => object_type.get_string_index_type(),
        false => None,
    }
}

/// tsgolint's `getNullishCoalescingType`, without what it narrows: whether the target `node` of `??=` is read through
/// an index signature, which with `noUncheckedIndexedAccess` gives an `undefined` that the type of a target has not.
fn tsgolint_reads_index_signature(node: Expr) -> bool {
    match node.kind() {
        ExprKind::Dot { obj, name, .. } => {
            let property_name = node.file().slice(name.span());
            !property_name.starts_with(b"#")
                && get_resolved_type(obj).is_some_and(|base_type| {
                    base_type.get_property(property_name).is_none() && base_type.get_index_infos().next().is_some()
                })
        }
        ExprKind::Index { obj, index, .. } => {
            let (Some(base_type), Some(key_type)) = (get_resolved_type(obj), get_resolved_type(index)) else {
                return false;
            };
            union_constituents(key_type).iter().any(|key_type| {
                let is_property = property_name_of_literal_type(key_type)
                    .is_some_and(|name| base_type.get_property(&name).is_some());
                !is_property && get_index_type_of_type(base_type, key_type).is_some()
            })
        }
        _ => false,
    }
}

/// Whether `node` is `object[key]`, every key that it can have is known and names a property, and
/// one of these properties may be something else than `null` and `undefined`.
fn has_possibly_non_nullish_computed_member_property(node: Expr) -> bool {
    let ExprKind::Index { obj, index, .. } = node.kind() else {
        return false;
    };
    if node.is_chain_root() {
        return false;
    }
    let object_type = get_constrained_type_at_location(obj);
    let mut is_possibly_non_nullish_property = false;
    for key_type in union_constituents(get_constrained_type_at_location(index)) {
        let selected_type = property_name_of_literal_type(key_type)
            .and_then(|name| get_type_of_property_of_name(object_type, &name, None));
        let selected_type = match selected_type {
            // tsgolint's `hasPossiblyNonNullishIndexedRead` also reads through an index signature.
            None if node.file().language().is_oxlint => get_index_type_of_type(object_type, key_type),
            selected_type => selected_type,
        };
        let Some(selected_type) = selected_type else {
            return false;
        };
        is_possibly_non_nullish_property |= is_possibly_non_nullish(selected_type);
    }
    is_possibly_non_nullish_property
}

/// Searches an optional chain for an optional access to an element of an array, which "infects"
/// the types of the rest: in `[{ x: { y: "z" } }][n]?.x?.y` the second `?.` looks unnecessary.
///
/// `node` is a call or a member access, whether or not it is the whole of the chain.
fn option_chain_contains_option_array_index(mut node: Expr) -> bool {
    loop {
        let lhs_node = match node.kind() {
            ExprKind::Call(call) => call.callee(),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            _ => return false,
        };
        if node.is_optional() && is_array_index_expression(lhs_node) {
            return true;
        }
        if lhs_node.is_chain_root() {
            return false;
        }
        node = lhs_node;
    }
}

/// tsgolint 7.0 takes the constraint of a type parameter only. A conditional type that is not resolved, `Awaited<T>`,
/// stays what it is, and nothing is said of it.
fn tsgolint_is_undecided(e: Expr) -> bool {
    e.file().language().is_oxlint
        && union_constituents(e.ty())
            .iter()
            .any(|part| part.has_flags(TypeFlags::CONDITIONAL | TypeFlags::SUBSTITUTION))
}

/// tsgolint's `resolveIndexedAccessType`: `T[K]` is what its one key names or what an index signature gives.
fn tsgolint_resolve_indexed_access_type(ty: Type<'_>) -> Type<'_> {
    let TypeStructure::IndexedAccess { object_type, index_type } = ty.structure() else {
        return ty;
    };
    let object_type = object_type.get_base_constraint_of_type().unwrap_or(object_type);
    let index_type = index_type.get_base_constraint_of_type().unwrap_or(index_type);
    if let Some(name) = property_name_of_literal_type(index_type)
        && let Some(property_type) = object_type.get_type_of_property(&name)
    {
        return property_type;
    }
    let is_index = |flags: TypeFlags| union_constituents(index_type).iter().any(|part| part.has_flags(flags));
    if is_index(TypeFlags::STRING_LIKE)
        && let Some(string_index_type) = object_type.get_string_index_type()
    {
        return string_index_type;
    }
    if is_index(TypeFlags::NUMBER_LIKE)
        && let Some(number_index_type) = object_type.get_number_index_type()
    {
        return number_index_type;
    }
    ty
}

/// The type that is asked about: typescript-eslint's `getConstrainedTypeAtLocation`, or tsgolint's `getResolvedType`,
/// for which of the type variables only a type parameter stands for its constraint. `None` is one without a constraint.
fn get_resolved_type(e: Expr<'_>) -> Option<Type<'_>> {
    if !e.file().language().is_oxlint {
        return Some(get_constrained_type_at_location(e));
    }
    get_constraint_info(e.ty()).constraint_type.map(tsgolint_resolve_indexed_access_type)
}

/// tsgolint's `checkTypeCondition`: whether the type is always truthy, and whether it is always falsy. `never` is
/// falsy. A type that it has no case for is neither: a template literal type, an enum with computed members, `T[K]`.
fn tsgolint_check_type_condition(ty: Type) -> (bool, bool) {
    let flags = ty.flags();
    if flags.intersects(TypeFlags::NEVER) {
        return (false, true);
    }
    if flags.intersects(TypeFlags::INDEXED_ACCESS) {
        return (false, false);
    }
    if ty.is_union() {
        let (mut is_truthy, mut is_falsy) = (true, true);
        for part in ty.types() {
            let (is_part_truthy, is_part_falsy) = tsgolint_check_type_condition(part);
            is_truthy &= is_part_truthy;
            is_falsy &= is_part_falsy;
        }
        return (is_truthy, is_falsy);
    }
    if ty.is_intersection() {
        let mut is_truthy = true;
        for part in ty.types() {
            let (is_part_truthy, is_part_falsy) = tsgolint_check_type_condition(part);
            if is_part_falsy {
                return (false, true);
            }
            is_truthy &= is_part_truthy;
        }
        return (is_truthy, false);
    }
    if flags.intersects(NULLISH_OR_VOID_FLAG) {
        return (false, true);
    }
    let always_truthy =
        TypeFlags::OBJECT | TypeFlags::NON_PRIMITIVE | TypeFlags::ES_SYMBOL | TypeFlags::UNIQUE_ES_SYMBOL;
    if flags.intersects(always_truthy) {
        return (true, false);
    }
    if is_boolean_literal_type(ty) {
        let is_true = is_true_literal_type(ty);
        return (is_true, !is_true);
    }
    let is_truthy = match ty.value() {
        Some(Literal::String(value)) => !value.is_empty(),
        Some(Literal::Number(value)) => value != 0.0 && !value.is_nan(),
        Some(Literal::BigInt { base10, .. }) => base10 != b"0",
        None => return (false, false),
    };
    (is_truthy, !is_truthy)
}

/// tsgolint's `isComparable`: an intersection is if all its parts are, and a type that is not resolved always is.
fn tsgolint_is_comparable(ty: Type, flags: TypeFlags) -> bool {
    if ty.has_flags(flags | TypeFlags::CONDITIONAL | TypeFlags::SUBSTITUTION) {
        return true;
    }
    if ty.is_union() {
        return ty.types().iter().any(|part| tsgolint_is_comparable(part, flags));
    }
    ty.is_intersection() && ty.types().iter().all(|part| tsgolint_is_comparable(part, flags))
}

/// tsgolint's `getPropertyTypeFromBase` for the access `prop_access` to `name`: what the property is declared as, or
/// what a `string` index signature gives. `None`: it knows no type, as for a mapped type without the property.
fn tsgolint_get_property_type_from_base<'a>(
    base_type: Type<'a>,
    prop_access: Expr<'a>,
    name: &[u8],
    is_no_unchecked_indexed_access: bool,
) -> Option<Type<'a>> {
    let apparent_type = base_type.get_apparent_type();
    let property_type = base_type.get_type_of_property(name).or_else(|| apparent_type.get_type_of_property(name));
    if property_type.is_some() {
        return property_type;
    }
    match base_type.get_string_index_type().or_else(|| apparent_type.get_string_index_type()) {
        Some(string_index_type) => (!is_no_unchecked_indexed_access).then_some(string_index_type),
        None if base_type.object_flags().intersects(ObjectFlags::MAPPED) => None,
        None => Some(prop_access.ty()),
    }
}

/// tsgolint's `getTypeFromCallProperty` for `f().b`: `b` of the first part of what `f` returns that is not nullish.
fn tsgolint_get_type_from_call_property<'a>(
    call: Expr<'a>,
    prop_access: Expr<'a>,
    name: &[u8],
    is_no_unchecked_indexed_access: bool,
) -> Option<Type<'a>> {
    let return_type = match call.resolved_signature() {
        Some(signature) => signature.get_return_type(),
        None => call.ty(),
    };
    let base_type = union_constituents(return_type).iter().find(|part| !part.has_flags(NULLISH_OR_VOID_FLAG))?;
    tsgolint_get_property_type_from_base(base_type, prop_access, name, is_no_unchecked_indexed_access)
}

/// Reports `expression` if its type is always truthy or always falsy.
fn check_node<'a>(expression: Expr<'a>, cx: &mut Context<'a>) {
    let mut node = expression;
    let (expression, is_unary_not_argument) = loop {
        let (mut expression, mut is_unary_not_argument) = (node, false);
        while let ExprKind::Unary {
            op: UnOp::Not,
            operand,
        } = expression.kind()
        {
            expression = operand;
            is_unary_not_argument = !is_unary_not_argument;
        }

        // The type of an element of an array does not tell that the index may be out of bounds.
        if !cx.state.is_no_unchecked_indexed_access && is_array_index_expression(expression) {
            return;
        }

        // The left side has been checked as the left side of a logical expression. The right side is
        // a condition only if the whole is one. Not so for `??`: `nullBool ?? true` is common, so the
        // type of the whole is looked at.
        let ExprKind::Binary {
            op: BinOp::And | BinOp::Or,
            right,
            ..
        } = expression.kind()
        else {
            break (expression, is_unary_not_argument);
        };
        let is_assertion_argument_checked = cx.state.is_assertion_argument_checked;
        let known = &mut cx.state.only_used_for_truthiness;
        if !is_only_used_for_truthiness(expression, known, is_assertion_argument_checked) {
            return;
        }
        node = right;
    };

    let Some(ty) = get_resolved_type(expression) else {
        return;
    };
    if is_conditional_always_necessary(ty) {
        return;
    }
    let is_oxlint = cx.language().is_oxlint;
    let (is_truthy, is_falsy) = match is_oxlint {
        true => tsgolint_check_type_condition(ty),
        false => (!is_possibly_falsy(ty), !is_possibly_truthy(ty)),
    };
    let message = if is_type_flag_set(ty, TypeFlags::NEVER) {
        NEVER
    } else if is_falsy {
        if is_unary_not_argument { ALWAYS_TRUTHY } else { ALWAYS_FALSY }
    } else if is_truthy {
        if is_unary_not_argument { ALWAYS_FALSY } else { ALWAYS_TRUTHY }
    } else {
        return;
    };
    // oxlint points at what the type is of: the `a` of `!a`. tsgolint does not say the type of a literal.
    let is_literal = tsgolint_is_self_explanatory(expression);
    cx.report(if is_oxlint && !is_literal { expression } else { node }, message)
        .comments_apply_at(node)
        .labels_with(|labels| {
            if !is_literal {
                labels.first(format!("Type: {}", tsgolint_type_name(ty)));
                labels.push(node.outer_span(), "");
            }
        });
}

/// tsgolint's `typeNameForDiagnostic`: no more than 120 characters.
fn tsgolint_type_name(ty: Type) -> String {
    tsgolint_truncated(&ty.to_text())
}

/// tsgolint's `truncateTypeNameForDiagnostic`
fn tsgolint_truncated(text: &[u8]) -> String {
    use bstr::ByteSlice;
    match text.chars().count() > 120 {
        true => text.chars().take(117).chain("...".chars()).collect(),
        false => text.chars().collect(),
    }
}

/// Of a union of which two parts are written the same, each text once: tsgolint names what each key of `a?.[k]` gives.
fn tsgolint_distinct_type_names(ty: Type) -> String {
    let mut names: Vec<Vec<u8>> = union_constituents(ty).iter().map(|it| it.to_text()).collect();
    let (count, mut seen) = (names.len(), rustc_hash::FxHashSet::default());
    names.retain(|it| seen.insert(it.clone()));
    match names.len() == count {
        true => tsgolint_type_name(ty),
        false => tsgolint_truncated(&names.join(&b" | "[..])),
    }
}

/// tsgolint's `isSelfExplanatoryLiteral`: it does not say the type of these.
fn tsgolint_is_self_explanatory(e: Expr) -> bool {
    matches!(
        e.tag(),
        ExprTag::True | ExprTag::False | ExprTag::Null | ExprTag::Number | ExprTag::BigInt | ExprTag::String
    ) || matches!(e.kind(), ExprKind::Template(template) if template.exprs().is_empty())
}

fn check_node_for_nullish<'a>(node: Expr<'a>, is_assignment_target: bool, cx: &mut Context<'a>) {
    let Some(ty) = get_resolved_type(node) else {
        return;
    };
    if is_type_flag_set(ty, ANY_UNKNOWN_OR_TYPE_VARIABLE_FLAG) {
        return;
    }
    if is_assignment_target
        && cx.state.is_no_unchecked_indexed_access
        && cx.language().is_oxlint
        && tsgolint_reads_index_signature(node)
    {
        return;
    }
    let is_chain_expression = node.is_chain_root();

    let message = if is_type_flag_set(ty, TypeFlags::NEVER) {
        NEVER
    } else if !is_possibly_nullish(ty)
        // For tsgolint `a?.[b]` is an access like `a[b]`.
        && ((is_chain_expression && !cx.language().is_oxlint) || !is_nullable_member_expression(node))
    {
        // The type of an element of an array does not tell that the index may be out of bounds.
        if !cx.state.is_no_unchecked_indexed_access
            && (is_array_index_expression(node)
                || is_chain_expression
                    && !matches!(node.kind(), ExprKind::NonNull(_))
                    && option_chain_contains_option_array_index(node))
        {
            return;
        }
        NEVER_NULLISH
    } else if is_always_nullish(ty) && !has_possibly_non_nullish_computed_member_property(node) {
        ALWAYS_NULLISH
    } else {
        return;
    };
    cx.report(node, message).labels_with(|labels| {
        if !tsgolint_is_self_explanatory(node) {
            labels.first(format!("Type: {}", tsgolint_type_name(ty)));
            labels.push(node, "");
        }
    });
}

/// The operator after `left`. In `switch (left) { case node: }` there is none: `node`.
fn operator_span<'a>(node: Expr<'a>, (left, right): (Expr<'a>, Expr<'a>), operator: BinOp) -> Span {
    if node == right {
        return node.outer_span();
    }
    let start = skip_trivia(left.file().text(), left.outer_span().end);
    Span::new(start, start + bin_op_text(operator).len() as u32)
}

/// Reports a comparison of two literal types, and one with `null` or `undefined` of what cannot be
/// that, which TypeScript does not report: https://github.com/microsoft/TypeScript/issues/37160
fn check_if_bool_expression_is_necessary_conditional<'a>(
    node: Expr<'a>,
    left: Expr<'a>,
    right: Expr<'a>,
    operator: BinOp,
    cx: &Context<'a>,
) {
    if tsgolint_is_undecided(left) || tsgolint_is_undecided(right) {
        return;
    }
    let (Some(left_type), Some(right_type)) = (get_resolved_type(left), get_resolved_type(right)) else {
        return;
    };

    let condition_is_true = match (to_static_value(left_type), to_static_value(right_type)) {
        (Some(left), Some(right)) => boolean_comparison(&left, operator, &right),
        _ => big_int_comparison(left_type, operator, right_type),
    };
    if let Some(condition_is_true) = condition_is_true {
        // oxlint points at the left operand, which for a `case` is what the `switch` compares.
        let place = if cx.language().is_oxlint { left.outer_span() } else { node.span() };
        cx.report(place, COMPARISON_BETWEEN_LITERAL_TYPES)
            .comments_apply_at(operator_span(node, (left, right), operator))
            .data("left", left_type.to_text())
            .data("operator", bin_op_text(operator))
            .data("right", right_type.to_text())
            .data("trueOrFalse", if condition_is_true { "true" } else { "false" })
            .labels_with(|labels| {
                labels.first(format!("Type: {}", tsgolint_type_name(left_type)));
                labels.push(right.outer_span(), format!("Type: {}", tsgolint_type_name(right_type)));
                labels.push(operator_span(node, (left, right), operator), "");
            });
        return;
    }

    if !cx.state.is_strict_null_checks {
        return;
    }
    let is_comparable = |ty: Type<'a>, flag: TypeFlags| {
        // `any`, `unknown` and a naked type parameter can be compared with anything.
        let mut flag = flag | ANY_UNKNOWN_OR_TYPE_VARIABLE_FLAG;
        if matches!(operator, BinOp::EqEq | BinOp::NotEq) {
            flag |= NULLISH_OR_VOID_FLAG;
        }
        match cx.language().is_oxlint {
            true => tsgolint_is_comparable(ty, flag),
            false => is_type_flag_set(ty, flag),
        }
    };
    let undefined_or_void = TypeFlags::UNDEFINED | TypeFlags::VOID;
    let (left_flags, right_flags) = (left_type.flags(), right_type.flags());
    if left_flags == TypeFlags::UNDEFINED && !is_comparable(right_type, undefined_or_void)
        || right_flags == TypeFlags::UNDEFINED && !is_comparable(left_type, undefined_or_void)
        || left_flags == TypeFlags::NULL && !is_comparable(right_type, TypeFlags::NULL)
        || right_flags == TypeFlags::NULL && !is_comparable(left_type, TypeFlags::NULL)
    {
        // The first label of tsgolint 7.0 starts where the token before the left operand ends.
        let operand = left.outer_span();
        let start = cx.file().end_of_token_before(operand.start);
        let place = if cx.language().is_oxlint { Span::new(start, operand.end) } else { node.span() };
        cx.report(place, NO_OVERLAP_BOOLEAN_EXPRESSION)
            .comments_apply_at(operator_span(node, (left, right), operator))
            .labels_with(|labels| {
                // And so does the second.
                let operand = right.outer_span();
                let operand = Span::new(cx.file().end_of_token_before(operand.start), operand.end);
                labels.first(format!("Type: {}", tsgolint_type_name(left_type)));
                labels.push(operand, format!("Type: {}", tsgolint_type_name(right_type)));
                labels.push(operator_span(node, (left, right), operator), "");
            });
    }
}

/// The `property` of a `MemberExpression` that is an `Identifier`.
#[derive(Copy, Clone)]
enum Property<'a> {
    Name(Ident<'a>),
    Computed(Expr<'a>),
}

/// Whether the member access `node` can be `null` or `undefined` only because its object can:
/// the `foo?.bar` of a `{ bar: { baz: string } } | null`.
fn is_member_expression_nullable_origin_from_object<'a>(node: Expr<'a>, cx: &Context<'a>) -> bool {
    let (object, property) = match node.kind() {
        ExprKind::Dot { obj, name, .. } if !node.file().slice(name.span()).starts_with(b"#") => {
            (obj, Property::Name(name))
        }
        // tsgolint 7.0 looks at every index: `a?.["b"]`.
        ExprKind::Index { obj, index, .. }
            if matches!(index.kind(), ExprKind::Ident(_)) || node.file().language().is_oxlint =>
        {
            (obj, Property::Computed(index))
        }
        _ => return false,
    };
    let prev_type = get_constrained_type_at_location(object);
    if !prev_type.is_union() {
        return false;
    }
    let is_own_nullable = prev_type.types().iter().any(|ty| match property {
        Property::Computed(index) => {
            is_nullable_property_type(ty, get_constrained_type_at_location(index))
        }
        Property::Name(name) => match get_type_of_property_of_name(ty, name.bytes(), None) {
            Some(prop_type) => is_nullable_type(prop_type),
            None => ty.get_index_infos().any(|info| {
                get_type_name(info.key_type()) == b"string"
                    && (cx.state.is_no_unchecked_indexed_access || is_nullable_type(info.ty()))
            }),
        },
    });
    !is_own_nullable && is_nullable_type(prev_type)
}

fn is_call_expression_nullable_origin_from_callee(callee: Expr) -> bool {
    let prev_type = get_constrained_type_at_location(callee);
    if !prev_type.is_union() {
        return false;
    }
    let is_own_nullable = prev_type.types().iter().any(|ty| {
        ty.get_call_signatures().iter().any(|signature| is_nullable_type(signature.get_return_type()))
    });
    !is_own_nullable && is_nullable_type(prev_type)
}

fn is_optionable_expression<'a>(node: Expr<'a>, cx: &Context<'a>) -> bool {
    let Some(ty) = get_resolved_type(node) else {
        return true;
    };
    if is_conditional_always_necessary(ty) {
        return true;
    }
    is_nullable_type(ty)
        && match node.kind() {
            _ if node.is_chain_root() => true,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                !is_member_expression_nullable_origin_from_object(node, cx)
            }
            ExprKind::Call(call) => !is_call_expression_nullable_origin_from_callee(call.callee()),
            _ => true,
        }
}

/// `a[b]`, not `a?.[b]`, unless it is an element of a tuple at an index that is written as a number.
fn tsgolint_is_unguarded_element_access(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Index { obj, index, .. } => {
            !e.is_optional()
                && !(index.tag() == ExprTag::Number && get_constrained_type_at_location(obj).is_tuple_type())
        }
        _ => false,
    }
}

/// What tsgolint leaves alone: `e` is such an access, or it ends with an optional step and there is one before that.
fn tsgolint_has_unguarded_element_access(e: Expr) -> bool {
    if tsgolint_is_unguarded_element_access(e) {
        return true;
    }
    let mut at = e;
    while e.is_optional() {
        if tsgolint_is_unguarded_element_access(at) {
            return true;
        }
        at = match at.kind() {
            ExprKind::Index { obj, .. } | ExprKind::Dot { obj, .. } => obj,
            ExprKind::Call(call) => call.callee(),
            _ => break,
        };
    }
    false
}

fn check_optional_chain<'a>(node: Expr<'a>, cx: &mut Context<'a>) {
    // Only this step of the chain is of interest.
    if !node.is_optional() {
        return;
    }
    let (node_to_check, fix) = match node.kind() {
        ExprKind::Dot { obj, .. } => (obj, "."),
        ExprKind::Index { obj, .. } => (obj, ""),
        ExprKind::Call(call) => (call.callee(), ""),
        _ => return,
    };
    // The type of an element of an array does not tell that the index may be out of bounds.
    if !cx.state.is_no_unchecked_indexed_access
        && match cx.language().is_oxlint {
            true => tsgolint_has_unguarded_element_access(node_to_check),
            false => option_chain_contains_option_array_index(node),
        }
    {
        return;
    }
    if is_optionable_expression(node_to_check, cx) {
        return;
    }
    let is_no_unchecked_indexed_access = cx.state.is_no_unchecked_indexed_access;
    // What tsgolint 7.0 goes by, where that is another type.
    let goes_by = |node_to_check: Expr<'a>| match node_to_check.kind() {
        // `a?.b?.c`: what `b` is declared as, whatever is known of `a?.b` here.
        ExprKind::Dot { obj, name, .. } if node_to_check.is_optional() => {
            let base_type = get_constrained_type_at_location(obj).get_non_nullable_type();
            let name = name.bytes();
            let property_type =
                tsgolint_get_property_type_from_base(base_type, node_to_check, name, is_no_unchecked_indexed_access);
            Some(property_type.unwrap_or_else(|| {
                // A mapped type without `?` gives no `undefined`: the type here has only that of the `?.`.
                let is_optional =
                    matches!(base_type.structure(), TypeStructure::Mapped { optional: MappedModifier::Add, .. });
                let is_mapped_type_without_optional = !is_no_unchecked_indexed_access
                    && base_type.object_flags().intersects(ObjectFlags::MAPPED)
                    && !is_optional;
                match is_mapped_type_without_optional {
                    true => node_to_check.ty().get_non_nullable_type(),
                    false => node_to_check.ty(),
                }
            }))
        }
        // `a?.[b]?.c`: it looks up what `a?.[b]` gives only where the type of `b` is that of string literals.
        ExprKind::Index { index, .. } if node_to_check.is_optional() => {
            let is_looked_up = union_constituents(index.ty()).iter().all(|it| it.is_string_literal());
            (!is_looked_up).then(|| node_to_check.ty())
        }
        // `a?.b().c?.d`: what `c` is declared as in what `b` returns.
        ExprKind::Dot { obj, name, .. } if obj.tag() == ExprTag::Call => {
            tsgolint_get_type_from_call_property(obj, node_to_check, name.bytes(), is_no_unchecked_indexed_access)
        }
        // `a?.b()[0]?.d`: as it is at the location, with the `undefined` of the `?.` further left.
        ExprKind::Index { obj, .. } if obj.tag() == ExprTag::Call => Some(node_to_check.ty()),
        // `a?.b.c?.d`: with the `undefined` of the `?.` further left.
        ExprKind::Dot { .. } | ExprKind::Index { .. } => Some(get_constrained_type_at_location(node_to_check)),
        _ => None,
    };
    if cx.language().is_oxlint {
        let is_property_of_call =
            matches!(node_to_check.kind(), ExprKind::Dot { obj, .. } if obj.tag() == ExprTag::Call);
        match goes_by(node_to_check) {
            Some(ty) if is_nullable_type(ty) => return,
            // It finds no type for `f().b` where `b` is no property of what `f` returns, and says nothing.
            None if is_property_of_call => return,
            _ => {}
        }
    }
    // `f()?.a`: tsgolint 7.0 goes by the first signature of `f`, whichever is called.
    if cx.language().is_oxlint
        && let ExprKind::Call(call) = node_to_check.kind()
        && union_constituents(get_constrained_type_at_location(call.callee())).iter().any(|part| {
            get_call_signatures_of_type(part).first().is_some_and(|it| is_possibly_nullish(it.get_return_type()))
        })
    {
        return;
    }

    let start = skip_trivia(cx.text(), node_to_check.outer_span().end);
    let question_dot_operator = Span::new(start, start + 2);
    if cx.slice(question_dot_operator) != b"?." {
        return;
    }
    // oxlint points at what is before the `?.`.
    let place = if cx.language().is_oxlint { node_to_check.outer_span() } else { question_dot_operator };
    cx.report(place, NEVER_OPTIONAL_CHAIN)
        .comments_apply_at(question_dot_operator)
        .labels_with(|labels| {
            // The type that it goes by, without the `undefined` of a `?.` further left.
            let ty = goes_by(node_to_check).unwrap_or_else(|| get_constrained_type_at_location(node_to_check));
            labels.first(format!("Type: {}", tsgolint_distinct_type_names(ty.get_non_nullable_type())));
            labels.push(question_dot_operator, "");
        })
        .suggest(SUGGEST_REMOVE_OPTIONAL_CHAIN, |fixer| fixer.replace(question_dot_operator, fix));
}

impl NoUnnecessaryCondition {
    fn check_if_loop_is_necessary_conditional<'a>(&self, test: Expr<'a>, cx: &mut Context<'a>) {
        let is_allowed = match self.allow_constant_loop_conditions {
            AllowConstantLoopConditions::OnlyAllowedLiterals => match test.kind() {
                ExprKind::True | ExprKind::False => true,
                ExprKind::Number(value) => value == 0.0 || value == 1.0,
                _ => false,
            },
            AllowConstantLoopConditions::Always => {
                is_true_literal_type(get_constrained_type_at_location(test))
            }
            AllowConstantLoopConditions::Never => false,
        };
        if !is_allowed {
            check_node(test, cx);
        }
    }

    fn check_type_predicate<'a>(node: Expr<'a>, cx: &mut Context<'a>) {
        if let Some(truthiness_asserted_argument) = find_truthiness_asserted_argument(node) {
            check_node(truthiness_asserted_argument, cx);
        }
        let Some(type_guard_asserted_argument) = find_type_guard_asserted_argument(node) else {
            return;
        };
        let type_of_argument = get_constrained_type_at_location(type_guard_asserted_argument.argument);
        let asserted_type = type_guard_asserted_argument.ty;
        // `any` is assignable to everything. Beyond that the two types have to be equivalent, or
        // the asserted type a union that the type of the argument is a subtype of: a structural
        // subtype whose other members are optional in the asserted type is no reason to report.
        let is_already_type = match cx.language().is_oxlint {
            // tsgolint: the type of the argument is the asserted type itself.
            true => type_of_argument == asserted_type,
            false => {
                !type_of_argument.has_flags(TypeFlags::ANY | TypeFlags::UNKNOWN)
                    && type_of_argument.is_assignable_to(asserted_type)
                    && (asserted_type.is_assignable_to(type_of_argument) || asserted_type.is_union())
            }
        };
        if is_already_type {
            cx.report(type_guard_asserted_argument.argument, TYPE_GUARD_ALREADY_IS_TYPE)
                .data(
                    "typeGuardOrAssertionFunction",
                    match type_guard_asserted_argument.asserts {
                        true => "assertion function",
                        false => "type guard",
                    },
                )
                .labels_with(|labels| {
                    let (value, predicate) = (tsgolint_type_name(type_of_argument), tsgolint_type_name(asserted_type));
                    labels.first(format!("Type {value} already satisfies predicate type {predicate}"));
                    labels.push(type_guard_asserted_argument.argument, "");
                });
        }
    }

    fn check_call_expression<'a>(&self, node: Expr<'a>, cx: &mut Context<'a>) {
        if self.check_type_predicates {
            Self::check_type_predicate(node, cx);
        }

        // In something like `arr.filter(x => condition)`, `condition` is checked.
        if !is_array_method_call_with_predicate(node) {
            return;
        }
        let Some(callback) = node.as_call().and_then(|call| call.args().first()) else {
            return;
        };
        // tsgolint 7.0 goes by the type that the function returns, also where what it returns is written there.
        if cx.language().is_oxlint {
            self.tsgolint_check_predicate_function(callback, cx);
            return;
        }
        if let ExprKind::Fn(function) = callback.kind() {
            match function.body() {
                // `() => something`
                FnBody::Expr(body) => return check_node(body, cx),
                // `() => { return something; }`
                FnBody::Block(statements) => {
                    if statements.len() == 1
                        && let Some(StmtKind::Return(Some(argument))) =
                            statements.first().map(Stmt::kind)
                    {
                        return check_node(argument, cx);
                    }
                }
                FnBody::None => {}
            }
        }

        // Otherwise the type of the function as a whole is looked at.
        let signatures = get_call_signatures_of_type(get_constrained_type_at_location(callback));
        if signatures.is_empty() {
            // Not callable: `any`
            return;
        }
        let first_return_type =
            signatures.first().and_then(|it| get_constraint_info(it.get_return_type()).constraint_type);
        let (mut has_falsy_return_types, mut has_truthy_return_types) = (false, false);
        for signature in signatures {
            let Some(constraint_type) = get_constraint_info(signature.get_return_type()).constraint_type
            else {
                return;
            };
            if is_type_any_type(constraint_type)
                || is_type_unknown_type(constraint_type)
                || constraint_type.is_unresolved()
            {
                return;
            }
            has_falsy_return_types |= is_possibly_falsy(constraint_type);
            has_truthy_return_types |= is_possibly_truthy(constraint_type);
            if has_falsy_return_types && has_truthy_return_types {
                return;
            }
        }
        Self::report_predicate_function(callback, !has_falsy_return_types, first_return_type, cx);
    }

    /// Reports the callback of an array method, which returns `return_type`, always truthy or always falsy.
    fn report_predicate_function<'a>(
        callback: Expr<'a>,
        is_truthy: bool,
        return_type: Option<Type<'a>>,
        cx: &Context<'a>,
    ) {
        // oxlint points at the body of a function that is written there, as at a condition.
        let body = match callback.kind() {
            ExprKind::Fn(function) if cx.language().is_oxlint => match function.body() {
                FnBody::Expr(body) => Some(body.outer_span()),
                _ => function.body_span(),
            },
            _ => None,
        };
        let (place, message) = match (body, is_truthy) {
            (Some(body), true) => (body, ALWAYS_TRUTHY),
            (Some(body), false) => (body, ALWAYS_FALSY),
            (None, true) => (callback.span(), ALWAYS_TRUTHY_FUNC),
            (None, false) => (callback.span(), ALWAYS_FALSY_FUNC),
        };
        cx.report(place, message).labels_with(|labels| {
            let is_literal = matches!(callback.kind(), ExprKind::Fn(function)
                if matches!(function.body(), FnBody::Expr(body) if tsgolint_is_self_explanatory(body)));
            if !is_literal && let Some(ty) = return_type {
                labels.first(format!("Return type: {}", tsgolint_type_name(ty)));
                labels.push(place, "");
            }
        });
    }

    /// tsgolint's `checkPredicateFunction`: each call signature of the callback by itself.
    fn tsgolint_check_predicate_function<'a>(&self, callback: Expr<'a>, cx: &Context<'a>) {
        for signature in get_constrained_type_at_location(callback).get_call_signatures() {
            // A type guard for what its parameter is already.
            if self.check_type_predicates
                && let Some(type_predicate) = signature.get_type_predicate()
                && type_predicate.kind() == TypePredicateKind::Identifier
                && let Some(parameter) =
                    type_predicate.parameter_index().and_then(|index| signature.parameters().get(index))
                && let Some(predicate_type) = type_predicate.ty()
                && parameter.get_type().is_assignable_to(predicate_type)
            {
                // It points at the parameter where this file declares it.
                let place = match parameter.value_declaration() {
                    Some(declaration) if declaration.is_in_linted_file() => declaration.span(),
                    _ => callback.outer_span(),
                };
                cx.report(place, TYPE_GUARD_ALREADY_IS_TYPE)
                    .data("typeGuardOrAssertionFunction", "type guard")
                    .labels_with(|labels| {
                        let value = tsgolint_type_name(parameter.get_type());
                        let predicate = tsgolint_type_name(predicate_type);
                        labels.first(format!("Type {value} already satisfies predicate type {predicate}"));
                        labels.push(place, "");
                    });
                return;
            }
            let return_type = signature.get_return_type();
            let return_type = get_constraint_of_type_parameter(return_type).unwrap_or(return_type);
            let (is_truthy, is_falsy) = tsgolint_check_type_condition(return_type);
            if is_truthy || is_falsy {
                Self::report_predicate_function(callback, is_truthy, Some(return_type), cx);
            }
        }
    }

    fn check_assignment_expression<'a>(node: Expr<'a>, cx: &mut Context<'a>) {
        // `a ||= b` is `a || (a = b)`.
        match node.kind() {
            ExprKind::Assign {
                op: Some(BinOp::And | BinOp::Or),
                target,
                ..
            } => check_node(target, cx),
            ExprKind::Assign {
                op: Some(BinOp::Nullish),
                target,
                ..
            } => check_node_for_nullish(target, true, cx),
            _ => {}
        }
    }

    fn check_binary_expression<'a>(node: Expr<'a>, cx: &mut Context<'a>) {
        let ExprKind::Binary { op, left, right } = node.kind() else {
            return;
        };
        match op {
            BinOp::Lt
            | BinOp::Gt
            | BinOp::Le
            | BinOp::Ge
            | BinOp::EqEq
            | BinOp::EqEqEq
            | BinOp::NotEq
            | BinOp::NotEqEq => {
                check_if_bool_expression_is_necessary_conditional(node, left, right, op, cx);
            }
            BinOp::Nullish => check_node_for_nullish(left, false, cx),
            // Only the left side: the right side need not be a condition at all. It is checked
            // if the whole is used as one.
            BinOp::And | BinOp::Or => check_node(left, cx),
            _ => {}
        }
    }
}

impl Rule for NoUnnecessaryCondition {
    const META: Meta = Meta::typescript("no-unnecessary-condition", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = CONDITIONS.finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let allow_constant_loop_conditions = match (
            options.bool("allowConstantLoopConditions"),
            options.str("allowConstantLoopConditions"),
        ) {
            (Some(true), _) | (_, Some("always")) => AllowConstantLoopConditions::Always,
            (_, Some("only-allowed-literals")) => AllowConstantLoopConditions::OnlyAllowedLiterals,
            _ => AllowConstantLoopConditions::Never,
        };
        NoUnnecessaryCondition {
            allow_constant_loop_conditions,
            allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing: options
                .bool_or("allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing", false),
            check_type_predicates: options.bool_or("checkTypePredicates", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let compiler_options = file.type_checker().compiler_options();
        if !is_strict_compiler_option_enabled(compiler_options, CompilerOption::StrictNullChecks)
            && !self.allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing
        {
            return CONDITIONS.finish();
        }
        CONDITIONS
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let compiler_options = file.type_checker().compiler_options();
        let flags = State {
            is_strict_null_checks: is_strict_compiler_option_enabled(
                compiler_options,
                CompilerOption::StrictNullChecks,
            ),
            is_no_unchecked_indexed_access: is_compiler_option_enabled(
                compiler_options,
                CompilerOption::NoUncheckedIndexedAccess,
            ),
            only_used_for_truthiness: AncestorMemo::default(),
            is_assertion_argument_checked: file.language().is_oxlint && self.check_type_predicates,
        };
        Some(flags)
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        match node {
            Node::Expr(node) => self.expr(node, cx),
            Node::Stmt(node) => self.stmt(node, cx),
            Node::Case(node) => self.case(node, cx),
            _ => {}
        }
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Assign => Self::check_assignment_expression(node, cx),
            ExprTag::Binary => Self::check_binary_expression(node, cx),
            ExprTag::Call => {
                self.check_call_expression(node, cx);
                check_optional_chain(node, cx);
            }
            ExprTag::Dot | ExprTag::Index => check_optional_chain(node, cx),
            ExprTag::Cond => {
                if let ExprKind::Cond { test, .. } = node.kind() {
                    check_node(test, cx);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match node.kind() {
            StmtKind::If { test, .. } => check_node(test, cx),
            StmtKind::DoWhile { test, .. }
            | StmtKind::While { test, .. }
            | StmtKind::For {
                test: Some(test), ..
            } => self.check_if_loop_is_necessary_conditional(test, cx),
            _ => {}
        }
    }

    fn case<'a>(&self, node: Case<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(test) = node.test()
            && let Node::Stmt(parent) = node.parent()
            && let StmtKind::Switch { expr: discriminant, .. } = parent.kind()
        {
            check_if_bool_expression_is_necessary_conditional(
                test,
                discriminant,
                test,
                BinOp::EqEqEq,
                cx,
            );
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        ts_utils::report_at_line_zero(cx, NO_STRICT_NULL_CHECK);
    }
}
