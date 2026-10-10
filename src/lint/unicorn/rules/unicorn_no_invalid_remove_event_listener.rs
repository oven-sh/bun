use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// It warns when you use a non-function value as the second argument of `removeEventListener`.
pub struct NoInvalidRemoveEventListener;

const INVALID_CALL: Message = Message::new("", "Invalid `removeEventListener` call.");

/// The name of `a.name`, where it is written. Not of `a.#name`.
fn static_member_name(callee: Expr<'_>) -> Option<Ident<'_>> {
    get_member_expr(callee).filter(|it| !it.is_private_member())?.member_name()
}

impl Rule for NoInvalidRemoveEventListener {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-invalid-remove-event-listener", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoInvalidRemoveEventListener
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("removeEventListener") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call() else {
                return;
            };
            let Some(listener) = call.args().get(1) else {
                return;
            };
            if call.is_optional() || listener.is_parenthesized() {
                return;
            }
            let is_invalid = match listener.kind() {
                ExprKind::Fn(_) => true,
                ExprKind::Call(bound) if !listener.is_chain_root() => {
                    static_member_name(bound.callee()).is_some_and(|it| it.name().is("bind"))
                }
                _ => false,
            };
            if is_invalid
                && let Some(name) = static_member_name(call.callee())
                && name.name().is("removeEventListener")
                && call.args().first().is_some_and(|it| it.tag() != ExprTag::Spread)
            {
                // Of a long function only its head.
                let listener_span = match listener.kind() {
                    ExprKind::Fn(func) if listener.span().len() > 20 => {
                        let end = match func.body() {
                            _ if !func.is_arrow() => func.params_span().map(|it| it.end),
                            FnBody::Expr(body) => Some(body.outer_span().start),
                            _ => func.body_span().map(|it| it.start),
                        };
                        let whole = listener.span();
                        Span::new(whole.start, end.unwrap_or(whole.end))
                    }
                    _ => listener.span(),
                };
                cx.report(name, INVALID_CALL)
                    .first_label("`removeEventListener` called here.")
                    .label(listener_span, "Invalid argument here");
            }
        });
    }
}
