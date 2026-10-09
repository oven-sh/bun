use bun_lint_oxlint::ast_util::{
    as_member_expression, get_inner_expression, get_member_expr, is_import_symbol, static_property_name,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbids the use of `Array#forEach` in favor of a for loop.
pub struct NoArrayForEach;

const NO_ARRAY_FOR_EACH: Message = Message::new("", "Do not use `Array#forEach`");

const ELEMENT_ONLY: &str = "Replace it with a `for…of` loop. It is faster, more readable, and allows early exits with `break` or `return`.";
const INDEX: &str = "For arrays that need the index, replace it with a `for…of` loop over `.entries()`, such as `for (const [index, element] of array.entries())`. Otherwise, use the appropriate `for…of` loop. Array `.entries()` keeps indexes numeric and loops allow early exits with `break` or `return`.";
const EXTRA_ARGUMENTS: &str = "Replace it with a `for…of` loop that preserves the extra callback arguments you use. For arrays, `.entries()` provides the numeric index, and the original array can be referenced directly if needed.";

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
            // By the parameters of the callback.
            let first = e.as_call().and_then(|it| it.args().first());
            let params = first.map(get_inner_expression).and_then(Expr::as_fn).map(Func::params);
            cx.report(name, NO_ARRAY_FOR_EACH).help(match params {
                Some(params) if params.len() >= 3 || params.iter().any(Param::is_rest) => EXTRA_ARGUMENTS,
                Some(params) if params.len() == 2 => INDEX,
                _ => ELEMENT_ONLY,
            });
        });
    }
}
