use bun_lint::prelude::*;

/// Require spread operators instead of `.apply()`.
pub struct PreferSpread;

const PREFER_SPREAD: Message =
    Message::new("preferSpread", "Use the spread operator instead of '.apply()'.");

impl Rule for PreferSpread {
    const META: Meta = Meta::eslint("prefer-spread", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferSpread
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("apply") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let (callee, args) = (call.callee(), call.args());
        let (Some(this_arg), Some(list)) = (args.get(0), args.get(1)) else {
            return;
        };
        if args.len() != 2
            || matches!(list.tag(), ExprTag::Array | ExprTag::Spread)
            || !ast_utils::is_specific_member_access(callee, None, Some("apply"))
        {
            return;
        }
        let Some(applied) = ast_utils::member_object(callee) else {
            return;
        };
        // Whether `.apply()` leaves `this` as it is in a plain call.
        let is_valid_this_arg = match ast_utils::member_object(applied) {
            Some(expected_this) => ast_utils::equal_tokens(cx.file(), expected_this, this_arg),
            None => ast_utils::is_null_or_undefined(this_arg),
        };
        if is_valid_this_arg {
            cx.report(e, PREFER_SPREAD);
        }
    }
}
