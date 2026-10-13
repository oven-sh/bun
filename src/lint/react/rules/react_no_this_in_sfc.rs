use bun_lint_oxlint::ast_util::{as_function, as_method_definition, as_property_definition, is_react_component_name};
use crate::react::{AncestorWalk, get_parent_component as get_parent_class_component, is_jsx};
use crate::util_components::Components;
use crate::util_components_list::{At, Queue};
use crate::util_jsx::Branches;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_parent;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::ops::ControlFlow;

/// Disallow `this` from being used in stateless functional components
pub struct NoThisInSfc;

const NO_THIS_IN_SFC: Message = Message::new("noThisInSFC", "Stateless functional components should not use `this`");
const OXLINT: Message = Message::new("", "Stateless functional components should not use `this`");

pub struct State<'a> {
    /// The function whose `this` it is, if it can be a component, and whether a member of a class is in between.
    parent_component: AncestorWalk<'a, bool, Option<(Node<'a>, bool)>>,
    parent_class_component: AncestorMemo<'a, Node<'a>>,
    components: Components<'a>,
    enclosing_function: AncestorMemo<'a, Func<'a>>,
    /// Whether a function, or one around it, [`can_be_component`].
    is_in_candidate: FxHashMap<Func<'a>, bool>,
    /// The `this.a` in a function that upstream can take for a component.
    members: Queue<'a>,
}

impl Rule for NoThisInSfc {
    const META: Meta = Meta::plugin(Plugin::React, "no-this-in-sfc", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::This]).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoThisInSfc
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::This]);
        // Which function is a component depends for upstream on what comes before it.
        if file.language().is_oxlint { on } else { on.finish() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let is_candidate = match file.language().is_oxlint {
            true => is_jsx(file),
            false => {
                file.has_exprs([ExprTag::This])
                    && (file.has_exprs([ExprTag::Jsx, ExprTag::Null]) || file.mentions("createElement"))
            }
        };
        is_candidate.then(|| State {
            parent_component: AncestorWalk::default(),
            parent_class_component: AncestorMemo::default(),
            components: Components::new(file),
            enclosing_function: AncestorMemo::default(),
            is_in_candidate: FxHashMap::default(),
            members: Queue::default(),
        })
    }

    fn expr<'a>(&self, this: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(member) = this.parent() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint has a node for the parentheses, and takes the `this` of `a[this]` too.
        let is_object = if is_oxlint { !this.is_parenthesized() } else { member.object() == Some(this) };
        if !is_object || !ast_utils::is_member_expression(member) {
            return;
        }
        if is_oxlint {
            if let Some((component, false)) =
                cx.state.parent_component.run(Node::Expr(this), false, get_parent_component)
                && get_parent_class_component(component, &mut cx.state.parent_class_component).is_none()
            {
                cx.report(this, OXLINT);
            }
            return;
        }
        let node = Node::Expr(member);
        let mut current = cx.state.enclosing_function.find(node, |_, ancestor| ancestor.as_func());
        // Many of them under many functions go up these once.
        let mut passed: SmallVec<[Func<'a>; 8]> = SmallVec::new();
        let is_in_candidate = loop {
            let Some(func) = current else { break false };
            if let Some(&known) = cx.state.is_in_candidate.get(&func) {
                break known;
            }
            passed.push(func);
            if can_be_component(func, &cx.state.components) {
                break true;
            }
            current = func.enclosing();
        };
        cx.state.is_in_candidate.extend(passed.into_iter().map(|it| (it, is_in_candidate)));
        if is_in_candidate {
            cx.state.members.push(At::enter(node), 0, node);
        }
    }

    /// upstream's listener, in the order of ESLint's walk.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        while let Some(event) = cx.state.members.pop_until(At::END) {
            let components = &mut cx.state.components;
            components.advance(event.at);
            let component = components.get_parent_stateless_component(event.node).and_then(|it| components.get(it));
            if component.is_some_and(|id| !is_in_property(components.component(id).node)) {
                cx.report(event.node, NO_THIS_IN_SFC);
            }
        }
    }
}

/// Whether upstream can take `func` for a component: it returns JSX or `null` and is not directly in a class member.
fn can_be_component<'a>(func: Func<'a>, components: &Components<'a>) -> bool {
    let node = Node::Func(func);
    ast_utils::is_function_with_body(func)
        && !matches!(estree_parent(node), Node::Member(_))
        && components.is_returning_jsx_or_null(node, Branches::Any)
}

/// `node.parent.type === "Property"`
fn is_in_property(node: Node<'_>) -> bool {
    match estree_parent(node) {
        // A `ChainExpression` is around the whole of an optional chain.
        _ if node.as_expr().is_some_and(Expr::is_chain_root) => false,
        Node::Prop(it) => it.kind() != PropKind::Spread && !it.is_jsx_attribute(),
        // The default is in an `AssignmentPattern`.
        Node::PatProp(it) => it.default().map(Node::Expr) != Some(node.as_written()),
        _ => false,
    }
}

/// One step of the way up from a `this`. `is_in_nested_this_context`: a member of a class has been passed.
fn get_parent_component<'a>(
    child: Node<'a>,
    ancestor: Node<'a>,
    is_in_nested_this_context: bool,
) -> ControlFlow<Option<(Node<'a>, bool)>, bool> {
    match ancestor {
        Node::Func(func) if func.kind() == FnKind::StaticBlock => ControlFlow::Break(None),
        Node::Func(func) if as_function(ancestor).is_some() => match is_potential_react_component(func) {
            true => ControlFlow::Break(Some((ancestor, is_in_nested_this_context))),
            // An arrow function has the `this` of what is around it.
            false if func.is_arrow() => ControlFlow::Continue(is_in_nested_this_context),
            false => ControlFlow::Break(None),
        },
        Node::Member(member) => ControlFlow::Continue(
            is_in_nested_this_context
                || as_method_definition(ancestor).is_some()
                || as_property_definition(ancestor).is_some()
                || member.flags().contains(Flags::ACCESSOR) && member.init().map(Node::Expr) == Some(child),
        ),
        _ => ControlFlow::Continue(is_in_nested_this_context),
    }
}

fn is_potential_react_component(func: Func) -> bool {
    get_function_name(func).is_some_and(|name| is_react_component_name(name.bytes()))
}

fn get_function_name(func: Func<'_>) -> Option<Name<'_>> {
    if !func.is_arrow() {
        return func.name().map(Ident::name);
    }
    match func.owner() {
        Node::Expr(e) if !e.is_parenthesized() => match e.parent() {
            Node::VarDecl(declarator) => declarator.pat().as_ident(),
            _ => None,
        },
        _ => None,
    }
}
