use crate::react::{self, is_jsx};
use crate::util_component_util::{self, Pragmas};
use crate::util_pragma::{get_create_class_from_context, mentions_create_class};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce ES5 or ES6 class for React Components
pub struct PreferEs6Class {
    is_always: bool,
}

const SHOULD_USE_ES6_CLASS: Message =
    Message::new("shouldUseES6Class", "Component should use es6 class instead of createClass");
const SHOULD_USE_CREATE_CLASS: Message =
    Message::new("shouldUseCreateClass", "Component should use createClass instead of es6 class");
const UNEXPECTED_ES6_CLASS: Message =
    Message::new("", "Components should use `createReactClass` instead of an ES2015 class.");
const EXPECTED_ES6_CLASS: Message =
    Message::new("", "Components should use an ES2015 class instead of `createReactClass`.");

pub struct State<'a> {
    /// `None` for oxlint, which knows `React` and `createReactClass` alone.
    pragmas: Option<Pragmas<'a>>,
}

impl Rule for PreferEs6Class {
    const META: Meta = Meta::plugin(Plugin::React, "prefer-es6-class", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::New]).classes();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        PreferEs6Class { is_always: options.str(0) != Some("never") }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if !self.is_always {
            on = on.classes();
        } else if file.language().is_oxlint {
            if file.mentions("createReactClass") {
                on = on.exprs(&[ExprTag::Call]);
            }
        } else if mentions_create_class(file, get_create_class_from_context(file)) {
            on = on.exprs(&[ExprTag::Call, ExprTag::New]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        // oxlint passes over a file that cannot have JSX.
        let is_oxlint = file.language().is_oxlint;
        (!is_oxlint || is_jsx(file)).then(|| State { pragmas: (!is_oxlint).then(|| Pragmas::new(file)) })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(pragmas) = cx.state.pragmas else {
            // oxlint points at what is called.
            if react::is_es5_component(Node::Expr(e))
                && let Some(callee) = e.callee()
            {
                cx.report(callee.outer_span(), EXPECTED_ES6_CLASS);
            }
            return;
        };
        let Some(call) = e.as_call_like() else {
            return;
        };
        for argument in call.args().iter().filter(|it| it.tag() == ExprTag::Object) {
            if util_component_util::is_es5_component(Node::Expr(argument), &pragmas) {
                cx.report(argument, SHOULD_USE_ES6_CLASS);
            }
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let Some(pragmas) = cx.state.pragmas else {
            // oxlint points at the name, and knows a class expression too.
            if react::is_es6_component(Node::Class(class)) {
                cx.report(class.name().map_or_else(|| class.estree_span(), Ident::span), UNEXPECTED_ES6_CLASS);
            }
            return;
        };
        if matches!(class.owner(), Node::Stmt(_)) && util_component_util::is_es6_component(class, &pragmas) {
            cx.report(class.estree_span(), SHOULD_USE_CREATE_CLASS);
        }
    }
}
