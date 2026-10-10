use crate::util_ast::{get_property_name, is_assignment_lhs};
use crate::util_components::Components;
use crate::util_components_list::At;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_span;

/// Enforce consistent usage of destructuring assignment of props, state, and context.
pub struct DestructuringAssignment {
    configuration: Configuration,
    ignore_class_fields: bool,
    destructure_in_signature: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Configuration {
    Always,
    Never,
}

const NO_DESTRUCT_PROPS_IN_SFC_ARG: Message =
    Message::new("noDestructPropsInSFCArg", "Must never use destructuring props assignment in SFC argument");
const NO_DESTRUCT_CONTEXT_IN_SFC_ARG: Message =
    Message::new("noDestructContextInSFCArg", "Must never use destructuring context assignment in SFC argument");
const NO_DESTRUCT_ASSIGNMENT: Message =
    Message::new("noDestructAssignment", "Must never use destructuring {{type}} assignment");
const USE_DESTRUCT_ASSIGNMENT: Message =
    Message::new("useDestructAssignment", "Must use destructuring {{type}} assignment");
const DESTRUCTURE_IN_SIGNATURE: Message =
    Message::new("destructureInSignature", "Must destructure props in the function signature.");

const MEMBER_EXPRESSIONS: NodeTags = NodeTags::new().exprs(&[ExprTag::Dot, ExprTag::Index]);

/// An element of what upstream's `evalParams` returns.
#[derive(Copy, Clone)]
enum EvaluatedParam<'a> {
    Destructuring,
    Name(Name<'a>),
    Other,
}

impl<'a> EvaluatedParam<'a> {
    fn of(param: Param<'a>) -> EvaluatedParam<'a> {
        // An `AssignmentPattern`, a `RestElement`, a `TSParameterProperty`.
        if param.default().is_some() || param.is_rest() || param.is_parameter_property() {
            return EvaluatedParam::Other;
        }
        match param.pat().kind() {
            PatKind::Object(_) => EvaluatedParam::Destructuring,
            PatKind::Ident(name) => EvaluatedParam::Name(name),
            _ => EvaluatedParam::Other,
        }
    }

    fn name(self) -> Option<Name<'a>> {
        match self {
            EvaluatedParam::Name(name) => Some(name),
            _ => None,
        }
    }
}

/// What upstream's `sfcParams` answers while a function is the first in its queue.
#[derive(Copy, Clone)]
struct SfcParams<'a> {
    /// Where ESLint enters the function: after the key of a method.
    start: u32,
    props_name: Option<Name<'a>>,
    context_name: Option<Name<'a>>,
}

pub struct State<'a> {
    components: Components<'a>,
    sfc_params: Vec<SfcParams<'a>>,
    /// What is in a `PropertyDefinition`.
    class_properties: AncestorMemo<'a, ()>,
}

impl<'a> State<'a> {
    /// `sfcParams` when ESLint enters a node that starts at `start`.
    fn sfc_params_at(&self, start: u32) -> Option<SfcParams<'a>> {
        self.sfc_params.iter().rev().find(|it| it.start <= start).copied()
    }

    /// upstream's `isInClassProperty`
    fn is_in_class_property(&mut self, node: Expr<'a>) -> bool {
        let found = self.class_properties.find(Node::Expr(node), |_, parent| {
            matches!(parent, Node::Member(member) if ast_utils::is_property_definition(member)).then_some(())
        });
        found.is_some()
    }
}

/// `node.property.name` of a `this.props`, a `this.context` or a `this.state` that is reached from above.
fn name_of_this_member(node: Expr<'_>) -> Option<&[u8]> {
    if node.is_chain_root() || node.object()?.tag() != ExprTag::This {
        return None;
    }
    get_property_name(Node::Expr(node)).filter(|it| matches!(*it, b"props" | b"context" | b"state"))
}

impl Rule for DestructuringAssignment {
    const META: Meta = Meta::plugin(Plugin::React, "destructuring-assignment", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On =
        On::new().enter(NodeTags::FUNC.union(NodeTags::VAR_DECL).union(MEMBER_EXPRESSIONS)).exit(NodeTags::FUNC);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let configuration = match options.str(0) {
            Some("never") => Configuration::Never,
            _ => Configuration::Always,
        };
        let options = options.object(1);
        DestructuringAssignment {
            configuration,
            ignore_class_fields: options.bool_or("ignoreClassFields", false),
            destructure_in_signature: options.str("destructureInSignature") == Some("always"),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        if self.configuration == Configuration::Never {
            return On::new().enter(NodeTags::FUNC.union(NodeTags::VAR_DECL));
        }
        let on = On::new().enter(NodeTags::FUNC.union(MEMBER_EXPRESSIONS)).exit(NodeTags::FUNC);
        if self.destructure_in_signature { on.enter(NodeTags::VAR_DECL) } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        Components::may_have_any(file).then(|| State {
            components: Components::new(file),
            sfc_params: Vec::new(),
            class_properties: AncestorMemo::default(),
        })
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        match node {
            Node::Func(func) if ast_utils::is_function_with_body(func) => self.handle_stateless_component(func, cx),
            Node::Expr(e) => self.handle_usage(e, cx),
            Node::VarDecl(declarator) => self.handle_variable_declarator(declarator, cx),
            _ => {}
        }
    }

    /// upstream's `handleStatelessComponentExit`
    fn exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(node, Node::Func(func) if ast_utils::is_function_with_body(func)) {
            return;
        }
        cx.state.components.advance(At::exit(node));
        if cx.state.components.get(node).is_some() {
            cx.state.sfc_params.pop();
        }
    }
}

impl DestructuringAssignment {
    fn handle_stateless_component<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        let node = Node::Func(func);
        let mut params = func.params_with_this().map(EvaluatedParam::of);
        let (props, context) = (params.next(), params.next());
        if self.configuration == Configuration::Never {
            let message = match (props, context) {
                (Some(EvaluatedParam::Destructuring), _) => NO_DESTRUCT_PROPS_IN_SFC_ARG,
                (_, Some(EvaluatedParam::Destructuring)) => NO_DESTRUCT_CONTEXT_IN_SFC_ARG,
                _ => return,
            };
            cx.state.components.advance(At::enter(node));
            if cx.state.components.get(node).is_some() {
                cx.report(func.estree_span(), message);
            }
            return;
        }
        cx.state.components.advance(At::enter(node));
        if cx.state.components.get(node).is_none() {
            return;
        }
        // The first in the queue that has a name is asked.
        let (props_around, context_around) = match cx.state.sfc_params.last() {
            Some(around) => (around.props_name, around.context_name),
            None => (None, None),
        };
        cx.state.sfc_params.push(SfcParams {
            start: func.estree_span().start,
            props_name: props.and_then(EvaluatedParam::name).or(props_around),
            context_name: context.and_then(EvaluatedParam::name).or(context_around),
        });
    }

    /// upstream's listeners for `MemberExpression` and `TSQualifiedName`
    fn handle_usage<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(object) = node.object() else {
            return;
        };
        match object.as_ident() {
            Some(name) => handle_sfc_usage(node, name, cx),
            None => self.handle_class_usage(node, object, cx),
        }
    }

    /// `this.props.aProp`, `this.context.aProp`, `this.state.aState`
    fn handle_class_usage<'a>(&self, node: Expr<'a>, object: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = name_of_this_member(object) else {
            return;
        };
        if !ast_utils::is_member_expression(node)
            || is_assignment_lhs(node)
            || (self.ignore_class_fields && cx.state.is_in_class_property(node))
        {
            return;
        }
        cx.state.components.advance(At::enter(Node::Expr(node)));
        if cx.state.components.get_parent_component(Node::Expr(node)).is_some() {
            cx.report(node, USE_DESTRUCT_ASSIGNMENT).data("type", name);
        }
    }

    fn handle_variable_declarator<'a>(&self, declarator: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let Some(init) = declarator.init().filter(|_| declarator.pat().tag() == PatTag::Object) else {
            return;
        };
        let node = Node::VarDecl(declarator);
        let is_never = self.configuration == Configuration::Never;
        // let {foo} = this.props;
        let Some(name) = init.as_ident() else {
            let Some(name) = name_of_this_member(init).filter(|_| is_never) else {
                return;
            };
            cx.state.components.advance(At::enter(node));
            if cx.state.components.get_parent_component(node).is_some() {
                cx.report(declarator, NO_DESTRUCT_ASSIGNMENT).data("type", name);
            }
            return;
        };
        // let {foo} = props;
        if !(name.is("props") || (is_never && name.is("context"))) {
            return;
        }
        let scope = node.scope();
        cx.state.components.advance(At::enter(node));
        let Some(sfc_component) = cx.state.components.get(scope.node()) else {
            return;
        };
        if is_never {
            cx.report(declarator, NO_DESTRUCT_ASSIGNMENT).data("type", name);
            return;
        }
        // Skip if props is used elsewhere
        if scope.get("props").is_none_or(|props| props.references().len() > 1) {
            return;
        }
        let sfc_component = cx.state.components.component(sfc_component).node;
        cx.report(declarator, DESTRUCTURE_IN_SIGNATURE).fix(|fixer| {
            let param = sfc_component.as_func()?.params_with_this().next()?;
            let whole = estree_span(Node::Param(param));
            // That of a parameter with a default belongs to the left of the `AssignmentPattern`.
            let has_annotation = param.default().is_none() && !param.is_parameter_property();
            let annotation = param.ty().filter(|_| has_annotation);
            let name_end = annotation.map_or(whole.end, |it| it.annotation_span().start);
            let id = fixer.file().slice(declarator.binding_span());
            Some([fixer.replace(Span::new(whole.start, name_end), id), fixer.remove(estree_span(declarator.parent()))])
        });
    }
}

/// `props.aProp`, `context.aProp`, and the `props.a` of `typeof props.a.b`
fn handle_sfc_usage<'a>(node: Expr<'a>, name: Name<'a>, cx: &mut Cx<'a, DestructuringAssignment>) {
    let Some(sfc_params) = cx.state.sfc_params_at(node.span().start) else {
        return;
    };
    let (is_props, is_context) = (sfc_params.props_name == Some(name), sfc_params.context_name == Some(name));
    if !is_props && !is_context {
        return;
    }
    let is_type_query = node.is_in_type_query();
    let is_prop_used = match is_type_query {
        true => is_props,
        false => !node.is_optional() && !node.is_jsx_tag_name() && !is_assignment_lhs(node),
    };
    if !is_prop_used {
        return;
    }
    cx.state.components.advance(At::enter(Node::Expr(node)));
    if cx.state.components.get_parent_stateless_component(Node::Expr(node)).is_some() {
        let name = if is_type_query { &b"props"[..] } else { name.bytes() };
        cx.report(node, USE_DESTRUCT_ASSIGNMENT).data("type", name);
    }
}
