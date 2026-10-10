use crate::react::{is_es5_component, is_es6_component, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent React class style, preferring ES2015 classes over `createReactClass`.
pub struct PreferEs6Class {
    is_always: bool,
}

const UNEXPECTED_ES6_CLASS: Message =
    Message::new("", "Components should use `createReactClass` instead of an ES2015 class.");
const EXPECTED_ES6_CLASS: Message =
    Message::new("", "Components should use an ES2015 class instead of `createReactClass`.");

impl Rule for PreferEs6Class {
    const META: Meta = Meta::oxlint(Plugin::React, "prefer-es6-class", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]).classes();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferEs6Class { is_always: options.str(0) != Some("never") }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if !self.is_always {
            on = on.classes();
        } else if file.mentions("createReactClass") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_jsx(file) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if is_es5_component(Node::Expr(e))
            && let Some(callee) = e.callee()
        {
            cx.report(callee.outer_span(), EXPECTED_ES6_CLASS);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if is_es6_component(Node::Class(class)) {
            cx.report(class.name().map_or_else(|| class.estree_span(), Ident::span), UNEXPECTED_ES6_CLASS);
        }
    }
}
