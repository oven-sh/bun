use bun_lint::prelude::*;

/// Require using Error objects as Promise rejection reasons.
pub struct PreferPromiseRejectErrors {
    allow_empty_reject: bool,
}

const REJECT_AN_ERROR: Message = Message::new(
    "rejectAnError",
    "Expected the Promise rejection reason to be an Error.",
);

impl PreferPromiseRejectErrors {
    /// Reports the call `e` of `reject` or of `Promise.reject` if its argument cannot be an `Error`.
    fn check_reject_call<'a>(&self, e: Expr<'a>, call: Call<'a>, cx: &Cx<'a, Self>) {
        let is_rejected_with_error = match call.args().first() {
            None => self.allow_empty_reject,
            Some(reason) => {
                ast_utils::could_be_error(reason)
                    && !(reason.is_ident("undefined") && ast_utils::is_global_reference(reason))
            }
        };
        if !is_rejected_with_error {
            cx.report(e, REJECT_AN_ERROR);
        }
    }

    /// `Promise.reject(..)`
    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        if ast_utils::is_specific_member_access(callee, Some("Promise"), Some("reject"))
            && ast_utils::member_object(callee).is_some_and(ast_utils::is_global_reference)
        {
            self.check_reject_call(e, call, cx);
        }
    }

    /// `new Promise((resolve, reject) => ..)`: the calls of `reject`.
    fn check_new<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(construction) = e.kind() else {
            return;
        };
        let callee = construction.callee();
        if !callee.is_ident("Promise") {
            return;
        }
        let Some(executor) = construction.args().first().and_then(ast_utils::as_function) else {
            return;
        };
        let Some(reject) = executor.params_with_this().nth(1) else {
            return;
        };
        if reject.is_rest() || reject.default().is_some() {
            return;
        }
        let Some(name) = reject.pat().as_ident() else {
            return;
        };
        if !ast_utils::is_global_reference(callee) {
            return;
        }
        // The first of that name: if the function has the name too, that is the function.
        let declared = Node::Func(executor).declared_symbols();
        let Some(variable) = declared.into_iter().find(|variable| variable.name() == name) else {
            return;
        };
        for reference in variable.references().filter(|reference| reference.is_read()) {
            if let Some(identifier) = reference.expr()
                && let Node::Expr(parent) = identifier.parent()
                && let ExprKind::Call(call) = parent.kind()
                && call.callee() == identifier
            {
                self.check_reject_call(parent, call, cx);
            }
        }
    }
}

impl Rule for PreferPromiseRejectErrors {
    const META: Meta = Meta::eslint("prefer-promise-reject-errors", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferPromiseRejectErrors {
            allow_empty_reject: options.object(0).bool_or("allowEmptyReject", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check_call);
        on.exprs([ExprTag::New], Self::check_new);
    }
}
