use bun_lint_oxlint::ast_util::{as_function, as_method_definition, as_property_definition, is_react_component_name};
use crate::react::{AncestorWalk, get_parent_component as get_parent_class_component, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use std::ops::ControlFlow;

/// Prevents using `this` in stateless functional components.
pub struct NoThisInSfc;

const NO_THIS_IN_SFC: Message = Message::new("", "Stateless functional components should not use `this`");

#[derive(Default)]
pub struct State<'a> {
    /// The function whose `this` it is, if it can be a component, and whether a member of a class is in between.
    parent_component: AncestorWalk<'a, bool, Option<(Node<'a>, bool)>>,
    parent_class_component: AncestorMemo<'a, Node<'a>>,
}

impl Rule for NoThisInSfc {
    const META: Meta = Meta::oxlint(Plugin::React, "no-this-in-sfc", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoThisInSfc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if is_jsx(file) {
            on.exprs([ExprTag::This], |_, this, cx| {
                let Node::Expr(member) = this.parent() else {
                    return;
                };
                if !matches!(member.tag(), ExprTag::Dot | ExprTag::Index)
                    || this.is_parenthesized()
                    || member.is_jsx_tag_name()
                    || member.is_in_type_query()
                {
                    return;
                }
                if let Some((component, false)) =
                    cx.state.parent_component.run(Node::Expr(this), false, get_parent_component)
                    && get_parent_class_component(component, &mut cx.state.parent_class_component).is_none()
                {
                    cx.report(this, NO_THIS_IN_SFC);
                }
            });
        }
        State::default()
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
