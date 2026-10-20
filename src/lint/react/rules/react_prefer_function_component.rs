use bun_lint_oxlint::ast_util::{as_function_expression, as_method_definition, as_property_definition, static_name};
use crate::react::{FunctionsWithJsx, is_es6_component, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that React components are written as function components instead of class components.
pub struct PreferFunctionComponent {
    allow_error_boundary: bool,
    allow_jsx_utility_class: bool,
}

const PREFER_FUNCTION_COMPONENT: Message =
    Message::new("", "Class component should be written as a function component.");

pub struct State<'a> {
    /// `None`: it is not asked for.
    functions_with_jsx: Option<FunctionsWithJsx<'a>>,
}

impl Rule for PreferFunctionComponent {
    const META: Meta = Meta::oxlint(Plugin::React, "prefer-function-component", Kind::Suggestion);
    const ON: On = On::new().classes();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        PreferFunctionComponent {
            allow_error_boundary: options.bool_or("allowErrorBoundary", true),
            allow_jsx_utility_class: options.bool_or("allowJsxUtilityClass", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !is_jsx(file) || !file.has_classes() {
            return None;
        }
        Some(State { functions_with_jsx: (!self.allow_jsx_utility_class).then(|| FunctionsWithJsx::new(file)) })
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if !is_es6_component(Node::Class(class))
            && !cx.state.functions_with_jsx.as_ref().is_some_and(|it| class_body_contains_jsx(class, it))
            || self.allow_error_boundary && is_error_boundary(class)
        {
            return;
        }
        cx.report(class.name().map_or_else(|| class.estree_span(), Ident::span), PREFER_FUNCTION_COMPONENT);
    }
}

/// It has `componentDidCatch` or `static getDerivedStateFromError`.
fn is_error_boundary(class: Class) -> bool {
    class.members().iter().any(|member| {
        let node = Node::Member(member);
        (as_method_definition(node).is_some() || as_property_definition(node).is_some())
            && match member.key().and_then(static_name).map(Name::bytes) {
                Some(b"componentDidCatch") => !member.is_static(),
                Some(b"getDerivedStateFromError") => member.is_static(),
                _ => false,
            }
    })
}

/// A method, or a function that a property is initialized with, has JSX in it.
fn class_body_contains_jsx<'a>(class: Class<'a>, functions_with_jsx: &FunctionsWithJsx<'a>) -> bool {
    class.members().iter().any(|member| {
        let node = Node::Member(member);
        let function = match as_method_definition(node) {
            Some(method) => method.func(),
            None => as_property_definition(node).and_then(Member::init).and_then(as_function_expression),
        };
        function.is_some_and(|it| functions_with_jsx.function_contains_jsx(it))
    })
}
