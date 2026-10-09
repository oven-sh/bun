use bun_lint::prelude::*;
use bun_lint::types::utils::is_type_flag_set;
use bun_lint::types::{TsNode, Type, TypeFlags, tsutils};
use bun_lint_eslint::rules::consistent_return::{
    MISSING_RETURN, MISSING_RETURN_VALUE, UNEXPECTED_RETURN_VALUE, check, has_return_value, is_relevant,
};
use std::cell::OnceCell;

/// Require `return` statements to either always or never specify values.
pub struct ConsistentReturn {
    treat_undefined_as_unspecified: bool,
}

fn is_promise_void<'a>(node: TsNode<'a>, mut ty: Type<'a>) -> bool {
    for _ in 0..100 {
        if !tsutils::is_thenable_type(node, ty) || !tsutils::is_type_reference(ty) {
            return false;
        }
        let Some(awaited_type) = ty.get_type_arguments().first() else {
            return false;
        };
        if is_type_flag_set(awaited_type, TypeFlags::VOID) {
            return true;
        }
        ty = awaited_type;
    }
    false
}

fn is_return_void_or_thenable_void(func: Func<'_>) -> bool {
    let ts_node = func.ts_node();
    func.type_at_location().get_call_signatures().iter().any(|signature| {
        let return_type = signature.get_return_type();
        match func.is_async() {
            true => is_promise_void(ts_node, return_type),
            false => is_type_flag_set(return_type, TypeFlags::VOID),
        }
    })
}

impl ConsistentReturn {
    fn check<'a>(&self, node: Node<'a>, cx: &Cx<'a, Self>) {
        let returns_void = OnceCell::new();
        check(node, cx, |statement| {
            let StmtKind::Return(argument) = statement.kind() else {
                return None;
            };
            let Some(value) = argument else {
                let is_ignored = *returns_void
                    .get_or_init(|| node.as_func().is_some_and(is_return_void_or_thenable_void));
                return (!is_ignored).then_some(false);
            };
            if self.treat_undefined_as_unspecified && value.ty().flags() == TypeFlags::UNDEFINED {
                return Some(false);
            }
            Some(has_return_value(argument, self.treat_undefined_as_unspecified))
        });
    }

    /// The rule of tsgolint 7.0. A function that can return `void` may end without a `return`, as may one in which a
    /// `return` has been reported. It makes no exception for constructors, and points at the whole function.
    fn check_as_tsgolint<'a>(&self, func: Func<'a>, cx: &Cx<'a, Self>) {
        let returns_void = OnceCell::new();
        let allows_void = || *returns_void.get_or_init(|| is_return_void_or_thenable_void(func));
        let (mut expected, mut has_mismatch) = (None, false);
        for statement in func.returns() {
            let StmtKind::Return(argument) = statement.kind() else {
                continue;
            };
            if argument.is_none() && allows_void() {
                continue;
            }
            let has_value = argument.is_some_and(|value| {
                !self.treat_undefined_as_unspecified
                    || value.ty().flags() != TypeFlags::UNDEFINED && !ast_utils::is_specific_id(value, "undefined")
            });
            if *expected.get_or_insert(has_value) != has_value {
                has_mismatch = true;
                let message = if has_value { UNEXPECTED_RETURN_VALUE } else { MISSING_RETURN_VALUE };
                let name = ast_utils::get_function_name_with_kind(func);
                cx.report(statement, message).data("name", text::upper_case_first(&name).into_owned());
            }
        }
        if expected == Some(true) && !has_mismatch && func.is_end_reachable() && !allows_void() {
            cx.report(func.span(), MISSING_RETURN).data("name", ast_utils::get_function_name_with_kind(func));
        }
    }
}

impl Rule for ConsistentReturn {
    const META: Meta = Meta::typescript("consistent-return", Kind::Suggestion)
        .requires_types()
        .extends_base_rule("consistent-return");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentReturn {
            treat_undefined_as_unspecified: options.object(0).bool_or("treatUndefinedAsUnspecified", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_relevant(file) {
            return;
        }
        if file.language().is_oxlint {
            on.funcs(|rule, func, cx| rule.check_as_tsgolint(func, cx));
            return;
        }
        on.funcs(|rule, func, cx| rule.check(func.into(), cx));
        on.finish(|rule, cx| rule.check(cx.file().into(), cx));
    }
}
