use bun_lint_oxlint::ast_util::{
    as_function, as_method_definition, as_object_property, as_property_definition, static_name,
};
use crate::react::{is_es5_component, is_es6_component, is_jsx};
use crate::util_ast::{Property, get_component_properties, get_property_name};
use crate::util_component_util;
use crate::util_components::Components;
use crate::util_components_list::{At, ComponentId, Queue};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_compat::{estree_parent, estree_span, estree_type_name};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

/// Enforce ES5 or ES6 class for returning value in render function
pub struct RequireRenderReturn;

const NO_RENDER_RETURN: Message = Message::new("noRenderReturn", "Your render method should have a return statement");
const REQUIRE_RENDER_RETURN: Message = Message::new("", "Your `render` method should have a `return` statement.");

impl Rule for RequireRenderReturn {
    const META: Meta = Meta::plugin(Plugin::React, "require-render-return", Kind::Problem).recommended();
    const ON: On = On::new().funcs().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireRenderReturn
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        // What is a component depends for upstream on what comes before.
        if file.language().is_oxlint { On::new().funcs() } else { On::new().finish() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let is_candidate = if file.language().is_oxlint {
            is_jsx(file) && file.mentions("render")
        } else {
            // upstream takes a private name for its text.
            file.mentions_any(&["render", "#render"]) && Components::may_have_any(file)
        };
        is_candidate.then_some(())
    }

    /// oxlint asks its control flow graph whether a `render` of what is a component by its name gets to a `return`.
    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if as_function(Node::Func(func)).is_none() {
            return;
        }
        // The method or the property that the function is the value of.
        let parent = match func.owner() {
            Node::Expr(e) if !e.is_parenthesized() => e.parent(),
            owner => owner,
        };
        let (key, is_in_component) = match parent {
            Node::Member(member)
                if as_method_definition(parent).or_else(|| as_property_definition(parent)).is_some() =>
            {
                (member.key(), is_es6_component(member.parent()))
            }
            Node::Prop(property) if as_object_property(parent).is_some() => {
                let is_in_es5_component =
                    matches!(property.parent(), Node::Expr(object)
                        if !object.is_parenthesized() && is_es5_component(object.parent()));
                (property.key(), is_in_es5_component)
            }
            _ => return,
        };
        if let Some(key) = key.filter(|key| static_name(*key).is_some_and(|name| name.is("render")))
            && is_in_component
            && !contains_return_statement(func)
        {
            cx.report(key.inner_span(cx.file()), REQUIRE_RENDER_RETURN);
        }
    }

    /// upstream's listeners for `ReturnStatement` and `ArrowFunctionExpression`, in the order of ESLint's walk, and
    /// then its `Program:exit`.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut queue = Queue::default();
        let mut is_in_render = AncestorMemo::default();
        for func in cx.file().funcs().filter(|it| ast_utils::is_function_with_body(*it)) {
            let node = Node::Func(func);
            if matches!(func.body(), FnBody::Expr(_)) {
                if is_value_of_render(func) {
                    queue.push(At::enter(node), 0, node);
                }
            } else if is_in_render.find_with(node, estree_parent, render_or_function) == Some(true) {
                for statement in func.returns().map(Node::Stmt) {
                    queue.push(At::enter(statement), 0, statement);
                }
            }
        }
        let mut components = Components::new(cx.file());
        let mut has_return_statement: FxHashSet<ComponentId> = FxHashSet::default();
        while let Some(event) = queue.pop_until(At::END) {
            components.advance(event.at);
            has_return_statement.extend(components.set(event.node));
        }
        components.finish();
        let pragmas = *components.pragmas();
        for id in components.list() {
            let node = components.component(id).node;
            if !has_return_statement.contains(&id)
                && let Some(render) = find_render_method(node)
                && (util_component_util::is_es5_component(node, &pragmas)
                    || matches!(node, Node::Class(class) if util_component_util::is_es6_component(class, &pragmas)))
            {
                cx.report(estree_span(render), NO_RENDER_RETURN).at_the_end();
            }
        }
    }
}

/// On the way up from a function: `true` at what is called `render`, `false` at the next function.
fn render_or_function(_: Node<'_>, ancestor: Node<'_>) -> Option<bool> {
    let is_a = |suffix: &str| estree_type_name(ancestor).ends_with(suffix);
    match ancestor {
        Node::Func(_) => (is_a("FunctionExpression") || is_a("FunctionDeclaration")).then_some(false),
        Node::Member(_) | Node::Prop(_) | Node::PatProp(_) => (is_called_render(ancestor)
            && (is_a("MethodDefinition") || is_a("Property") || is_a("PropertyDefinition")))
        .then_some(true),
        _ => None,
    }
}

fn is_called_render(node: Node<'_>) -> bool {
    get_property_name(node).is_some_and(|name| name == b"render")
}

/// `astUtil.getPropertyName(node.parent) === "render"`: also for the `a` of `a.render`.
fn is_value_of_render(arrow: Func<'_>) -> bool {
    let value = arrow.owner().as_expr();
    let parent = estree_parent(Node::Func(arrow));
    // ESTree has a node between it and a member that it decorates, or a property of a pattern that it is the default of.
    let is_child = match parent {
        Node::Member(member) => member.init() == value,
        Node::Prop(property) => property.value() == value,
        Node::PatProp(_) => false,
        _ => true,
    };
    is_child && is_called_render(parent)
}

/// upstream's `findRenderMethod`
fn find_render_method(node: Node<'_>) -> Option<Node<'_>> {
    let mut properties = get_component_properties(node).into_iter();
    properties.find(|it| it.func().is_some() && is_called_render(it.node())).map(Property::node)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Jump<'a> {
    Break(Option<Name<'a>>),
    Continue(Option<Name<'a>>),
}

/// Statements that are nested more deeply are not looked into.
const MAX_DEPTH: u32 = 256;

/// The way through a function that oxlint takes in its control flow graph: it does not go into a `catch` or a
/// `finally`, nor past a `try` with a `finally`, and it goes on after every `while` and `for`.
#[derive(Default)]
struct Walk<'a> {
    /// It got to a `return` with a value.
    found: bool,
    /// The `break` and `continue` that it got to and whose statement it is still in.
    jumps: SmallVec<[Jump<'a>; 4]>,
    depth: u32,
}

fn contains_return_statement(func: Func) -> bool {
    match func.body() {
        FnBody::Block(statements) => {
            let mut walk = Walk::default();
            walk.list(statements);
            walk.found
        }
        FnBody::Expr(_) => true,
        FnBody::None => false,
    }
}

impl<'a> Walk<'a> {
    /// Whether it gets to the end.
    fn list(&mut self, statements: List<'a, Stmt<'a>>) -> bool {
        statements.iter().all(|it| self.statement(it))
    }

    /// Takes the jumps after the first `from` for which `is_for_it` holds out, and tells whether there were any.
    fn take_jumps(&mut self, from: usize, is_for_it: impl Fn(Jump<'a>) -> bool) -> bool {
        let before = self.jumps.len();
        let others: SmallVec<[Jump<'a>; 4]> =
            self.jumps.drain(from.min(before)..).filter(|it| !is_for_it(*it)).collect();
        self.jumps.extend(others);
        self.jumps.len() < before
    }

    /// Whether it gets to the end of the statement.
    fn statement(&mut self, statement: Stmt<'a>) -> bool {
        if self.found {
            return false;
        }
        // It is taken to return something.
        if self.depth == MAX_DEPTH {
            self.found = true;
            return false;
        }
        self.depth += 1;
        let from = self.jumps.len();
        let is_of_loop = |jump: Jump| matches!(jump, Jump::Break(None) | Jump::Continue(None));
        let completes = match statement.kind() {
            StmtKind::Return(Some(_)) => {
                self.found = true;
                false
            }
            StmtKind::Return(None) | StmtKind::Throw(_) => false,
            StmtKind::Break(label) => {
                self.jumps.push(Jump::Break(label));
                false
            }
            StmtKind::Continue(label) => {
                self.jumps.push(Jump::Continue(label));
                false
            }
            StmtKind::Block(statements) => self.list(statements),
            StmtKind::With { body, .. } => self.statement(body),
            StmtKind::If { .. } => {
                // `else if` is not nested.
                let (mut at, mut completes) = (statement, false);
                loop {
                    let StmtKind::If { yes, no, .. } = at.kind() else {
                        break completes | self.statement(at);
                    };
                    completes |= self.statement(yes);
                    match no {
                        Some(no) => at = no,
                        None => break true,
                    }
                }
            }
            StmtKind::While { body, .. }
            | StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. } => {
                self.statement(body);
                self.take_jumps(from, is_of_loop);
                true
            }
            StmtKind::DoWhile { body, .. } => self.statement(body) | self.take_jumps(from, is_of_loop),
            StmtKind::Labeled { label, body } => {
                self.statement(body)
                    | self.take_jumps(
                        from,
                        |jump| matches!(jump, Jump::Break(Some(to)) | Jump::Continue(Some(to)) if to == label),
                    )
            }
            StmtKind::Switch { cases, .. } => {
                let (mut has_default, mut last_completes) = (false, true);
                for case in cases {
                    has_default |= case.is_default();
                    last_completes = self.list(case.body());
                }
                self.take_jumps(from, |jump| jump == Jump::Break(None)) | last_completes | !has_default
            }
            StmtKind::Try { block, finalizer, .. } => self.statement(block) & finalizer.is_none(),
            _ => true,
        };
        self.depth -= 1;
        completes
    }
}
