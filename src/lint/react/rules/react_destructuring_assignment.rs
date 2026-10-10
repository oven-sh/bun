use crate::util_ast::{get_property_name, is_assignment_lhs};
use crate::util_components::Components;
use crate::util_components_list::{At, Queue};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::source::mention_bit;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_span;
use rustc_hash::FxHashSet;

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

/// What can follow `this.`. The `name` of a `PrivateIdentifier` is without the `#`.
const THIS_MEMBERS: [u32; 6] = [
    mention_bit(b"props"),
    mention_bit(b"context"),
    mention_bit(b"state"),
    mention_bit(b"#props"),
    mention_bit(b"#context"),
    mention_bit(b"#state"),
];
/// Where upstream calls `getRelatedComponent`, which makes a component of any function.
const RELATED: [u32; 3] = [mention_bit(b"propTypes"), mention_bit(b"defaultProps"), mention_bit(b"getDefaultProps")];

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

/// What is said of a component with the parameters of `func`, if it is never to destructure.
fn message_about_params(func: Func<'_>) -> Option<Message> {
    let mut params = func.params_with_this().map(EvaluatedParam::of);
    match (params.next(), params.next()) {
        (Some(EvaluatedParam::Destructuring), _) => Some(NO_DESTRUCT_PROPS_IN_SFC_ARG),
        (_, Some(EvaluatedParam::Destructuring)) => Some(NO_DESTRUCT_CONTEXT_IN_SFC_ARG),
        _ => None,
    }
}

/// `node.property.name` of a `this.props`, a `this.context` or a `this.state` that is reached from above.
fn name_of_this_member(node: Expr<'_>) -> Option<&[u8]> {
    if node.object()?.tag() != ExprTag::This || node.is_chain_root() {
        return None;
    }
    get_property_name(Node::Expr(node)).filter(|it| matches!(*it, b"props" | b"context" | b"state"))
}

/// What a `VariableDeclarator` destructures.
#[derive(Copy, Clone)]
enum Destructured<'a> {
    /// let {foo} = props;
    Sfc(Name<'a>),
    /// let {foo} = this.props;
    Class(&'a [u8]),
}

impl<'a> Destructured<'a> {
    fn by(declarator: VarDecl<'a>) -> Option<Destructured<'a>> {
        let init = declarator.init().filter(|_| declarator.pat().tag() == PatTag::Object)?;
        match init.as_ident() {
            Some(name) => name.is_any(&["props", "context"]).then_some(Destructured::Sfc(name)),
            None => name_of_this_member(init).map(Destructured::Class),
        }
    }
}

/// What upstream's `sfcParams` answers while a function is the first in its queue.
#[derive(Copy, Clone, Default)]
struct SfcParams<'a> {
    props_name: Option<Name<'a>>,
    context_name: Option<Name<'a>>,
}

pub struct State<'a> {
    components: Components<'a>,
    /// What is reported if it is in a component.
    candidates: Vec<Node<'a>>,
    sfc_params: Vec<SfcParams<'a>>,
    /// What is in a `PropertyDefinition`.
    class_properties: AncestorMemo<'a, ()>,
}

impl<'a> State<'a> {
    /// Makes a candidate of each `x.a` where `sfcParams` can answer `x`. Whether there is one.
    fn add_sfc_usages(&mut self, file: &'a File<'a>) -> bool {
        let is_any_related = RELATED.iter().any(|&bit| file.mentions_bit(bit));
        let mut names_of_params = FxHashSet::default();
        for func in file.funcs().filter(|it| ast_utils::is_function_with_body(*it)) {
            let node = Node::Func(func);
            let names = func.params_with_this().take(2).filter_map(|it| EvaluatedParam::of(it).name());
            let mut names = names.peekable();
            if names.peek().is_some()
                && (is_any_related || self.components.get_stateless_component(node) == Some(node))
            {
                names_of_params.extend(names);
            }
        }
        if names_of_params.is_empty() {
            return false;
        }
        let others = self.candidates.len();
        let members = [ExprTag::Dot, ExprTag::Index].map(|tag| file.exprs_of_kind(tag));
        for e in members.into_iter().flatten() {
            if e.object().and_then(Expr::as_ident).is_some_and(|it| names_of_params.contains(&it)) {
                self.candidates.push(Node::Expr(e));
            }
        }
        self.candidates.len() > others
    }

    /// upstream's `isInClassProperty`
    fn is_in_class_property(&mut self, node: Expr<'a>) -> bool {
        let found = self.class_properties.find(Node::Expr(node), |_, parent| {
            matches!(parent, Node::Member(member) if ast_utils::is_property_definition(member)).then_some(())
        });
        found.is_some()
    }
}

impl Rule for DestructuringAssignment {
    const META: Meta = Meta::plugin(Plugin::React, "destructuring-assignment", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::This]).funcs().var_decls().finish();
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

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if self.configuration == Configuration::Never {
            return On::new().funcs().var_decls().finish();
        }
        let mut on = On::new().finish();
        if THIS_MEMBERS.iter().any(|&bit| file.mentions_bit(bit)) {
            on = on.exprs(&[ExprTag::This]);
        }
        if self.destructure_in_signature { on.var_decls() } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        Components::may_have_any(file).then(|| State {
            components: Components::new(file),
            candidates: Vec::new(),
            sfc_params: Vec::new(),
            class_properties: AncestorMemo::default(),
        })
    }

    /// `this.props.a`
    fn expr<'a>(&self, this: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Expr(object) = this.parent()
            && let Node::Expr(node) = object.parent()
            && node.object() == Some(object)
            && name_of_this_member(object).is_some()
        {
            cx.state.candidates.push(Node::Expr(node));
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if ast_utils::is_function_with_body(func) && message_about_params(func).is_some() {
            cx.state.candidates.push(Node::Func(func));
        }
    }

    fn var_decl<'a>(&self, declarator: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let is_candidate = match Destructured::by(declarator) {
            Some(Destructured::Sfc(name)) => self.configuration == Configuration::Never || name.is("props"),
            Some(Destructured::Class(_)) => self.configuration == Configuration::Never,
            None => false,
        };
        if is_candidate {
            cx.state.candidates.push(Node::VarDecl(declarator));
        }
    }

    /// The candidates in the order of ESLint's walk, each when the list of components is what it is then.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let has_sfc_usages = self.configuration == Configuration::Always && cx.state.add_sfc_usages(file);
        if cx.state.candidates.is_empty() {
            return;
        }
        let mut queue = Queue::default();
        for node in std::mem::take(&mut cx.state.candidates) {
            queue.push(At::enter(node), 0, node);
        }
        // For `sfcParams`.
        if has_sfc_usages {
            let functions = file.funcs().filter(|it| ast_utils::is_function_with_body(*it));
            for node in functions.map(Node::Func) {
                queue.push(At::enter(node), 0, node);
                queue.push(At::exit(node), 0, node);
            }
        }
        while let Some(event) = queue.pop_until(At::END) {
            cx.state.components.advance(event.at);
            match event.node {
                Node::Func(func) => self.handle_stateless_component(func, event.at, cx),
                Node::Expr(e) => self.handle_usage(e, cx),
                Node::VarDecl(declarator) => self.handle_variable_declarator(declarator, cx),
                _ => {}
            }
        }
    }
}

impl DestructuringAssignment {
    /// upstream's `handleStatelessComponent` and `handleStatelessComponentExit`
    fn handle_stateless_component<'a>(&self, func: Func<'a>, at: At, cx: &mut Cx<'a, Self>) {
        if cx.state.components.get(Node::Func(func)).is_none() {
            return;
        }
        if self.configuration == Configuration::Never {
            if let Some(message) = message_about_params(func) {
                cx.report(func.estree_span(), message);
            }
            return;
        }
        if at.is_exit() {
            cx.state.sfc_params.pop();
            return;
        }
        // The first in the queue that has a name is asked.
        let around = cx.state.sfc_params.last().copied().unwrap_or_default();
        let mut names = func.params_with_this().map(|it| EvaluatedParam::of(it).name());
        cx.state.sfc_params.push(SfcParams {
            props_name: names.next().flatten().or(around.props_name),
            context_name: names.next().flatten().or(around.context_name),
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
        if ast_utils::is_member_expression(node)
            && !is_assignment_lhs(node)
            && !(self.ignore_class_fields && cx.state.is_in_class_property(node))
            && cx.state.components.get_parent_component(Node::Expr(node)).is_some()
        {
            cx.report(node, USE_DESTRUCT_ASSIGNMENT).data("type", name);
        }
    }

    fn handle_variable_declarator<'a>(&self, declarator: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let node = Node::VarDecl(declarator);
        let name = match Destructured::by(declarator) {
            Some(Destructured::Sfc(name)) => name,
            Some(Destructured::Class(name)) => {
                if cx.state.components.get_parent_component(node).is_some() {
                    cx.report(declarator, NO_DESTRUCT_ASSIGNMENT).data("type", name);
                }
                return;
            }
            None => return,
        };
        let scope = node.scope();
        let Some(sfc_component) = cx.state.components.get(scope.node()) else {
            return;
        };
        if self.configuration == Configuration::Never {
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
    let Some(sfc_params) = cx.state.sfc_params.last() else {
        return;
    };
    let (is_props, is_context) = (sfc_params.props_name == Some(name), sfc_params.context_name == Some(name));
    let is_type_query = node.is_in_type_query();
    let is_prop_used = match is_type_query {
        true => is_props,
        false => {
            (is_props || is_context) && !node.is_optional() && !node.is_jsx_tag_name() && !is_assignment_lhs(node)
        }
    };
    if is_prop_used && cx.state.components.get_parent_stateless_component(Node::Expr(node)).is_some() {
        let name = if is_type_query { &b"props"[..] } else { name.bytes() };
        cx.report(node, USE_DESTRUCT_ASSIGNMENT).data("type", name);
    }
}
