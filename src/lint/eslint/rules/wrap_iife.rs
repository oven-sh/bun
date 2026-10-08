use bun_lint::prelude::*;

/// Require parentheses around immediate `function` invocations.
pub struct WrapIife {
    style: Style,
    includes_function_prototype_methods: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Style {
    Outside,
    Inside,
    Any,
}

const WRAP_INVOCATION: Message = Message::new(
    "wrapInvocation",
    "Wrap an immediate function invocation in parentheses.",
);
const WRAP_EXPRESSION: Message = Message::new(
    "wrapExpression",
    "Wrap only the function expression in parens.",
);
const MOVE_INVOCATION: Message = Message::new(
    "moveInvocation",
    "Move the invocation into the parens that contain the function.",
);

fn is_function_expression(e: Expr) -> bool {
    e.as_fn().is_some_and(|func| func.kind() == FnKind::Expr)
}

/// ESLint's `isCalleeOfNewExpression`
fn is_callee_of_new_expression(e: Expr) -> bool {
    matches!(e.parent(), Node::Expr(parent)
        if matches!(parent.kind(), ExprKind::New(call) if call.callee() == e))
}

fn in_parentheses(text: &[u8]) -> Vec<u8> {
    [&b"("[..], text, b")"].concat()
}

impl WrapIife {
    /// ESLint's `getFunctionNodeFromIIFE`
    fn get_function_node_from_iife<'a>(&self, call: Call<'a>) -> Option<Expr<'a>> {
        let callee = call.callee();
        if is_function_expression(callee) {
            return Some(callee);
        }
        if !self.includes_function_prototype_methods {
            return None;
        }
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
            return None;
        };
        let is_call_or_apply = is_function_expression(obj)
            && ast_utils::get_static_property_name(callee)
                .is_some_and(|name| matches!(&*name, b"call" | b"apply"));
        is_call_or_apply.then_some(obj)
    }

    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(inner) = e.as_call().and_then(|call| self.get_function_node_from_iife(call)) else {
            return;
        };
        let is_call_wrapped = ast_utils::is_parenthesised(e);
        let is_function_wrapped = ast_utils::is_parenthesised(inner);
        let style = self.style;

        if !is_call_wrapped && !is_function_wrapped {
            cx.report(e, WRAP_INVOCATION).fix(|fixer| {
                let to_surround = if style == Style::Inside { inner } else { e };
                fixer.replace(to_surround, in_parentheses(to_surround.text()))
            });
        } else if style == Style::Inside && !is_function_wrapped {
            cx.report(e, WRAP_EXPRESSION).fix(|fixer| {
                if !e.is_parenthesized() || is_callee_of_new_expression(e) {
                    return fixer.replace(inner, in_parentheses(inner.text()));
                }
                // The parentheses are only around the call: the `)` moves to the function.
                let file = fixer.file();
                let paren_after = skip_trivia(file.text(), e.span().end);
                let moved = file.slice(Span::after(inner.span(), paren_after));
                fixer.replace(
                    Span::after(inner.span(), paren_after + 1),
                    [&b")"[..], moved].concat(),
                )
            });
        } else if style == Style::Outside && !is_call_wrapped {
            cx.report(e, MOVE_INVOCATION).fix(|fixer| {
                let file = fixer.file();
                let paren_after = skip_trivia(file.text(), inner.span().end);
                let moved = file.slice(Span::new(paren_after + 1, e.span().end));
                fixer.replace(
                    Span::new(paren_after, e.span().end),
                    [moved, &b")"[..]].concat(),
                )
            });
        }
    }
}

impl Rule for WrapIife {
    const META: Meta = Meta::eslint("wrap-iife", Kind::Layout)
        .fixable(Fixable::Code)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        WrapIife {
            style: match options.str(0) {
                Some("inside") => Style::Inside,
                Some("any") => Style::Any,
                _ => Style::Outside,
            },
            includes_function_prototype_methods: options.object(1).bool_or("functionPrototypeMethods", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check);
    }
}
