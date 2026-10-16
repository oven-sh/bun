use crate::react::is_jsx;
use crate::util_pragma::get_from_context;
use crate::util_variable::get_variable_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow missing React when using JSX.
pub struct ReactInJsxScope;

const NOT_IN_SCOPE: Message = Message::new("notInScope", "'{{name}}' must be in scope when using JSX");
const REACT_IN_JSX_SCOPE: Message = Message::new("", "`React` must be in scope when using JSX.");

/// What has to be in scope.
pub struct Pragma<'a> {
    name: Name<'a>,
    /// Whether the file has the name in it.
    is_mentioned: bool,
}

impl<'a> Pragma<'a> {
    /// What the configuration declares does not count.
    fn is_declared_in(&self, scope: Scope<'a>) -> bool {
        scope.resolve_name(self.name).is_some_and(|it| it.declarations().next().is_some())
    }

    fn is_in_scope_of(&self, node: Node<'a>, is_oxlint: bool) -> bool {
        if !self.is_mentioned {
            return false;
        }
        // oxlint asks what the name means there.
        if is_oxlint { self.is_declared_in(node.scope()) } else { get_variable_from_context(node, self.name).is_some() }
    }
}

impl Rule for ReactInJsxScope {
    const META: Meta = Meta::plugin(Plugin::React, "react-in-jsx-scope", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = Pragma<'a>;

    fn new(_: &Options) -> Self {
        ReactInJsxScope
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Pragma<'a>> {
        let is_oxlint = file.language().is_oxlint;
        if (is_oxlint && !is_jsx(file)) || !file.has_exprs([ExprTag::Jsx]) {
            return None;
        }
        // oxlint knows no pragma.
        let name = if is_oxlint { "React" } else { std::str::from_utf8(get_from_context(file)).ok()? };
        // Every function that is no arrow function has a variable `arguments`.
        let pragma = Pragma { name: file.name_of(name), is_mentioned: file.mentions(name) || name == "arguments" };
        // For ESLint what the configuration defines is a variable of the global scope.
        if (!is_oxlint && file.global_named(pragma.name).is_some())
            || (pragma.is_mentioned && pragma.is_declared_in(file.top_level_scope()))
        {
            return None;
        }
        Some(pragma)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let (is_oxlint, name) = (cx.language().is_oxlint, cx.state.name);
        if cx.state.is_in_scope_of(Node::Expr(e), is_oxlint) {
            return;
        }
        // oxlint points at the name of the element.
        if is_oxlint {
            cx.report(jsx.tag().map_or_else(|| jsx.opening_span(), Expr::span), REACT_IN_JSX_SCOPE);
        } else {
            cx.report(jsx.opening_span(), NOT_IN_SCOPE).data("name", name);
        }
    }
}
