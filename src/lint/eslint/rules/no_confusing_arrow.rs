use bun_lint::prelude::*;

/// Disallow arrow functions where they could be confused with comparisons.
pub struct NoConfusingArrow {
    allow_parens: bool,
    only_one_simple_param: bool,
}

const CONFUSING: Message = Message::new(
    "confusing",
    "Arrow function used ambiguously with a conditional expression.",
);

/// The parameters are one `Identifier`.
fn has_one_simple_param(func: Func) -> bool {
    let params = func.params();
    params.len() == 1
        && params.first().is_some_and(|param| {
            !param.is_rest() && param.default().is_none() && param.pat().tag() == PatTag::Ident
        })
}

impl Rule for NoConfusingArrow {
    const META: Meta = Meta::eslint("no-confusing-arrow", Kind::Suggestion)
        .fixable(Fixable::Code)
        .deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Fn]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        NoConfusingArrow {
            allow_parens: config.bool_or("allowParens", true),
            only_one_simple_param: config.bool_or("onlyOneSimpleParam", false),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Fn(func) = e.kind() else {
            return;
        };
        let FnBody::Expr(body) = func.body() else {
            return;
        };
        if body.tag() != ExprTag::Cond
            || self.allow_parens && body.is_parenthesized()
            || self.only_one_simple_param && !has_one_simple_param(func)
        {
            return;
        }
        cx.report(e, CONFUSING).fix(|fixer| {
            self.allow_parens
                .then(|| fixer.replace(body, [&b"("[..], body.text(), &b")"[..]].concat()))
        });
    }
}
