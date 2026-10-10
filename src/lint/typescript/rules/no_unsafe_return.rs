use bun_lint::prelude::*;
use bun_lint::types::TypeFlags;
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

const UNSAFE_RETURN: Message =
    Message::new("unsafeReturn", "Unsafe return of a value of type {{type}}.");
const UNSAFE_RETURN_ASSIGNMENT: Message = Message::new(
    "unsafeReturnAssignment",
    "Unsafe return of type `{{sender}}` from function with return type `{{receiver}}`.",
);
const UNSAFE_RETURN_THIS: Message = Message::new(
    "unsafeReturnThis",
    "Unsafe return of a value of type `{{type}}`. `this` is typed as `any`.\nYou can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.",
);

fn check_return<'a>(return_node: Expr<'a>, reporting_node: Span, cx: &Cx<'a, NoUnsafeReturn>) {
    let Some(function_node) = get_parent_function_node(return_node) else {
        return;
    };
    let keyword = match function_node.arrow_span() {
        Some(arrow) if matches!(function_node.body(), FnBody::Expr(body) if body == return_node) => arrow,
        _ => Span::new(reporting_node.start, reporting_node.start + "return".len() as u32),
    };
    // oxlint points at what is returned.
    let reporting_node = if cx.language().is_oxlint { return_node.outer_span() } else { reporting_node };
    let return_node_type = return_node.ty();
    let any_type = discriminate_any_type(return_node_type, return_node);

    // The return type of a function expression does not depend on what receives it, so the
    // contextual type is asked: in `const foo: () => Set<string> = () => new Set<any>()` the
    // arrow function returns a `Set<any>`.
    let function_type = match function_node.kind() {
        FnKind::Expr | FnKind::Arrow => get_contextual_type(function_node),
        _ => None,
    };
    let function_type = function_type.unwrap_or_else(|| function_node.type_at_location());
    let has_return_type = function_node.return_type().is_some();
    let call_signatures = match has_return_type || any_type != AnyType::Safe {
        true => get_call_signatures_of_type(function_type),
        false => Vec::new(),
    };
    let any_or_unknown = TypeFlags::ANY | TypeFlags::UNKNOWN;

    // What an explicit annotation says is intentional, even if it is unsafe.
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
        let message = if is_this_any { UNSAFE_RETURN_THIS } else { UNSAFE_RETURN };
        let ty = match any_type {
            _ if is_intrinsic_error_type(get_constrained_type_at_location(return_node)) => "error",
            AnyType::Any => "`any`",
            AnyType::PromiseAny => "`Promise<any>`",
            _ => "`any[]`",
        };
        cx.report(reporting_node, message).comments_apply_at(keyword).data("type", ty);
        return;
    }

    let Some(signature) = function_type.get_call_signatures().first() else {
        return;
    };
    let Some(result) = is_unsafe_assignment(return_node_type, signature.get_return_type(), return_node)
    else {
        return;
    };
    cx.report(reporting_node, UNSAFE_RETURN_ASSIGNMENT)
        .comments_apply_at(keyword)
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
            check_return(body, body.span(), cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Return(Some(argument)) = statement.kind() {
            check_return(argument, statement.span(), cx);
        }
    }
}
