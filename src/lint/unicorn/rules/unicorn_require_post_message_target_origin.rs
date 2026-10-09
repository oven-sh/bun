use bun_lint_oxlint::ast_util::{get_member_expr, is_computed, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce using the `targetOrigin` argument with `window.postMessage()`.
pub struct RequirePostMessageTargetOrigin;

const MISSING_TARGET_ORIGIN: Message = Message::new("", "Missing the `targetOrigin` argument.");

/// `port`, `channel.port1`, `event.ports[0]`, and whatever is a property of one.
fn is_message_port_expression(e: Expr) -> bool {
    let mut current = e;
    loop {
        if current.as_ident().is_some_and(|it| it.is_any(&["port", "port1", "port2", "messagePort"])) {
            return true;
        }
        let Some((member, object)) = get_member_expr(current).and_then(|it| Some((it, it.object()?))) else {
            return false;
        };
        let is_named = |member: Expr, names: &[&str]| static_property_name(member).is_some_and(|it| it.is_any(names));
        if is_named(member, &["port1", "port2"])
            || is_computed(member) && get_member_expr(object).is_some_and(|it| is_named(it, &["ports"]))
        {
            return true;
        }
        current = object;
    }
}

impl Rule for RequirePostMessageTargetOrigin {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "require-post-message-target-origin", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequirePostMessageTargetOrigin
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("postMessage") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|it| it.args().len() == 1 && !it.is_optional()) else {
                return;
            };
            let Some(ExprKind::Dot { obj, name, chain }) = get_member_expr(call.callee()).map(Expr::kind) else {
                return;
            };
            let Some(message) = call.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
                return;
            };
            if !name.name().is("postMessage")
                || chain == Chain::Start && obj.tag() != ExprTag::Ident
                || is_message_port_expression(obj)
            {
                return;
            }
            let end = Span::empty(message.outer_span().end);
            cx.report(end, MISSING_TARGET_ORIGIN).suggest(MISSING_TARGET_ORIGIN, |fixer| {
                let window = obj.as_ident().filter(|_| !obj.is_parenthesized()).map_or(&b"self"[..], Name::bytes);
                fixer.insert_after(end, [&b", "[..], window, b".location.origin"].concat())
            });
        });
    }
}
