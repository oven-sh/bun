use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::types::tsutils::{
    get_call_signatures_of_type, is_intrinsic_unknown_type, is_thenable_type, union_constituents,
};
use bun_lint::types::utils::{get_static_member_access_value, is_rest_parameter_declaration};
use bun_lint::utils::ts_utils::is_parenless_arrow_function;
use smallvec::SmallVec;

/// Enforce typing arguments in Promise rejection callbacks as `unknown`.
pub struct UseUnknownInCatchCallbackVariable;

const ADD_UNKNOWN_REST_TYPE_ANNOTATION_SUGGESTION: Message = Message::new(
    "addUnknownRestTypeAnnotationSuggestion",
    "Add an explicit `: [unknown]` type annotation to the rejection callback rest variable.",
);
const ADD_UNKNOWN_TYPE_ANNOTATION_SUGGESTION: Message = Message::new(
    "addUnknownTypeAnnotationSuggestion",
    "Add an explicit `: unknown` type annotation to the rejection callback variable.",
);
const USE_UNKNOWN: Message = Message::new(
    "useUnknown",
    "Prefer the safe `: unknown` for a `{{method}}`{{append}} callback variable.",
);
const USE_UNKNOWN_ARRAY_DESTRUCTURING_PATTERN: Message = Message::new(
    "useUnknownArrayDestructuringPattern",
    "Prefer the safe `: unknown` for a `{{method}}`{{append}} callback variable. The thrown error may not be iterable.",
);
const USE_UNKNOWN_OBJECT_DESTRUCTURING_PATTERN: Message = Message::new(
    "useUnknownObjectDestructuringPattern",
    "Prefer the safe `: unknown` for a `{{method}}`{{append}} callback variable. The thrown error may be nullable, or may not have the expected shape.",
);
const WRONG_REST_TYPE_ANNOTATION_SUGGESTION: Message =
    Message::new("wrongRestTypeAnnotationSuggestion", "Change existing type annotation to `: [unknown]`.");
const WRONG_TYPE_ANNOTATION_SUGGESTION: Message =
    Message::new("wrongTypeAnnotationSuggestion", "Change existing type annotation to `: unknown`.");

#[derive(Copy, Clone)]
struct PromiseMethod {
    append: &'static str,
    arg_index_to_check: usize,
    method: &'static str,
}

const CATCH: PromiseMethod = PromiseMethod {
    append: "",
    arg_index_to_check: 0,
    method: "catch",
};
const THEN: PromiseMethod = PromiseMethod {
    append: " rejection",
    arg_index_to_check: 1,
    method: "then",
};

fn is_flaggable_handler_type(ty: Type) -> bool {
    for union_part in union_constituents(ty) {
        // What is not a function is not the problem of this rule.
        for call_signature in get_call_signatures_of_type(union_part) {
            let Some(first_param) = call_signature.parameters().first() else {
                continue;
            };
            let mut first_param_type = first_param.get_type();
            if first_param.value_declaration().is_some_and(is_rest_parameter_declaration) {
                if !first_param_type.is_array_type() && !first_param_type.is_tuple_type() {
                    return !first_param_type.is_unresolved();
                }
                match first_param_type.get_type_arguments().first() {
                    Some(element_type) => first_param_type = element_type,
                    None => continue,
                }
            }
            if !is_intrinsic_unknown_type(first_param_type) && !first_param_type.is_unresolved() {
                return true;
            }
        }
    }
    false
}

/// Reports `argument`, a function whose first parameter is known not to be `unknown`, at that
/// parameter.
fn report<'a>(argument: Func<'a>, info: PromiseMethod, cx: &Cx<'a, UseUnknownInCatchCallbackVariable>) {
    let Some(catch_variable) = argument.params_with_this().next() else {
        return;
    };
    let outer = utils::estree_span(Node::Param(catch_variable));
    let at_variable = |message: Message| cx.report(outer, message).data("method", info.method).data("append", info.append);
    let type_annotation = catch_variable.ty().map(TypeNode::annotation_span);

    if catch_variable.is_rest() {
        match type_annotation {
            None => at_variable(USE_UNKNOWN).suggest(ADD_UNKNOWN_REST_TYPE_ANNOTATION_SUGGESTION, |fixer| {
                fixer.insert_after(outer, ": [unknown]")
            }),
            Some(annotation) => at_variable(USE_UNKNOWN)
                .suggest(WRONG_REST_TYPE_ANNOTATION_SUGGESTION, |fixer| fixer.replace(annotation, ": [unknown]")),
        };
        return;
    }
    match (catch_variable.pat().tag(), type_annotation) {
        (PatTag::Ident, None) => at_variable(USE_UNKNOWN).suggest(ADD_UNKNOWN_TYPE_ANNOTATION_SUGGESTION, |fixer| {
            let inner = catch_variable.binding_span();
            if argument.is_arrow() && is_parenless_arrow_function(argument) {
                return vec![fixer.insert_before(inner, "("), fixer.insert_after(inner, ": unknown)")];
            }
            vec![fixer.insert_after(inner, ": unknown")]
        }),
        (PatTag::Ident, Some(annotation)) => {
            at_variable(USE_UNKNOWN).suggest(WRONG_TYPE_ANNOTATION_SUGGESTION, |fixer| fixer.replace(annotation, ": unknown"))
        }
        (PatTag::Array, _) => at_variable(USE_UNKNOWN_ARRAY_DESTRUCTURING_PATTERN),
        (PatTag::Object, _) => at_variable(USE_UNKNOWN_OBJECT_DESTRUCTURING_PATTERN),
        (PatTag::Missing, _) => return,
    };
}

fn check_call<'a>(node: Expr<'a>, cx: &Cx<'a, UseUnknownInCatchCallbackVariable>) {
    let Some(call) = node.as_call() else {
        return;
    };
    let callee = call.callee();
    let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
        return;
    };
    // `(a?.catch)(..)` calls a `ChainExpression`.
    if callee.is_chain_root() {
        return;
    }
    let value = get_static_member_access_value(callee);
    let method = match callee.kind() {
        // tsgolint goes by the type of a name in the brackets, not by what it is initialized with.
        ExprKind::Index { index, .. } if index.tag() == ExprTag::Ident && callee.file().language().is_oxlint => {
            index.ty().string_value()
        }
        _ => value.as_ref().and_then(|it| it.as_string()),
    };
    let info = match method {
        Some(b"catch") => CATCH,
        Some(b"then") => THEN,
        _ => return,
    };

    // The argument to check and all before it have to be ordinary arguments, not spread ones.
    let Some(arg_to_check) = call.args().get(info.arg_index_to_check) else {
        return;
    };
    if call.args().iter().take(info.arg_index_to_check + 1).any(|it| it.tag() == ExprTag::Spread) {
        return;
    }
    if !is_thenable_type(callee, obj.ty()) {
        return;
    }

    let mut pending: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
    pending.push(arg_to_check);
    while let Some(candidate) = pending.pop() {
        match candidate.kind() {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => pending.extend([left, right]),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => pending.push(right),
            ExprKind::Cond { yes, no, .. } => pending.extend([yes, no]),
            ExprKind::Fn(func) if is_flaggable_handler_type(candidate.ty()) => report(func, info, cx),
            _ => {}
        }
    }
}

impl Rule for UseUnknownInCatchCallbackVariable {
    const META: Meta = Meta::typescript("use-unknown-in-catch-callback-variable", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        UseUnknownInCatchCallbackVariable
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], |_, node, cx| check_call(node, cx));
    }
}
