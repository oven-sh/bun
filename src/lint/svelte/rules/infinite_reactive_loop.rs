use crate::conditions::should_run;
use crate::reactive::{WITHOUT_RUNES, body_of, reactive_statements};
use crate::variables::find_variable;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::ast::svelte::variables::{DefNode, DefinitionKind, Origin};
use bun_lint::semantic::DeclarationKind;
use bun_lint::utils::eslint_utils::{ReferenceKind, ReferenceTracker, TraceMap};

/// Svelte runtime prevents calling the same reactive statement twice in a microtask. But between different microtask, it doesn't prevent.
pub struct InfiniteReactiveLoop;

const UNEXPECTED: Message = Message::new("unexpected", "Possibly it may occur an infinite reactive loop.");
const UNEXPECTED_CALL: Message = Message::new(
    "unexpectedCall",
    "Possibly it may occur an infinite reactive loop because this function may update `{{variableName}}`.",
);

const TICK: TraceMap<'static, ()> = TraceMap::new(&[(
    "svelte",
    TraceMap {
        esm: true,
        ..TraceMap::new(&[("tick", TraceMap::EMPTY.call(()))])
    },
)]);
const TASKS: TraceMap<'static, ()> = TraceMap::new(&[
    ("setTimeout", TraceMap::EMPTY.call(())),
    ("setInterval", TraceMap::EMPTY.call(())),
    ("queueMicrotask", TraceMap::EMPTY.call(())),
]);

/// `isFunctionCall`: true if `e` is an identifier inside a call whose callee is an identifier with the same name,
/// whether or not `e` is the callee.
fn is_function_call(e: Expr<'_>) -> bool {
    let Some(name) = e.as_ident() else {
        return false;
    };
    matches!(e.parent(), Node::Expr(parent) if parent.as_call().is_some_and(|it| it.callee().as_ident() == Some(name)))
}

/// `isNodeForAssign`: true if the parent of `e`, the identifier `x`, is `x = ..`, or a member of `x` that `x.. = ..`
/// assigns to.
fn is_node_for_assign<'a>(e: Expr<'a>, name: Name<'a>) -> bool {
    let Node::Expr(parent) = e.parent() else {
        return false;
    };
    if let Some((_, target, _)) = parent.as_assign() {
        return target.as_ident() == Some(name);
    }
    if !matches!(parent.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. }) {
        return false;
    }
    let Node::Expr(assignment) = parent.parent() else {
        return false;
    };
    assignment.as_assign().is_some_and(|(_, target, _)| {
        matches!(target.kind(), ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj.as_ident() == Some(name))
    })
}

/// `isPromiseThenOrCatchBody`: an arrow function passed to `.then(..)` or `.catch(..)`.
fn is_then_or_catch_body(node: Node<'_>) -> bool {
    let Node::Expr(e) = node else {
        return false;
    };
    if !e.as_fn().is_some_and(|it| it.kind() == FnKind::Arrow) {
        return false;
    }
    let Node::Expr(call) = e.parent() else {
        return false;
    };
    let Some(callee) = call.as_call().map(|it| it.callee()) else {
        return false;
    };
    let property = match callee.kind() {
        ExprKind::Dot { name, .. } => Some(name.name()),
        ExprKind::Index { index, .. } => index.as_ident(),
        _ => None,
    };
    property.is_some_and(|it| it.is_any(&["then", "catch"]))
}

/// `isInsideOfFunction`: true if `node` is in an `async` function declaration, or in an `async` function that a
/// declarator initializes.
fn is_inside_of_async_function(node: Node<'_>) -> bool {
    node.ancestors().any(|it| match it {
        Node::Func(func) => func.kind() == FnKind::Decl && func.is_async(),
        Node::VarDecl(declarator) => declarator
            .init()
            .and_then(Expr::as_fn)
            .is_some_and(|it| matches!(it.kind(), FnKind::Expr | FnKind::Arrow) && it.is_async()),
        _ => false,
    })
}

/// `getFunctionDeclarationNode`: the function `e` names, a declaration or a declarator's initializer.
fn function_of(e: Expr<'_>) -> Option<Func<'_>> {
    find_variable(e)?.definitions().find_map(|definition| match (definition.kind(), definition.node()?) {
        (DefinitionKind::Declared(DeclarationKind::FunctionName), DefNode::Program(Node::Func(func))) => {
            (func.kind() == FnKind::Decl && func.has_body()).then_some(func)
        }
        (DefinitionKind::Declared(DeclarationKind::Variable), DefNode::Program(Node::VarDecl(declarator))) => {
            declarator.init()?.as_fn().filter(|it| matches!(it.kind(), FnKind::Expr | FnKind::Arrow))
        }
        _ => None,
    })
}

/// What `doLint` keeps for one `$:` statement.
struct Lint<'a, 'r> {
    /// The positions of the identifiers that reference a top-level variable and aren't function calls, sorted.
    references: &'r [u32],
    /// The names of the ones in the `$:` statement.
    names: Vec<Name<'a>>,
    /// The calls to `tick`, `setTimeout`, `setInterval` and `queueMicrotask`.
    tasks: &'r [Span],
    processed: Vec<Func<'a>>,
    /// What's reported: an assignment, or a call to the function that contains one, and the name.
    found: Vec<(Span, Option<Name<'a>>)>,
}

/// `verifyInternal` state for one body: whether it's still in the same microtask, and the nodes after which it's back
/// in the same microtask.
struct Walk<'a> {
    is_same_microtask: bool,
    different: Vec<Node<'a>>,
    calls: Vec<Expr<'a>>,
    is_in_reactive_statement: bool,
}

impl<'a> Lint<'a, '_> {
    /// `verifyInternal`
    fn verify(&mut self, roots: &[Node<'a>], calls: Vec<Expr<'a>>, is_same_microtask: bool, is_in_reactive_statement: bool) {
        let mut walk = Walk {
            is_same_microtask,
            different: Vec::new(),
            calls,
            is_in_reactive_statement,
        };
        for &root in roots {
            self.visit(root, &mut walk, bun_core::StackCheck::init());
        }
    }

    fn visit(&mut self, node: Node<'a>, walk: &mut Walk<'a>, stack: bun_core::StackCheck) {
        if !stack.is_safe_to_recurse() {
            return;
        }
        self.enter(node, walk);
        for child in node.children() {
            self.visit(child, walk, stack);
        }
        // `leaveNode`
        if let Node::Expr(e) = node
            && matches!(e.kind(), ExprKind::Await(_))
            && (!walk.is_in_reactive_statement || !is_inside_of_async_function(node))
        {
            walk.is_same_microtask = false;
        }
        if walk.different.contains(&node) {
            walk.is_same_microtask = true;
        }
    }

    /// `enterNode`
    fn enter(&mut self, node: Node<'a>, walk: &mut Walk<'a>) {
        let mut is_different = is_then_or_catch_body(node);
        let span = node.span();
        is_different |= self.tasks.iter().any(|it| it.contains(span) && *it != span);
        // The left side of `x = await ..`.
        is_different |= matches!((node, node.parent()), (Node::Expr(e), Node::Expr(parent))
            if parent.as_assign().is_some_and(|(_, target, value)| target == e && matches!(value.kind(), ExprKind::Await(_))));
        if is_different {
            walk.different.push(node);
            walk.is_same_microtask = false;
        }
        let (start, name) = match node {
            Node::Expr(e) => match e.as_ident() {
                Some(name) => (e.span().start, name),
                None => return,
            },
            Node::Pat(pat) => match pat.as_ident() {
                Some(name) => (pat.span().start, name),
                None => return,
            },
            _ => return,
        };
        if let Node::Expr(e) = node
            && is_function_call(e)
            && let Some(func) = function_of(e)
            && !self.processed.contains(&func)
        {
            self.processed.push(func);
            let mut calls = walk.calls.clone();
            calls.push(e);
            let body: Vec<Node<'a>> = match func.body() {
                FnBody::Block(statements) => statements.iter().map(Node::Stmt).collect(),
                FnBody::Expr(e) => vec![Node::Expr(e)],
                FnBody::None => Vec::new(),
            };
            self.verify(&body, calls, walk.is_same_microtask, false);
        }
        if walk.is_same_microtask || self.references.binary_search(&start).is_err() || !self.names.contains(&name) {
            return;
        }
        let Node::Expr(e) = node else {
            return;
        };
        if is_node_for_assign(e, name) {
            self.found.push((e.span(), None));
            self.found.extend(walk.calls.iter().map(|it| (it.span(), Some(name))));
        }
    }
}

impl Rule for InfiniteReactiveLoop {
    const META: Meta = Meta::plugin(Plugin::Svelte, "infinite-reactive-loop", Kind::Suggestion).recommended();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        InfiniteReactiveLoop
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.svelte().is_some() && should_run(file, WITHOUT_RUNES)).then_some(())
    }

    /// Upstream's `SvelteReactiveStatement` listener.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut reactive = reactive_statements(file).peekable();
        if reactive.peek().is_none() {
            return;
        }
        let tracker = ReferenceTracker::new(file);
        let tasks: Vec<Span> = (tracker.iterate_esm_references(&TICK).iter())
            .chain(tracker.iterate_global_references(&TASKS).iter())
            .filter(|it| it.kind == ReferenceKind::Call)
            .map(|it| it.node.span())
            .collect();
        // `getReactiveVariableReferences`
        let mut references: Vec<(u32, Name<'a>)> = Vec::new();
        for variable in file.svelte_variables_of(file.top_level_scope()) {
            for reference in variable.references() {
                // What svelte-eslint-parser adds for a prop is a copy of the identifier, which isn't a tree node.
                if reference.origin() == Origin::Prop || reference.expr().is_some_and(is_function_call) {
                    continue;
                }
                references.push((reference.span().start, reference.name()));
            }
        }
        bun_lint::utils::sort::sort_by_key(&mut references, |it| it.0);
        let starts: Vec<u32> = references.iter().map(|it| it.0).collect();
        for statement in reactive {
            let range = statement.span();
            let names = (references.iter())
                .filter(|it| range.contains_offset(it.0))
                .map(|it| it.1)
                .collect();
            let mut lint = Lint {
                references: &starts,
                names,
                tasks: &tasks,
                processed: Vec::new(),
                found: Vec::new(),
            };
            let Some(body) = body_of(statement) else {
                continue;
            };
            lint.verify(&[Node::Stmt(body)], Vec::new(), true, true);
            for (at, name) in lint.found {
                match name {
                    None => cx.report(at, UNEXPECTED),
                    Some(name) => cx.report(at, UNEXPECTED_CALL).data("variableName", name.bytes()),
                }
                .listened_by(statement, false);
            }
        }
    }
}
