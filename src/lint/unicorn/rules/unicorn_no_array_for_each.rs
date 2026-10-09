use bun_lint_oxlint::ast_util::{as_member_expression, get_member_expr, is_import_symbol, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbids the use of `Array#forEach` in favor of a for loop.
pub struct NoArrayForEach;

const NO_ARRAY_FOR_EACH: Message = Message::new("", "Do not use `Array#forEach`");

const IGNORED_OBJECTS: [&str; 3] = ["Children", "r", "pIteration"];

/// The `a` of `a.b[c].d`.
fn leftmost_identifier_reference(e: Expr<'_>) -> Option<Expr<'_>> {
    let mut at = e;
    while let Some(member) = as_member_expression(at) {
        at = member.object()?;
    }
    (at.tag() == ExprTag::Ident && !at.is_parenthesized()).then_some(at)
}

impl Rule for NoArrayForEach {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-array-for-each", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoArrayForEach
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("forEach") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(ExprKind::Dot { obj, name, .. }) = e.callee().and_then(get_member_expr).map(Expr::kind) else {
                return;
            };
            if !name.name().is("forEach") {
                return;
            }
            let object_name = match obj.as_ident() {
                Some(name) => (!obj.is_parenthesized()).then_some(name),
                None => as_member_expression(obj).and_then(static_property_name),
            };
            if object_name.is_some_and(|it| it.is_any(&IGNORED_OBJECTS))
                || cx.file().mentions("effect")
                    && leftmost_identifier_reference(obj).is_some_and(|it| is_import_symbol(it, "effect", "Effect"))
            {
                return;
            }
            cx.report(name, NO_ARRAY_FOR_EACH);
        });
    }
}
