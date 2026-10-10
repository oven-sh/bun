use crate::util_ast::{Property, get_component_properties, get_property_name};
use crate::util_component_util::{
    is_es5_component, is_es6_component, is_pure_component, may_have_explicit_components,
};
use crate::util_components::Components;
use crate::util_components_list::{At, ComponentId, Queue};
use crate::util_jsx::Branches;
use crate::util_pragma::{self, get_create_class_from_context};
use crate::util_version::get_react_version_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::{estree_parent, estree_type_name};
use rustc_hash::FxHashSet;

/// Enforce stateless components to be written as a pure function
pub struct PreferStatelessFunction {
    ignore_pure_components: bool,
}

const COMPONENT_SHOULD_BE_PURE: Message =
    Message::new("componentShouldBePure", "Component should be written as a pure function");

/// upstream's `isValidPair`
fn is_valid_pair<'a>(ctor_param: Param<'a>, super_arg: Expr<'a>) -> bool {
    let super_arg = match super_arg.kind() {
        ExprKind::Spread(argument) if ctor_param.is_rest() => argument,
        _ if ctor_param.is_rest() => return false,
        _ => super_arg,
    };
    super_arg.as_ident().is_some_and(|name| ctor_param.pat().as_ident() == Some(name))
}

/// upstream's `isRedundantSuperCall`, for the function of a constructor. `false` for one without a body.
fn is_redundant_super_call(constructor: Func<'_>) -> bool {
    let body = constructor.body_statements().filter(|it| it.len() == 1).and_then(List::first);
    let Some(StmtKind::Expr(e)) = body.map(Stmt::kind) else {
        return false;
    };
    let Some(super_call) = e.as_call().filter(|it| it.callee().tag() == ExprTag::Super) else {
        return false;
    };
    let (ctor_params, super_args) = (constructor.params(), super_call.args());
    let is_simple = |it: Param| {
        it.default().is_none() && !it.is_parameter_property() && (it.is_rest() || it.pat().tag() == PatTag::Ident)
    };
    let is_spread_arguments = super_args.len() == 1
        && matches!(super_args.first().map(Expr::kind), Some(ExprKind::Spread(it)) if it.is_ident("arguments"));
    // No argument is the identifier `this`, which a parameter `this` is.
    let is_passing_through = || {
        constructor.this_param().is_none()
            && ctor_params.len() == super_args.len()
            && ctor_params.iter().zip(super_args).all(|(param, argument)| is_valid_pair(param, argument))
    };
    ctor_params.iter().all(is_simple) && (is_spread_arguments || is_passing_through())
}

/// upstream's `hasOtherProperties`
fn has_other_properties(node: Node<'_>) -> bool {
    get_component_properties(node).into_iter().any(|property| match (property.name(), property) {
        (Some(b"displayName" | b"propTypes" | b"contextTypes" | b"defaultProps" | b"render"), _) => false,
        (Some(b"props"), Property::Member(member)) if member.ty().is_some() => false,
        (_, Property::Member(member)) => {
            !(member.is_constructor() && member.func().is_some_and(is_redundant_super_call))
        }
        _ => true,
    })
}

/// Whether something can be in a call of `createClass`.
fn mentions_create_class<'a>(file: &'a File<'a>) -> bool {
    util_pragma::mentions_create_class(file, get_create_class_from_context(file))
}

fn is_props_or_context(name: Option<&[u8]>) -> bool {
    matches!(name, Some(b"props" | b"context"))
}

/// Whether the first `MethodDefinition` or `Property` that the block of a scope around `statement` is directly in is
/// called `render`.
fn is_in_render(statement: Stmt<'_>) -> bool {
    let block_node = Node::Stmt(statement).scope().chain().find_map(|scope| {
        let block = Some(scope.node()).filter(|it| matches!(it, Node::Func(_) | Node::Class(_)))?;
        let parent = estree_parent(block);
        // ESTree has a `Decorator` or an `AssignmentPattern` in between.
        let is_apart = match (parent, block.as_written().as_expr()) {
            (Node::Member(member), Some(e)) => member.decorators().any(|it| it == e),
            (Node::PatProp(property), e) => property.default() == e,
            _ => false,
        };
        (!is_apart && matches!(estree_type_name(parent), "MethodDefinition" | "Property")).then_some(parent)
    });
    block_node.and_then(get_property_name).is_some_and(|it| it == b"render")
}

impl PreferStatelessFunction {
    /// The nodes at which a listener of upstream marks a component as one that cannot be a function.
    fn marks<'a>(&self, file: &'a File<'a>, components: &Components<'a>) -> Queue<'a> {
        let mut queue = Queue::default();
        let mut mark = |node: Node<'a>| queue.push(At::enter(node), 0, node);

        // ClassDeclaration, ClassExpression
        for class in file.classes() {
            if (self.ignore_pure_components && is_pure_component(class, components.pragmas()))
                || class.decorators().next().is_some()
            {
                mark(Node::Class(class));
            }
        }

        // VariableDeclarator, MemberExpression: all of `this` but `props` and `context`
        for this in file.exprs_of_kind(ExprTag::This) {
            match this.parent() {
                parent @ Node::VarDecl(declarator) => {
                    if let PatKind::Object(properties) = declarator.pat().kind()
                        && properties.iter().any(|it| !is_props_or_context(get_property_name(Node::PatProp(it))))
                    {
                        mark(parent);
                    }
                }
                parent @ Node::Expr(member) if ast_utils::is_member_expression(member) => {
                    let value = || Some(member.index()?.as_string()?.bytes());
                    if member.object() == Some(this) && !is_props_or_context(get_property_name(parent).or_else(value)) {
                        mark(parent);
                    }
                }
                _ => {}
            }
        }

        // MemberExpression: `A.childContextTypes`
        if file.mentions_any(&["childContextTypes", "#childContextTypes"]) {
            for member in [ExprTag::Dot, ExprTag::Index].into_iter().flat_map(|tag| file.exprs_of_kind(tag)) {
                if get_property_name(Node::Expr(member)).is_some_and(|it| it == b"childContextTypes")
                    && !is_member_of_this(member)
                {
                    mark(Node::Expr(member));
                }
            }
        }

        // JSXAttribute
        if file.mentions("ref") {
            for e in file.exprs_of_kind(ExprTag::Jsx) {
                let ExprKind::Jsx(jsx) = e.kind() else { continue };
                for attribute in jsx.attrs().iter().filter(|it| it.key().is_some_and(|key| key.is("ref"))) {
                    mark(Node::Prop(attribute));
                }
            }
        }

        // ReturnStatement
        if file.mentions_any(&["render", "#render"]) {
            // Stateless components can return null since React 15
            let allow_null = get_react_version_from_context(file) >= (15, 0, 0);
            let branches = if allow_null { Branches::Any } else { Branches::All };
            for statement in file.stmts_of_kind(StmtTag::Return) {
                let StmtKind::Return(argument) = statement.kind() else { continue };
                let is_returning_null = argument.is_some_and(|it| matches!(it.tag(), ExprTag::Null | ExprTag::False));
                if !(allow_null && is_returning_null)
                    && !components.is_returning_jsx(Node::Stmt(statement), branches)
                    && is_in_render(statement)
                {
                    mark(Node::Stmt(statement));
                }
            }
        }
        queue
    }
}

fn is_member_of_this(member: Expr<'_>) -> bool {
    member.object().is_some_and(|it| it.tag() == ExprTag::This)
}

impl Rule for PreferStatelessFunction {
    const META: Meta = Meta::plugin(Plugin::React, "prefer-stateless-function", Kind::None).reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferStatelessFunction { ignore_pure_components: options.object(0).bool_or("ignorePureComponents", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        ((file.has_classes() || mentions_create_class(file) || may_have_explicit_components(file))
            && Components::may_have_any(file))
        .then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let mut components = Components::new(file);
        let pragmas = *components.pragmas();
        // Only such a class is reported, and what is in a call of `createClass`.
        let is_candidate = |it: Class| is_es6_component(it, &pragmas) && !has_other_properties(Node::Class(it));
        if !mentions_create_class(file) && !file.classes().any(is_candidate) && !may_have_explicit_components(file) {
            return;
        }

        let mut queue = self.marks(file, &components);
        let mut marked: FxHashSet<ComponentId> = FxHashSet::default();
        while let Some(event) = queue.pop_until(At::END) {
            components.advance(event.at);
            let node = match event.node {
                Node::Expr(member) if !is_member_of_this(member) => {
                    components.get_related_component(member).map(|id| components.component(id).node)
                }
                node => Some(node),
            };
            marked.extend(node.and_then(|it| components.set(it)));
        }

        components.finish();
        for id in components.list() {
            let node = components.component(id).node;
            if !marked.contains(&id)
                && !has_other_properties(node)
                && (is_es5_component(node, &pragmas) || components.is_es6_component(node))
            {
                cx.report(components.component(id).span(), COMPONENT_SHOULD_BE_PURE);
            }
        }
    }
}
