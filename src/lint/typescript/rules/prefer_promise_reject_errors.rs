use bun_lint::prelude::*;
use bun_lint::types::utils::{
    TypeOrValueSpecifier, is_error_like, is_promise_constructor_like, is_promise_like,
    is_readonly_error_like, is_static_member_access_of_value, is_type_any_type,
    is_type_unknown_type, parse_type_or_value_specifiers, type_matches_some_specifier,
};

/// Require using Error objects as Promise rejection reasons.
pub struct PreferPromiseRejectErrors {
    allow: Vec<TypeOrValueSpecifier>,
    allow_empty_reject: bool,
    allow_throwing_any: bool,
    allow_throwing_unknown: bool,
}

const REJECT_AN_ERROR: Message =
    Message::new("rejectAnError", "Expected the Promise rejection reason to be an Error.");

impl PreferPromiseRejectErrors {
    fn check_reject_call<'a>(&self, call_expression: Expr<'a>, call: Call<'a>, cx: &Cx<'a, Self>) {
        match call.args().first() {
            Some(argument) => {
                let ty = argument.ty();
                if ty.is_unresolved()
                    || type_matches_some_specifier(ty, &self.allow)
                    || self.allow_throwing_any && is_type_any_type(ty)
                    || self.allow_throwing_unknown && is_type_unknown_type(ty)
                    || is_error_like(ty)
                    || is_readonly_error_like(ty)
                {
                    return;
                }
            }
            None if self.allow_empty_reject => return,
            None => {}
        }
        cx.report(call_expression, REJECT_AN_ERROR);
    }

    /// `Promise.reject(..)`
    fn check_call<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = node.as_call() else {
            return;
        };
        let callee = call.callee();
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
            return;
        };
        if !is_static_member_access_of_value(callee, &["reject"]) {
            return;
        }
        let object_type = obj.ty();
        if is_promise_constructor_like(object_type) || is_promise_like(object_type) {
            self.check_reject_call(node, call, cx);
        }
    }

    /// `new Promise((resolve, reject) => reject(..))`
    fn check_new<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(new) = node.kind() else {
            return;
        };
        let Some(executor) = new.args().first().and_then(Expr::as_fn) else {
            return;
        };
        let Some(reject_param) = executor.params_with_this().nth(1) else {
            return;
        };
        if reject_param.pat().tag() != PatTag::Ident || reject_param.default().is_some() || reject_param.is_rest() {
            return;
        }
        if !is_promise_constructor_like(new.callee().ty()) {
            return;
        }
        let Some(reject_variable) = reject_param.pat().symbol() else {
            return;
        };
        for reference in reject_variable.references() {
            if let Some(identifier) = reference.expr()
                && let Node::Expr(parent) = identifier.parent()
                && let Some(call) = parent.as_call()
                && call.callee() == identifier
            {
                self.check_reject_call(parent, call, cx);
            }
        }
    }
}

impl Rule for PreferPromiseRejectErrors {
    const META: Meta = Meta::typescript("prefer-promise-reject-errors", Kind::Suggestion)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types()
        .extends_base_rule("prefer-promise-reject-errors");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        PreferPromiseRejectErrors {
            allow: parse_type_or_value_specifiers(options.array("allow")),
            allow_empty_reject: options.bool_or("allowEmptyReject", false),
            allow_throwing_any: options.bool_or("allowThrowingAny", false),
            allow_throwing_unknown: options.bool_or("allowThrowingUnknown", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check_call);
        on.exprs([ExprTag::New], Self::check_new);
    }
}
