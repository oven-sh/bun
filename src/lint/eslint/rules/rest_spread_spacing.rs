use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::next_token;

/// Enforce spacing between rest and spread operators and their expressions.
pub struct RestSpreadSpacing {
    is_always: bool,
}

const UNEXPECTED_WHITESPACE: Message = Message::new(
    "unexpectedWhitespace",
    "Unexpected whitespace after {{type}} operator.",
);
const EXPECTED_WHITESPACE: Message = Message::new(
    "expectedWhitespace",
    "Expected whitespace after {{type}} operator.",
);

impl RestSpreadSpacing {
    /// `start`: where ESLint's `SpreadElement` or `RestElement` starts. `kind` says what to call
    /// its operator.
    fn check(&self, start: u32, kind: &dyn Fn() -> &'static str, cx: &Cx<'_, Self>) {
        let operator = next_token(cx.text(), start);
        let gap = Span::after(operator, skip_trivia(cx.text(), operator.end));
        let has_whitespace = match cx.slice(gap) {
            [] => false,
            between if strings::contains_char(between, b'/') => {
                cx.file().is_space_between(operator, Span::empty(gap.end))
            }
            _ => true,
        };
        if self.is_always && !has_whitespace {
            cx.report(operator, EXPECTED_WHITESPACE)
                .data("type", kind())
                .fix(|fixer| fixer.replace(gap, " "));
        } else if !self.is_always && has_whitespace {
            cx.report(gap, UNEXPECTED_WHITESPACE)
                .data("type", kind())
                .fix(|fixer| fixer.remove(gap));
        }
    }
}

impl Rule for RestSpreadSpacing {
    const META: Meta = Meta::eslint("rest-spread-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new()
        .exprs(&[ExprTag::Spread])
        .props()
        .params()
        .pats(&[PatTag::Array, PatTag::Object]);
    no_state!();

    fn new(options: &Options) -> Self {
        RestSpreadSpacing {
            is_always: options.str(0) == Some("always"),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // A `JSXSpreadChild`.
        if e.jsx_container_span().is_some() {
            return;
        }
        let kind = || if utils::is_assignment_target(e) { "rest" } else { "spread" };
        self.check(e.span().start, &kind, cx);
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.kind() != PropKind::Spread {
            return;
        }
        let Node::Expr(object) = prop.parent() else {
            return;
        };
        // A `JSXSpreadAttribute`.
        if object.tag() == ExprTag::Jsx {
            return;
        }
        let kind = || match utils::is_assignment_target(object) {
            true => "rest property",
            false => "spread property",
        };
        self.check(prop.span().start, &kind, cx);
    }

    fn param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if param.is_rest() {
            self.check(param.span().start, &|| "rest", cx);
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pat.kind() {
            PatKind::Array(elements) => {
                if let Some(rest) = elements.last().filter(|it| it.is_rest()) {
                    self.check(rest.span().start, &|| "rest", cx);
                }
            }
            PatKind::Object(props) => {
                if let Some(rest) = props.last().filter(|it| it.is_rest()) {
                    self.check(rest.span().start, &|| "rest property", cx);
                }
            }
            _ => {}
        }
    }
}
