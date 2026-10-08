use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Disallow unmodified loop conditions.
pub struct NoUnmodifiedLoopCondition {
    check_conditional_expressions: bool,
}

const LOOP_CONDITION_NOT_MODIFIED: Message = Message::new(
    "loopConditionNotModified",
    "'{{name}}' is not modified in this loop.",
);

/// ESLint's `SENTINEL_PATTERN`, of a `node.type`.
fn is_sentinel(node_type: &str) -> bool {
    const SUFFIXES: [&str; 8] = [
        "CallExpression",
        "ClassExpression",
        "FunctionExpression",
        "MemberExpression",
        "NewExpression",
        "YieldExpression",
        "Statement",
        "Declaration",
    ];
    SUFFIXES.iter().any(|suffix| node_type.ends_with(suffix))
}

/// ESLint's `LoopConditionInfo`.
struct Condition<'a> {
    reference: Reference<'a>,
    /// The outermost `BinaryExpression` or `ConditionalExpression` that the reference is in.
    group: Option<Expr<'a>>,
    /// The loop.
    inside: Span,
    /// The `init` of a `for`.
    outside: Option<Span>,
    is_modified: bool,
}

/// Where a variable is modified.
#[derive(Default)]
struct Modifiers {
    /// The references that write to it, in the order of the source.
    writes: Vec<Span>,
    /// The references to the function declarations that one of these is in, in the order of the
    /// source.
    calls: Vec<Span>,
}

impl Modifiers {
    /// `declarations`: the function declaration around a node.
    fn new<'a>(
        references: impl Iterator<Item = Reference<'a>>,
        declarations: &mut AncestorMemo<'a, Func<'a>>,
    ) -> Modifiers {
        let mut modifiers = Modifiers::default();
        let mut functions: FxHashSet<Symbol<'a>> = FxHashSet::default();
        for modifier in references.filter(|it| is_write_reference(*it)) {
            modifiers.writes.push(modifier.span());
            let declaration = declarations.find(modifier.node(), |_, it| {
                it.as_func().filter(|it| it.kind() == FnKind::Decl && it.has_body())
            });
            if let Some(name) = declaration.and_then(Func::name)
                && let Some(variable) = modifier.scope().parent().and_then(|it| it.resolve_name(name.name()))
                && functions.insert(variable)
            {
                modifiers.calls.extend(variable.references().map(Reference::span));
            }
        }
        modifiers.writes.sort_unstable_by_key(|it| it.start);
        modifiers.calls.sort_unstable_by_key(|it| it.start);
        modifiers
    }
}

impl Condition<'_> {
    /// ESLint's `isInLoop`, for any of `references`, which are in the order of the source.
    fn is_any_in_loop(&self, references: &[Span]) -> bool {
        let within = |span: Span| {
            references.partition_point(|it| it.start < span.start)..references.partition_point(|it| it.end <= span.end)
        };
        let (inside, outside) = (within(self.inside), self.outside.map_or(0..0, within));
        inside.start < inside.end && (inside.start < outside.start || outside.end < inside.end)
    }

    /// ESLint's `hasModifierInLoop`, for any of the modifiers: it is in the loop, or in a function
    /// declaration that is referred to in the loop.
    fn has_modifier_in_loop(&self, modifiers: &Modifiers) -> bool {
        self.is_any_in_loop(&modifiers.writes) || self.is_any_in_loop(&modifiers.calls)
    }
}

/// What is above a node that is in no call, function or statement yet.
#[derive(Copy, Clone)]
struct Above<'a> {
    /// The loop whose test it is in.
    statement: Option<Stmt<'a>>,
    /// The outermost `BinaryExpression` or `ConditionalExpression` that it is, or is in.
    group: Option<Expr<'a>>,
}

#[derive(Default)]
pub struct State<'a> {
    /// The tests of the loops.
    tests: Vec<Span>,
    /// For the nodes that are far below the test, as in `a + a + ..`.
    above: FxHashMap<Node<'a>, Above<'a>>,
    /// `has_dynamic_expressions`
    is_dynamic: FxHashMap<Expr<'a>, bool>,
}

/// ESLint's `isWriteReference`. Of the initializers only those of `var` count: they are evaluated
/// again in each iteration of a loop around them.
fn is_write_reference(reference: Reference) -> bool {
    if reference.is_init() {
        let first = reference.symbol().and_then(|it| it.declarations().next());
        let is_var = first.is_some_and(|it| {
            matches!(it, Declaration::Var(_))
                && !it.is_catch_parameter()
                && matches!(it.node(), Some(Node::VarDecl(declaration)) if declaration.var_kind() == VarKind::Var)
        });
        if !is_var {
            return false;
        }
    }
    reference.is_write()
}

/// ESLint's `hasDynamicExpressions`.
fn has_dynamic_expressions(root: Expr) -> bool {
    let mut stack = vec![Node::Expr(root)];
    while let Some(node) = stack.pop() {
        match utils::estree_type_name(node) {
            "CallExpression" | "MemberExpression" | "NewExpression" | "TaggedTemplateExpression"
            | "YieldExpression" => return true,
            "ArrowFunctionExpression" | "ClassExpression" | "FunctionExpression" => {}
            _ => node.for_each_child(|child| stack.push(child)),
        }
    }
    false
}

impl NoUnmodifiedLoopCondition {
    /// Walks up from `node`, whose child on the way is `child`. All the walks together take time in
    /// proportion to the number of nodes.
    fn look_above<'a>(&self, mut child: Node<'a>, mut node: Node<'a>, state: &mut State<'a>) -> Above<'a> {
        const NEAR: usize = 32;
        let mut passed: SmallVec<[Node<'a>; NEAR]> = SmallVec::new();
        // With how many nodes have been passed up to it.
        let mut group = None;
        let above = loop {
            if passed.len() >= NEAR
                && let Some(&known) = state.above.get(&node)
            {
                break known;
            }
            let node_type = utils::estree_type_name(node);
            if is_sentinel(node_type) || matches!(node, Node::File(_)) {
                let statement = node.as_stmt().filter(|it| {
                    let test = match it.kind() {
                        StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => Some(test),
                        StmtKind::For { test, .. } => test,
                        _ => None,
                    };
                    is_sentinel(node_type) && test.is_some_and(|test| Node::Expr(test) == child)
                });
                break Above { statement, group: None };
            }
            passed.push(node);
            if (node_type == "BinaryExpression"
                || !self.check_conditional_expressions && node_type == "ConditionalExpression")
                && let Some(expression) = node.as_expr()
            {
                group = Some((expression, passed.len()));
            }
            child = node;
            node = utils::estree_parent(node);
        };
        let group_from = |count: usize| {
            above.group.or_else(|| group.filter(|it| count < it.1).map(|it| it.0))
        };
        for (count, &node) in passed.iter().enumerate().skip(NEAR) {
            let known = Above { statement: above.statement, group: group_from(count) };
            state.above.insert(node, known);
        }
        Above { statement: above.statement, group: group_from(0) }
    }

    /// ESLint's `toLoopCondition`.
    fn to_loop_condition<'a>(&self, reference: Reference<'a>, state: &mut State<'a>) -> Option<Condition<'a>> {
        if reference.is_init() {
            return None;
        }
        let child = reference.node();
        let node = match child {
            Node::Expr(_) | Node::Pat(_) => utils::estree_parent(child),
            // The name is a part of it.
            _ => child,
        };
        let Above { statement, group } = self.look_above(child, node, state);
        let statement = statement?;
        // What is dynamic in a group is so in those around it.
        if group.is_some_and(|it| *state.is_dynamic.entry(it).or_insert_with(|| has_dynamic_expressions(it)))
            // What nothing defines is not a variable.
            || reference.symbol().is_none() && reference.global().is_none()
        {
            return None;
        }
        let init = match statement.kind() {
            StmtKind::For { init, .. } => init,
            _ => None,
        };
        Some(Condition {
            reference,
            group,
            inside: statement.span(),
            outside: init.map(|it| utils::estree_span(Node::Stmt(it))),
            is_modified: false,
        })
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut spans = std::mem::take(&mut cx.state.tests);
        if spans.is_empty() {
            return;
        }
        spans.sort_unstable_by_key(|it| it.start);
        // Only the references in the test of a loop are looked at.
        let mut conditions: Vec<Condition<'a>> = Vec::new();
        let (mut tests, mut end) = (spans.iter().peekable(), 0u32);
        for reference in cx.file().references() {
            let start = reference.ident().start();
            while let Some(test) = tests.next_if(|it| it.start <= start) {
                end = end.max(test.end);
            }
            if start < end {
                conditions.extend(self.to_loop_condition(reference, &mut cx.state));
            } else if tests.peek().is_none() {
                break;
            }
        }
        let mut modified_groups: FxHashSet<Expr<'a>> = FxHashSet::default();
        let mut of_symbols: FxHashMap<Symbol<'a>, Modifiers> = FxHashMap::default();
        let mut of_globals: FxHashMap<Name<'a>, Modifiers> = FxHashMap::default();
        let mut declarations = AncestorMemo::default();
        for condition in &mut conditions {
            let modifiers = match condition.reference.symbol() {
                Some(symbol) if !symbol.has_writes() => continue,
                Some(symbol) => (of_symbols.entry(symbol))
                    .or_insert_with(|| Modifiers::new(symbol.references(), &mut declarations)),
                None => {
                    let name = condition.reference.name();
                    let references = || cx.file().unresolved_references_to(name.bytes());
                    of_globals.entry(name).or_insert_with(|| Modifiers::new(references(), &mut declarations))
                }
            };
            condition.is_modified = condition.has_modifier_in_loop(modifiers);
            if condition.is_modified {
                modified_groups.extend(condition.group);
            }
        }
        // It is fine if anything in a group is modified.
        for condition in &conditions {
            if !condition.is_modified
                && !condition.group.is_some_and(|it| modified_groups.contains(&it))
            {
                cx.report(condition.reference, LOOP_CONDITION_NOT_MODIFIED)
                    .data("name", condition.reference.name());
            }
        }
    }
}

impl Rule for NoUnmodifiedLoopCondition {
    const META: Meta = Meta::eslint("no-unmodified-loop-condition", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoUnmodifiedLoopCondition {
            check_conditional_expressions: options.object(0).bool_or("checkConditionalExpressions", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.stmts([StmtTag::While, StmtTag::DoWhile, StmtTag::For], |_, statement, cx| {
            let test = match statement.kind() {
                StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => Some(test),
                StmtKind::For { test, .. } => test,
                _ => None,
            };
            cx.state.tests.extend(test.map(Expr::span));
        });
        on.finish(Self::finish);
        State::default()
    }
}
