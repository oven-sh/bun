use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::get_inner_expression;

/// Disallow `new` operators with the `String`, `Number`, and `Boolean` objects.
pub struct NoNewWrappers;

const NO_CONSTRUCTOR: Message =
    Message::new("noConstructor", "Do not use {{fn}} as a constructor.");
/// What oxlint says about `new Symbol()`.
const NOT_A_CONSTRUCTOR: Message = Message::new("notAConstructor", "`{{fn}}` is not a constructor");

impl Rule for NoNewWrappers {
    const META: Meta = Meta::eslint("no-new-wrappers", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewWrappers
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["String", "Number", "Boolean", "Symbol"]) {
            return;
        }
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(call) = e.kind() else {
                return;
            };
            let Some(name) = call.callee().as_ident() else {
                return;
            };
            let is_symbol = name.is("Symbol") && cx.language().is_oxlint;
            if !name.is_any(&["String", "Number", "Boolean"]) && !is_symbol {
                return;
            }
            if cx.file().global(name.bytes()).is_some()
                && Node::Expr(e).scope().resolve_name(name).is_none()
            {
                // Of what is long, oxlint points at `new String`.
                let place = match cx.language().is_oxlint && e.span().len() > 24 {
                    true => e.span().to(call.callee().span()),
                    false => e.span(),
                };
                let message = if is_symbol { NOT_A_CONSTRUCTOR } else { NO_CONSTRUCTOR };
                let report = cx.report(place, message).data("fn", name);
                // oxlint has a fix: without the `new`, or the argument if that is a literal of the kind.
                if cx.language().is_oxlint {
                    report.fix(|fixer| {
                        let literal = call.args().first().map(get_inner_expression).filter(|it| match it.tag() {
                            ExprTag::True | ExprTag::False => name.is("Boolean"),
                            ExprTag::String => name.is("String"),
                            ExprTag::Number => name.is("Number"),
                            _ => false,
                        });
                        match literal {
                            Some(literal) => fixer.replace(e, literal.text()),
                            None => fixer.remove(Span::new(e.span().start, call.callee().span().start)),
                        }
                    });
                }
            }
        });
    }
}
