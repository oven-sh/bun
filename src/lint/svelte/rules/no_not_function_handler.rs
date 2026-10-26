use crate::events::EVENT_NAMES;
use crate::variables::find_variable;
use bun_lint::ast::svelte::{Role, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::ast::svelte::variables::{DefNode, DefinitionKind};
use bun_lint::semantic::DeclarationKind;
use rustc_hash::FxHashSet;

/// disallow use of not function in event handler
pub struct NoNotFunctionHandler;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected {{phrase}} in event handler.");

/// `findRootExpression`: the initializer of a constant `e` names, and so on. Each identifier is visited once.
fn root_expression(mut e: Expr<'_>) -> Expr<'_> {
    let mut seen = FxHashSet::default();
    while e.as_ident().is_some() && seen.insert(e) {
        match initializer(e) {
            Some(init) => e = init,
            None => break,
        }
    }
    e
}

/// The initializer of the constant that `e` alone declares with `const`.
fn initializer(e: Expr<'_>) -> Option<Expr<'_>> {
    let variable = find_variable(e)?;
    let mut definitions = variable.definitions();
    let (Some(definition), None) = (definitions.next(), definitions.next()) else {
        return None;
    };
    if definition.kind() != DefinitionKind::Declared(DeclarationKind::Variable) {
        return None;
    }
    // `def.parent.kind === "const"`: a `SvelteConstTag` has no `kind`.
    match (definition.node(), definition.parent()) {
        (Some(DefNode::Program(Node::VarDecl(declarator))), Some(DefNode::Program(Node::Stmt(_))))
            if declarator.var_kind() == VarKind::Const =>
        {
            declarator.init()
        }
        _ => None,
    }
}

/// `PHRASES`
fn phrase(e: Expr<'_>) -> Option<&'static str> {
    Some(match e.kind() {
        ExprKind::Object(_) => "object",
        ExprKind::Array(_) => "array",
        ExprKind::Class(_) => "class",
        ExprKind::Regex(_) => "regex value",
        ExprKind::BigInt(_) => "bigint value",
        ExprKind::String(_) | ExprKind::Template(_) => "string value",
        ExprKind::Number(_) => "number value",
        ExprKind::True | ExprKind::False => "boolean value",
        _ => return None,
    })
}

impl NoNotFunctionHandler {
    fn verify<'a>(&self, handler: Option<Node<'a>>, cx: &mut Cx<'a, Self>) {
        let Some(Node::Expr(e)) = handler else {
            return;
        };
        if let Some(phrase) = phrase(root_expression(e)) {
            cx.report(e, UNEXPECTED).data("phrase", phrase);
        }
    }
}

impl Rule for NoNotFunctionHandler {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-not-function-handler", Kind::Problem).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::Attribute, SvelteTag::Directive]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoNotFunctionHandler
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            SvelteTag::Directive if node.kind() == SvelteKind::EventHandler => {
                self.verify(node.code(Role::Expression).and_then(|it| it.node()), cx);
            }
            SvelteTag::Attribute => {
                let is_named = node.child(Role::Key).is_some_and(|it| it.tag() == SvelteTag::Name);
                let is_event = std::str::from_utf8(node.name()).is_ok_and(|it| EVENT_NAMES.binary_search(&it).is_ok());
                if !is_named || !is_event {
                    return;
                }
                for value in node.nodes(Role::Value).filter(|it| it.tag() == SvelteTag::MustacheTag) {
                    self.verify(value.code(Role::Expression).and_then(|it| it.node()), cx);
                }
            }
            _ => {}
        }
    }
}
