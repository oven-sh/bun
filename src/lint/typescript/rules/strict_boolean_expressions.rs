use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    CompilerOption, is_strict_compiler_option_enabled, is_true_literal_type, is_type_parameter,
    union_constituents,
};
use bun_lint::types::utils::{
    find_truthiness_asserted_argument, get_constrained_type_at_location,
    is_array_method_call_with_predicate, is_type_array_type_or_union_of_array_types,
};
use bun_lint::types::{Type, TypeFlags};
use bun_lint::utils::estree_span;
use bun_lint::utils::ts_utils::{WrappingFixerParams, get_wrapping_fixer, is_parenless_arrow_function};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

/// Disallow certain types in boolean expressions.
pub struct StrictBooleanExpressions {
    allow_any: bool,
    allow_nullable_boolean: bool,
    allow_nullable_enum: bool,
    allow_nullable_number: bool,
    allow_nullable_object: bool,
    allow_nullable_string: bool,
    allow_number: bool,
    allow_rule_to_run_without_strict_null_checks: bool,
    allow_string: bool,
}

const CONDITION_ERROR_ANY: Message = Message::new(
    "conditionErrorAny",
    "Unexpected any value in {{context}}. An explicit comparison or type conversion is required.",
);
const CONDITION_ERROR_NULLABLE_BOOLEAN: Message = Message::new(
    "conditionErrorNullableBoolean",
    "Unexpected nullable boolean value in {{context}}. Please handle the nullish case explicitly.",
);
const CONDITION_ERROR_NULLABLE_ENUM: Message = Message::new(
    "conditionErrorNullableEnum",
    "Unexpected nullable enum value in {{context}}. Please handle the nullish/zero/NaN cases explicitly.",
);
const CONDITION_ERROR_NULLABLE_NUMBER: Message = Message::new(
    "conditionErrorNullableNumber",
    "Unexpected nullable number value in {{context}}. Please handle the nullish/zero/NaN cases explicitly.",
);
const CONDITION_ERROR_NULLABLE_OBJECT: Message = Message::new(
    "conditionErrorNullableObject",
    "Unexpected nullable object value in {{context}}. An explicit null check is required.",
);
const CONDITION_ERROR_NULLABLE_STRING: Message = Message::new(
    "conditionErrorNullableString",
    "Unexpected nullable string value in {{context}}. Please handle the nullish/empty cases explicitly.",
);
const CONDITION_ERROR_NULLISH: Message = Message::new(
    "conditionErrorNullish",
    "Unexpected nullish value in conditional. The condition is always false.",
);
const CONDITION_ERROR_NUMBER: Message = Message::new(
    "conditionErrorNumber",
    "Unexpected number value in {{context}}. An explicit zero/NaN check is required.",
);
const CONDITION_ERROR_OBJECT: Message = Message::new(
    "conditionErrorObject",
    "Unexpected object value in {{context}}. The condition is always true.",
);
const CONDITION_ERROR_OTHER: Message = Message::new(
    "conditionErrorOther",
    "Unexpected value in conditional. A boolean expression is required.",
);
const CONDITION_ERROR_STRING: Message = Message::new(
    "conditionErrorString",
    "Unexpected string value in {{context}}. An explicit empty string check is required.",
);
const CONDITION_FIX_CAST_BOOLEAN: Message = Message::new(
    "conditionFixCastBoolean",
    "Explicitly convert value to a boolean (`Boolean(value)`)",
);
const CONDITION_FIX_COMPARE_ARRAY_LENGTH_NONZERO: Message = Message::new(
    "conditionFixCompareArrayLengthNonzero",
    "Change condition to check array's length (`value.length > 0`)",
);
const CONDITION_FIX_COMPARE_ARRAY_LENGTH_ZERO: Message = Message::new(
    "conditionFixCompareArrayLengthZero",
    "Change condition to check array's length (`value.length === 0`)",
);
const CONDITION_FIX_COMPARE_EMPTY_STRING: Message = Message::new(
    "conditionFixCompareEmptyString",
    "Change condition to check for empty string (`value !== \"\"`)",
);
const CONDITION_FIX_COMPARE_FALSE: Message = Message::new(
    "conditionFixCompareFalse",
    "Change condition to check if false (`value === false`)",
);
const CONDITION_FIX_COMPARE_NAN: Message = Message::new(
    "conditionFixCompareNaN",
    "Change condition to check for NaN (`!Number.isNaN(value)`)",
);
const CONDITION_FIX_COMPARE_NULLISH: Message = Message::new(
    "conditionFixCompareNullish",
    "Change condition to check for null/undefined (`value != null`)",
);
const CONDITION_FIX_COMPARE_STRING_LENGTH: Message = Message::new(
    "conditionFixCompareStringLength",
    "Change condition to check string's length (`value.length !== 0`)",
);
const CONDITION_FIX_COMPARE_TRUE: Message = Message::new(
    "conditionFixCompareTrue",
    "Change condition to check if true (`value === true`)",
);
const CONDITION_FIX_COMPARE_ZERO: Message =
    Message::new("conditionFixCompareZero", "Change condition to check for 0 (`value !== 0`)");
const CONDITION_FIX_DEFAULT_EMPTY_STRING: Message = Message::new(
    "conditionFixDefaultEmptyString",
    "Explicitly treat nullish value the same as an empty string (`value ?? \"\"`)",
);
const CONDITION_FIX_DEFAULT_FALSE: Message = Message::new(
    "conditionFixDefaultFalse",
    "Explicitly treat nullish value the same as false (`value ?? false`)",
);
const CONDITION_FIX_DEFAULT_ZERO: Message = Message::new(
    "conditionFixDefaultZero",
    "Explicitly treat nullish value the same as 0 (`value ?? 0`)",
);
const EXPLICIT_BOOLEAN_RETURN_TYPE: Message = Message::new(
    "explicitBooleanReturnType",
    "Add an explicit `boolean` return type annotation.",
);
const NO_STRICT_NULL_CHECK: Message = Message::new(
    "noStrictNullCheck",
    "This rule requires the `strictNullChecks` compiler option to be turned on to function correctly.",
);
const PREDICATE_CANNOT_BE_ASYNC: Message = Message::new(
    "predicateCannotBeAsync",
    "Predicate function should not be 'async'; expected a boolean return type.",
);

#[derive(Copy, Clone, PartialEq, Eq)]
enum ConditionError {
    Any,
    NullableBoolean,
    NullableEnum,
    NullableNumber,
    NullableObject,
    NullableString,
    Nullish,
    Number,
    Object,
    Other,
    String,
}

impl ConditionError {
    fn message(self) -> Message {
        match self {
            ConditionError::Any => CONDITION_ERROR_ANY,
            ConditionError::NullableBoolean => CONDITION_ERROR_NULLABLE_BOOLEAN,
            ConditionError::NullableEnum => CONDITION_ERROR_NULLABLE_ENUM,
            ConditionError::NullableNumber => CONDITION_ERROR_NULLABLE_NUMBER,
            ConditionError::NullableObject => CONDITION_ERROR_NULLABLE_OBJECT,
            ConditionError::NullableString => CONDITION_ERROR_NULLABLE_STRING,
            ConditionError::Nullish => CONDITION_ERROR_NULLISH,
            ConditionError::Number => CONDITION_ERROR_NUMBER,
            ConditionError::Object => CONDITION_ERROR_OBJECT,
            ConditionError::Other => CONDITION_ERROR_OTHER,
            ConditionError::String => CONDITION_ERROR_STRING,
        }
    }
}

/// A set of upstream's `VariantType`s.
type VariantTypes = u16;
const ANY: VariantTypes = 1 << 0;
const BOOLEAN: VariantTypes = 1 << 1;
const ENUM: VariantTypes = 1 << 2;
const NEVER: VariantTypes = 1 << 3;
const NULLISH: VariantTypes = 1 << 4;
const NUMBER: VariantTypes = 1 << 5;
const OBJECT: VariantTypes = 1 << 6;
const STRING: VariantTypes = 1 << 7;
const TRUTHY_BOOLEAN: VariantTypes = 1 << 8;
const TRUTHY_NUMBER: VariantTypes = 1 << 9;
const TRUTHY_STRING: VariantTypes = 1 << 10;

/// A call of `getWrappingFixer` whose `wrap` is `` code => `${before}${code}${after}` ``.
#[derive(Copy, Clone)]
struct Suggestion {
    message: Message,
    /// `node: node.parent, innerNode: node`: the `!` around the node is replaced too.
    replaces_negation: bool,
    before: &'static str,
    after: &'static str,
}

const fn wrap(message: Message, before: &'static str, after: &'static str) -> Suggestion {
    Suggestion {
        message,
        replaces_negation: false,
        before,
        after,
    }
}

const fn wrap_in_place_of_negation(message: Message, before: &'static str, after: &'static str) -> Suggestion {
    Suggestion {
        message,
        replaces_negation: true,
        before,
        after,
    }
}

const CAST_BOOLEAN: Suggestion = wrap(CONDITION_FIX_CAST_BOOLEAN, "Boolean(", ")");
const CAST_BOOLEAN_NEGATED: Suggestion = wrap_in_place_of_negation(CONDITION_FIX_CAST_BOOLEAN, "!Boolean(", ")");
const COMPARE_NOT_NULLISH: Suggestion = wrap(CONDITION_FIX_COMPARE_NULLISH, "", " != null");
const COMPARE_NULLISH: Suggestion = wrap_in_place_of_negation(CONDITION_FIX_COMPARE_NULLISH, "", " == null");
const DEFAULT_FALSE: Suggestion = wrap(CONDITION_FIX_DEFAULT_FALSE, "", " ?? false");
const DEFAULT_ZERO: Suggestion = wrap(CONDITION_FIX_DEFAULT_ZERO, "", " ?? 0");
const DEFAULT_EMPTY_STRING: Suggestion = wrap(CONDITION_FIX_DEFAULT_EMPTY_STRING, "", " ?? \"\"");

const SUGGESTIONS_ANY: &[Suggestion] = &[CAST_BOOLEAN];
const SUGGESTIONS_NULLABLE_BOOLEAN: &[Suggestion] =
    &[DEFAULT_FALSE, wrap(CONDITION_FIX_COMPARE_TRUE, "", " === true")];
const SUGGESTIONS_NULLABLE_BOOLEAN_NEGATED: &[Suggestion] = &[
    DEFAULT_FALSE,
    wrap_in_place_of_negation(CONDITION_FIX_COMPARE_FALSE, "", " === false"),
];
const SUGGESTIONS_NULLABLE: &[Suggestion] = &[COMPARE_NOT_NULLISH];
const SUGGESTIONS_NULLABLE_NEGATED: &[Suggestion] = &[COMPARE_NULLISH];
const SUGGESTIONS_NULLABLE_NUMBER: &[Suggestion] = &[COMPARE_NOT_NULLISH, DEFAULT_ZERO, CAST_BOOLEAN];
const SUGGESTIONS_NULLABLE_NUMBER_NEGATED: &[Suggestion] = &[COMPARE_NULLISH, DEFAULT_ZERO, CAST_BOOLEAN_NEGATED];
const SUGGESTIONS_NULLABLE_STRING: &[Suggestion] = &[COMPARE_NOT_NULLISH, DEFAULT_EMPTY_STRING, CAST_BOOLEAN];
const SUGGESTIONS_NULLABLE_STRING_NEGATED: &[Suggestion] =
    &[COMPARE_NULLISH, DEFAULT_EMPTY_STRING, CAST_BOOLEAN_NEGATED];
const SUGGESTIONS_ARRAY_LENGTH: &[Suggestion] = &[wrap(CONDITION_FIX_COMPARE_ARRAY_LENGTH_NONZERO, "", " > 0")];
const SUGGESTIONS_ARRAY_LENGTH_NEGATED: &[Suggestion] =
    &[wrap_in_place_of_negation(CONDITION_FIX_COMPARE_ARRAY_LENGTH_ZERO, "", " === 0")];
const SUGGESTIONS_NUMBER: &[Suggestion] = &[
    wrap(CONDITION_FIX_COMPARE_ZERO, "", " !== 0"),
    wrap(CONDITION_FIX_COMPARE_NAN, "!Number.isNaN(", ")"),
    CAST_BOOLEAN,
];
const SUGGESTIONS_NUMBER_NEGATED: &[Suggestion] = &[
    wrap_in_place_of_negation(CONDITION_FIX_COMPARE_ZERO, "", " === 0"),
    wrap_in_place_of_negation(CONDITION_FIX_COMPARE_NAN, "Number.isNaN(", ")"),
    CAST_BOOLEAN_NEGATED,
];
const SUGGESTIONS_STRING: &[Suggestion] = &[
    wrap(CONDITION_FIX_COMPARE_STRING_LENGTH, "", ".length > 0"),
    wrap(CONDITION_FIX_COMPARE_EMPTY_STRING, "", " !== \"\""),
    CAST_BOOLEAN,
];
const SUGGESTIONS_STRING_NEGATED: &[Suggestion] = &[
    wrap_in_place_of_negation(CONDITION_FIX_COMPARE_STRING_LENGTH, "", ".length === 0"),
    wrap_in_place_of_negation(CONDITION_FIX_COMPARE_EMPTY_STRING, "", " === \"\""),
    CAST_BOOLEAN_NEGATED,
];

fn is_logical_negation_expression(node: Node) -> bool {
    matches!(node, Node::Expr(it) if matches!(it.kind(), ExprKind::Unary { op: UnOp::Not, .. }))
}

fn is_array_length_expression(node: Expr) -> bool {
    // All of an optional chain is a `ChainExpression`, not a `MemberExpression`.
    if node.is_chain_root() {
        return false;
    }
    match node.kind() {
        ExprKind::Dot { obj, name, .. } => {
            name.name().is("length")
                && is_type_array_type_or_union_of_array_types(get_constrained_type_at_location(obj))
        }
        _ => false,
    }
}

/// `type Foo = boolean & { __brand: 'Foo' }`
fn is_branded_boolean(ty: Type) -> bool {
    ty.is_intersection()
        && ty.types().iter().any(|it| it.has_flags(TypeFlags::BOOLEAN.union(TypeFlags::BOOLEAN_LITERAL)))
}

/// `&&` or `||`
fn is_logical_expression(node: Expr) -> bool {
    matches!(
        node.kind(),
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or,
            ..
        }
    )
}

/// Its type is `boolean`, `true` or `false`, whatever its operands are.
fn is_always_boolean(node: Expr) -> bool {
    match node.kind() {
        ExprKind::True | ExprKind::False => true,
        ExprKind::Unary { op, .. } => matches!(op, UnOp::Not | UnOp::Delete),
        ExprKind::Binary { op, .. } => matches!(
            op,
            BinOp::EqEq
                | BinOp::NotEq
                | BinOp::EqEqEq
                | BinOp::NotEqEq
                | BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
                | BinOp::In
                | BinOp::Instanceof
        ),
        _ => false,
    }
}

/// Whether what listens for the parent of the logical expression `node` traverses `node`. Upstream
/// finds it among its `traversedNodes` then, as a parent comes before its children.
fn is_traversed_from_parent(node: Expr) -> bool {
    match node.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Cond { test, .. } => test == node,
            ExprKind::Unary { op, .. } => op == UnOp::Not,
            ExprKind::Binary { op, .. } => matches!(op, BinOp::And | BinOp::Or),
            // Every argument that is a logical expression, asserted or not.
            ExprKind::Call(call) => call.callee() != node,
            _ => false,
        },
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => test == node,
            StmtKind::For { test, .. } => test == Some(node),
            _ => false,
        },
        _ => false,
    }
}

/// Checks the variants of a union for the types that matter.
fn inspect_variant_types(types: &mut dyn Iterator<Item = Type<'_>>) -> VariantTypes {
    let nullish = TypeFlags::NULL | TypeFlags::UNDEFINED | TypeFlags::VOID_LIKE;
    let number_like = TypeFlags::NUMBER_LIKE | TypeFlags::BIG_INT_LIKE;
    let any = TypeFlags::TYPE_PARAMETER | TypeFlags::ANY | TypeFlags::UNKNOWN;
    let not_an_object =
        nullish | TypeFlags::BOOLEAN_LIKE | TypeFlags::STRING_LIKE | number_like | any | TypeFlags::NEVER;

    let mut variant_types = 0;
    let (mut booleans, mut is_first_boolean_true) = (0, false);
    let (mut has_strings, mut has_numbers, mut has_objects) = (false, false, false);
    let (mut are_strings_truthy, mut are_numbers_truthy, mut has_branded_boolean) = (true, true, false);
    for ty in types {
        let flags = ty.flags();
        if flags.intersects(nullish) {
            variant_types |= NULLISH;
        }
        if flags.intersects(TypeFlags::BOOLEAN_LIKE) {
            if booleans == 0 {
                is_first_boolean_true = is_true_literal_type(ty);
            }
            booleans += 1;
        }
        if flags.intersects(TypeFlags::STRING_LIKE) {
            has_strings = true;
            are_strings_truthy = are_strings_truthy
                && flags.intersects(TypeFlags::STRING_LITERAL)
                && ty.string_value().is_some_and(|value| !value.is_empty());
        }
        if flags.intersects(number_like) {
            has_numbers = true;
            are_numbers_truthy = are_numbers_truthy
                && flags.intersects(TypeFlags::NUMBER_LITERAL)
                && ty.number_value().is_some_and(|value| value != 0.0);
        }
        if flags.intersects(TypeFlags::ENUM_LIKE) {
            variant_types |= ENUM;
        }
        if !flags.intersects(not_an_object) {
            has_objects = true;
            has_branded_boolean = has_branded_boolean || is_branded_boolean(ty);
        }
        if flags.intersects(any) {
            variant_types |= ANY;
        }
        if flags.intersects(TypeFlags::NEVER) {
            variant_types |= NEVER;
        }
    }
    // `true` or `false` is one type, `boolean` is both.
    match booleans {
        1 if is_first_boolean_true => variant_types |= TRUTHY_BOOLEAN,
        1 | 2 => variant_types |= BOOLEAN,
        _ => {}
    }
    if has_strings {
        variant_types |= if are_strings_truthy { TRUTHY_STRING } else { STRING };
    }
    if has_numbers {
        variant_types |= if are_numbers_truthy { TRUTHY_NUMBER } else { NUMBER };
    }
    if has_objects {
        variant_types |= if has_branded_boolean { BOOLEAN } else { OBJECT };
    }
    variant_types
}

fn get_suggestions_for_condition_error(node: Expr, condition_error: ConditionError) -> &'static [Suggestion] {
    let is_negated = is_logical_negation_expression(node.parent());
    match (condition_error, is_negated) {
        (ConditionError::Any, _) => SUGGESTIONS_ANY,
        (ConditionError::NullableBoolean, false) => SUGGESTIONS_NULLABLE_BOOLEAN,
        (ConditionError::NullableBoolean, true) => SUGGESTIONS_NULLABLE_BOOLEAN_NEGATED,
        (ConditionError::NullableEnum | ConditionError::NullableObject, false) => SUGGESTIONS_NULLABLE,
        (ConditionError::NullableEnum | ConditionError::NullableObject, true) => SUGGESTIONS_NULLABLE_NEGATED,
        (ConditionError::NullableNumber, false) => SUGGESTIONS_NULLABLE_NUMBER,
        (ConditionError::NullableNumber, true) => SUGGESTIONS_NULLABLE_NUMBER_NEGATED,
        (ConditionError::NullableString, false) => SUGGESTIONS_NULLABLE_STRING,
        (ConditionError::NullableString, true) => SUGGESTIONS_NULLABLE_STRING_NEGATED,
        (ConditionError::Number, false) if is_array_length_expression(node) => SUGGESTIONS_ARRAY_LENGTH,
        (ConditionError::Number, true) if is_array_length_expression(node) => SUGGESTIONS_ARRAY_LENGTH_NEGATED,
        (ConditionError::Number, false) => SUGGESTIONS_NUMBER,
        (ConditionError::Number, true) => SUGGESTIONS_NUMBER_NEGATED,
        (ConditionError::String, false) => SUGGESTIONS_STRING,
        (ConditionError::String, true) => SUGGESTIONS_STRING_NEGATED,
        (ConditionError::Object | ConditionError::Nullish | ConditionError::Other, _) => &[],
    }
}

/// Adds `getSuggestionsForConditionError(node, conditionError)` to `report`.
fn suggest_for_condition_error<'a>(
    mut report: Report<'a>,
    node: Expr<'a>,
    condition_error: ConditionError,
) -> Report<'a> {
    for &suggestion in get_suggestions_for_condition_error(node, condition_error) {
        report = report.suggest(suggestion.message, |fixer| {
            let inner_node = [node];
            let (node, inner_nodes): (Expr, &[Expr]) = match node.parent() {
                Node::Expr(negation) if suggestion.replaces_negation => (negation, &inner_node[..]),
                _ => (node, &inner_node[..0]),
            };
            get_wrapping_fixer(
                fixer,
                WrappingFixerParams {
                    node,
                    inner_nodes,
                    wrap: |code: &[&[u8]]| [suggestion.before.as_bytes(), code[0], suggestion.after.as_bytes()].concat(),
                },
            )
        });
    }
    report
}

/// The fix of `explicitBooleanReturnType`.
fn add_boolean_return_type<'a>(fixer: Fixer<'a>, predicate_node: Expr<'a>, function: Func<'a>) -> Option<Vec<Fix>> {
    let is_closing_parenthesis = |token: &Token| token.value() == b")";
    let closing_parenthesis = match function.params_with_this().last() {
        Some(only) if function.is_arrow() && is_parenless_arrow_function(function) => {
            let only = estree_span(Node::Param(only));
            return Some(vec![fixer.insert_before(only, "("), fixer.insert_after(only, "): boolean")]);
        }
        Some(last) => fixer.file().tokens_after(estree_span(Node::Param(last))).find(is_closing_parenthesis),
        None => fixer.file().tokens_in(predicate_node).find(is_closing_parenthesis),
    };
    Some(vec![fixer.insert_after(closing_parenthesis?, ": boolean")])
}

impl StrictBooleanExpressions {
    fn determine_report_type(&self, types: VariantTypes) -> Option<ConditionError> {
        let is = |wanted_types: VariantTypes| types == wanted_types;
        let unless = |is_allowed: bool, error: ConditionError| (!is_allowed).then_some(error);

        // `boolean` and `never` are always okay.
        if is(BOOLEAN) || is(TRUTHY_BOOLEAN) || is(NEVER) {
            return None;
        }
        // The condition is always false.
        if is(NULLISH) {
            return Some(ConditionError::Nullish);
        }
        // Known edge case: `true` and nullish values are always valid boolean expressions.
        if is(NULLISH | TRUTHY_BOOLEAN) {
            return None;
        }
        if is(NULLISH | BOOLEAN) {
            return unless(self.allow_nullable_boolean, ConditionError::NullableBoolean);
        }
        // Known edge case: truthy primitives and nullish values are always valid boolean expressions.
        if (self.allow_number && is(NULLISH | TRUTHY_NUMBER)) || (self.allow_string && is(NULLISH | TRUTHY_STRING)) {
            return None;
        }
        if is(STRING) || is(TRUTHY_STRING) {
            return unless(self.allow_string, ConditionError::String);
        }
        if is(NULLISH | STRING) {
            return unless(self.allow_nullable_string, ConditionError::NullableString);
        }
        if is(NUMBER) || is(TRUTHY_NUMBER) {
            return unless(self.allow_number, ConditionError::Number);
        }
        if is(NULLISH | NUMBER) {
            return unless(self.allow_nullable_number, ConditionError::NullableNumber);
        }
        if is(OBJECT) {
            return Some(ConditionError::Object);
        }
        if is(NULLISH | OBJECT) {
            return unless(self.allow_nullable_object, ConditionError::NullableObject);
        }
        if is(NULLISH | NUMBER | ENUM)
            || is(NULLISH | STRING | ENUM)
            || is(NULLISH | TRUTHY_NUMBER | ENUM)
            || is(NULLISH | TRUTHY_STRING | ENUM)
            // mixed enums
            || is(NULLISH | TRUTHY_NUMBER | TRUTHY_STRING | ENUM)
            || is(NULLISH | TRUTHY_NUMBER | STRING | ENUM)
            || is(NULLISH | TRUTHY_STRING | NUMBER | ENUM)
            || is(NULLISH | NUMBER | STRING | ENUM)
        {
            return unless(self.allow_nullable_enum, ConditionError::NullableEnum);
        }
        if is(ANY) {
            return unless(self.allow_any, ConditionError::Any);
        }
        Some(ConditionError::Other)
    }

    /// Checks whether the type of a node is allowed in a boolean context.
    fn check_node<'a>(&self, node: Expr<'a>, cx: &Cx<'a, Self>) {
        if is_always_boolean(node) {
            return;
        }
        let ty = get_constrained_type_at_location(node);
        if ty.is_unresolved() {
            return;
        }
        let types = inspect_variant_types(&mut union_constituents(ty).iter());
        if let Some(report_type) = self.determine_report_type(types) {
            let report = cx.report(node, report_type.message()).data("context", "conditional");
            suggest_for_condition_error(report, node, report_type);
        }
    }

    /// The operands of a logical expression are traversed in turn. Anything else is checked, unless
    /// it is not a condition: then it is there for its side effects only.
    fn traverse_node<'a>(&self, node: Expr<'a>, is_condition: bool, cx: &Cx<'a, Self>) {
        let mut pending: SmallVec<[(Expr<'a>, bool); 8]> = SmallVec::new();
        pending.push((node, is_condition));
        while let Some((node, is_condition)) = pending.pop() {
            match node.kind() {
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or,
                    left,
                    right,
                } => {
                    // The left operand is always a condition.
                    pending.push((left, true));
                    pending.push((right, is_condition));
                }
                _ if is_condition => self.check_node(node, cx),
                _ => {}
            }
        }
    }

    /// Reports a predicate of an array method that does not return a boolean value.
    fn check_array_method_call_predicate<'a>(&self, predicate_node: Expr<'a>, cx: &Cx<'a, Self>) {
        let function = predicate_node.as_fn();
        if function.is_some_and(Func::is_async) {
            cx.report(predicate_node, PREDICATE_CANNOT_BE_ASYNC);
            return;
        }

        let predicate_type = predicate_node.ty();
        if predicate_type.is_unresolved() {
            return;
        }
        let mut flatten_types: SmallVec<[Type<'a>; 8]> = SmallVec::new();
        // All of them, once they are many.
        let mut many_flatten_types: FxHashSet<Type<'a>> = FxHashSet::default();
        for signature in predicate_type.get_call_signatures() {
            let ty = signature.get_return_type();
            let ty = match is_type_parameter(ty) {
                true => ty.get_base_constraint_of_type().unwrap_or(ty),
                false => ty,
            };
            if ty.is_unresolved() {
                return;
            }
            for constituent in union_constituents(ty) {
                let is_new = match flatten_types.spilled() {
                    true => many_flatten_types.insert(constituent),
                    false => !flatten_types.contains(&constituent),
                };
                if !is_new {
                    continue;
                }
                flatten_types.push(constituent);
                if flatten_types.spilled() && many_flatten_types.is_empty() {
                    many_flatten_types.extend(flatten_types.iter().copied());
                }
            }
        }
        let types = inspect_variant_types(&mut flatten_types.iter().copied());
        let Some(report_type) = self.determine_report_type(types) else {
            return;
        };

        // oxlint points at the call.
        let place = match predicate_node.parent() {
            Node::Expr(call) if cx.language().is_oxlint => call.span(),
            _ => predicate_node.span(),
        };
        let mut report = cx.report(place, report_type.message()).data("context", "array predicate return type");
        if let Some(function) = function {
            if let FnBody::Expr(body) = function.body() {
                report = suggest_for_condition_error(report, body, report_type);
            }
            if function.return_type().is_none() {
                report.suggest(EXPLICIT_BOOLEAN_RETURN_TYPE, |fixer| {
                    add_boolean_return_type(fixer, predicate_node, function)
                });
            }
        }
    }

    fn traverse_call_expression<'a>(&self, node: Expr<'a>, cx: &Cx<'a, Self>) {
        let Some(call) = node.as_call() else {
            return;
        };
        let Some(first_argument) = call.args().first() else {
            return;
        };
        let asserted_argument = find_truthiness_asserted_argument(node);
        for argument in call.args() {
            if Some(argument) == asserted_argument {
                self.traverse_node(argument, true, cx);
            } else if is_logical_expression(argument) {
                self.traverse_node(argument, false, cx);
            }
        }
        if is_array_method_call_with_predicate(node) {
            self.check_array_method_call_predicate(first_argument, cx);
        }
    }
}

impl Rule for StrictBooleanExpressions {
    const META: Meta = Meta::typescript("strict-boolean-expressions", Kind::Suggestion)
        .has_suggestions()
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        StrictBooleanExpressions {
            allow_any: options.bool_or("allowAny", false),
            allow_nullable_boolean: options.bool_or("allowNullableBoolean", false),
            allow_nullable_enum: options.bool_or("allowNullableEnum", false),
            allow_nullable_number: options.bool_or("allowNullableNumber", false),
            allow_nullable_object: options.bool_or("allowNullableObject", true),
            allow_nullable_string: options.bool_or("allowNullableString", false),
            allow_number: options.bool_or("allowNumber", true),
            allow_rule_to_run_without_strict_null_checks: options
                .bool_or("allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing", false),
            allow_string: options.bool_or("allowString", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let compiler_options = file.type_checker().compiler_options();
        if !is_strict_compiler_option_enabled(compiler_options, CompilerOption::StrictNullChecks)
            && !self.allow_rule_to_run_without_strict_null_checks
        {
            on.finish(|_, cx| {
                // tsgolint points at the start of the file.
                if cx.language().is_oxlint {
                    cx.report(Span::empty(0), NO_STRICT_NULL_CHECK);
                    return;
                }
                let nowhere = Position { line: 0, column: 0 };
                cx.report(Span::empty(0), NO_STRICT_NULL_CHECK).start_at(nowhere).end_at(nowhere);
            });
        }

        on.stmts(
            [StmtTag::If, StmtTag::While, StmtTag::DoWhile, StmtTag::For],
            |rule, node, cx| match node.kind() {
                StmtKind::If { test, .. }
                | StmtKind::While { test, .. }
                | StmtKind::DoWhile { test, .. }
                | StmtKind::For { test: Some(test), .. } => rule.traverse_node(test, true, cx),
                _ => {}
            },
        );
        on.exprs([ExprTag::Cond], |rule, node, cx| {
            if let ExprKind::Cond { test, .. } = node.kind() {
                rule.traverse_node(test, true, cx);
            }
        });
        on.exprs([ExprTag::Unary], |rule, node, cx| {
            if let ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } = node.kind()
            {
                rule.traverse_node(operand, true, cx);
            }
        });
        // On its own a logical expression is control flow, and no condition itself.
        on.exprs([ExprTag::Binary], |rule, node, cx| {
            if is_logical_expression(node) && !is_traversed_from_parent(node) {
                rule.traverse_node(node, false, cx);
            }
        });
        on.exprs([ExprTag::Call], |rule, node, cx| rule.traverse_call_expression(node, cx));
    }
}
