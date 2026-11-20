use crate::rules::no_unsafe_assignment::TYPE_THIS;
use bun_lint::prelude::*;
use bun_lint::types::{Signature, Type, TypeFlags};
use bun_lint::types::tsutils::{
    CompilerOption, get_call_signatures_of_type, is_intrinsic_error_type,
    is_strict_compiler_option_enabled,
};
use bun_lint::types::utils::{
    AnyType, discriminate_any_type, get_constrained_type_at_location, get_contextual_type,
    is_type_any_type, is_type_flag_set, is_type_unknown_array_type, is_type_unknown_type,
    is_unsafe_assignment,
};
use bun_lint::utils::ts_utils::{get_parent_function_node, get_this_expression};

/// Disallow returning a value with type `any` from a function.
pub struct NoUnsafeReturn;

const UNSAFE_RETURN: &Message =
    &Message::new("unsafeReturn", "Unsafe return of a value of type {{type}}.");
const UNSAFE_RETURN_ASSIGNMENT: &Message = &Message::new(
    "unsafeReturnAssignment",
    "Unsafe return of type `{{sender}}` from function with return type `{{receiver}}`.",
);
const UNSAFE_RETURN_THIS: &Message = &Message::new(
    "unsafeReturnThis",
    "Unsafe return of a value of type `{{type}}`. `this` is typed as `any`.\nYou can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.",
);

/// tsgolint's help: the returned type, the function's return type if it has one to compare with, then what to do.
#[cold]
fn help(return_node: Expr, expected: Option<Signature>, advice: &str) -> String {
    let render = |ty: Type| if is_intrinsic_error_type(ty) { b"error".to_vec() } else { ty.to_text() };
    let returned = render(get_constrained_type_at_location(return_node));
    let returned = bstr::BStr::new(&returned);
    match expected {
        Some(signature) => {
            let expected = render(signature.get_return_type());
            let expected = bstr::BStr::new(&expected);
            format!("Returned expression has type `{returned}`; the function return type is `{expected}`. {advice}")
        }
        None => format!("Returned expression has type `{returned}`. {advice}"),
    }
}

const RETURN_A_SAFE_VALUE: &str = "Return a safely typed value or narrow the value before returning it.";

fn check_return<'a>(return_node: Expr<'a>, reporting_node: Span, cx: &Cx<'a, NoUnsafeReturn>) {
    let Some(function_node) = get_parent_function_node(return_node) else {
        return;
    };
    let return_node_type = return_node.ty();
    let any_type = discriminate_any_type(return_node_type, return_node);

    // A function expression's return type doesn't depend on what receives it, so use the contextual type. In
    // `const foo: () => Set<string> = () => new Set<any>()` the arrow function returns a `Set<any>`.
    let function_type = match function_node.kind() {
        FnKind::Expr | FnKind::Arrow => get_contextual_type(function_node),
        _ => None,
    };
    let uses_contextual_type = function_type.is_some();
    let function_type = function_type.unwrap_or_else(|| function_node.type_at_location());
    let is_oxlint = cx.language().is_oxlint;
    let has_return_type = function_node.return_type().is_some();
    let call_signatures = match has_return_type || any_type != AnyType::Safe || is_oxlint {
        true => get_call_signatures_of_type(function_type),
        false => Vec::new(),
    };
    let any_or_unknown = TypeFlags::ANY | TypeFlags::UNKNOWN;
    let report = |message: &'static Message, advice: &'static str| {
        cx.report(reporting_node, message).oxlint_help_with(|| {
            let expected = (has_return_type || uses_contextual_type).then(|| call_signatures.first().copied());
            help(return_node, expected.flatten(), advice)
        })
    };

    // An explicit annotation is intentional, even if it's unsafe.
    if has_return_type {
        for signature in &call_signatures {
            let signature_return_type = signature.get_return_type();
            if return_node_type == signature_return_type
                || is_type_flag_set(signature_return_type, any_or_unknown)
            {
                return;
            }
            if function_node.is_async() {
                let awaited_signature_return_type = signature_return_type.get_awaited_type();
                if return_node_type.get_awaited_type() == awaited_signature_return_type
                    || awaited_signature_return_type.is_some_and(|it| is_type_flag_set(it, any_or_unknown))
                {
                    return;
                }
            }
        }
    }

    if any_type != AnyType::Safe {
        // `any` may be returned as `unknown`, `any[]` as `unknown[]`.
        for signature in &call_signatures {
            let function_return_type = signature.get_return_type();
            let is_allowed = match any_type {
                AnyType::Any => is_type_unknown_type(function_return_type),
                AnyType::AnyArray => is_type_unknown_array_type(function_return_type),
                AnyType::PromiseAny => {
                    function_return_type.get_awaited_type().is_some_and(is_type_unknown_type)
                }
                AnyType::Safe => false,
            };
            if is_allowed {
                return;
            }
        }
        if any_type == AnyType::PromiseAny && !function_node.is_async() {
            return;
        }

        let options = cx.file().type_checker().compiler_options();
        let is_this_any = !is_strict_compiler_option_enabled(options, CompilerOption::NoImplicitThis)
            && get_this_expression(return_node)
                .is_some_and(|this| is_type_any_type(get_constrained_type_at_location(this)));
        let (message, advice) = match is_this_any {
            true => (UNSAFE_RETURN_THIS, TYPE_THIS),
            false => (UNSAFE_RETURN, RETURN_A_SAFE_VALUE),
        };
        let ty = match any_type {
            _ if is_intrinsic_error_type(get_constrained_type_at_location(return_node)) => "error",
            AnyType::Any => "`any`",
            AnyType::PromiseAny => "`Promise<any>`",
            _ => "`any[]`",
        };
        report(message, advice).data("type", ty);
        return;
    }

    // tsgolint uses the first of the signatures collected from the constituents.
    let (signature, sender_node) = match is_oxlint {
        true => (call_signatures.first().copied(), Some(return_node)),
        false => (function_type.get_call_signatures().first(), Some(return_node)),
    };
    let Some(signature) = signature else {
        return;
    };
    let Some(result) = is_unsafe_assignment(return_node_type, signature.get_return_type(), sender_node)
    else {
        return;
    };
    report(UNSAFE_RETURN_ASSIGNMENT, RETURN_A_SAFE_VALUE)
        .data("receiver", result.receiver.to_text())
        .data("sender", result.sender.to_text());
}

impl Rule for NoUnsafeReturn {
    const META: Meta = Meta::typescript("no-unsafe-return", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().funcs().stmts(&[StmtTag::Return]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnsafeReturn
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if let FnBody::Expr(body) = func.body() {
            // For tsgolint the parentheses around the body are a node.
            let reporting_node = if cx.language().is_oxlint { body.outer_span() } else { body.span() };
            check_return(body, reporting_node, cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Return(Some(argument)) = statement.kind() {
            check_return(argument, statement.span(), cx);
        }
    }
}
