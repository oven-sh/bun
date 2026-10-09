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
    /// [`Functions::around`] the loop.
    function: u32,
    is_modified: bool,
    /// It is in a conditional expression, with `checkConditionalExpressions`.
    is_alone: bool,
}

/// The functions around nodes.
struct Functions<'a> {
    is_oxlint: bool,
    nearest: AncestorMemo<'a, Func<'a>>,
    /// The function declaration around a node.
    declarations: AncestorMemo<'a, Func<'a>>,
}

impl<'a> Functions<'a> {
    /// For oxlint what is in a function in a loop is not in the loop: a number for the function that `node` is in, 0
    /// for what is in none. A static block is none. For ESLint always 0.
    fn around(&mut self, node: Node<'a>) -> u32 {
        if !self.is_oxlint {
            return 0;
        }
        let is_function = |it: &Func<'a>| it.kind() != FnKind::StaticBlock;
        let function = self.nearest.find(node, |_, it| it.as_func().filter(is_function));
        function.map_or(0, |it| it.span().start + 1)
    }

    fn places(&mut self, references: &[Reference<'a>]) -> Places {
        let mut places: Places = references.iter().map(|it| (self.around(it.node()), it.span())).collect();
        utils::sort::sort_unstable_by_key(&mut places, |it| (it.0, it.1.start));
        places
    }
}

/// References, each with [`Functions::around`] it, sorted by that and by where they are.
type Places = Vec<(u32, Span)>;

/// Where a variable is modified.
struct Modifiers<'a> {
    /// The references that write to it.
    all: Vec<Reference<'a>>,
    writes: Places,
    /// The references to the function declarations that one of these is in. They are looked for when a loop has none of
    /// `writes` in it.
    calls: Option<Places>,
}

/// oxlint's `is_function_invocation_reference`
fn is_invocation(reference: &Reference) -> bool {
    reference.expr().is_some_and(|e| {
        !e.is_parenthesized()
            && matches!(e.parent(), Node::Expr(parent) if matches!(
                parent.kind(),
                ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) if call.callee() == e
            ))
    })
}

impl<'a> Modifiers<'a> {
    fn new(references: &mut dyn Iterator<Item = Reference<'a>>, functions: &mut Functions<'a>) -> Self {
        let all: Vec<Reference<'a>> = references.filter(|it| is_write_reference(*it, functions.is_oxlint)).collect();
        Modifiers {
            writes: functions.places(&all),
            all,
            calls: None,
        }
    }

    fn calls(&mut self, functions: &mut Functions<'a>) -> &[(u32, Span)] {
        let all = &self.all;
        self.calls.get_or_insert_with(|| {
            let mut calls: Vec<Reference<'a>> = Vec::new();
            let mut seen: FxHashSet<Symbol<'a>> = FxHashSet::default();
            for modifier in all {
                let declaration = functions.declarations.find(modifier.node(), |_, it| {
                    it.as_func().filter(|it| it.kind() == FnKind::Decl && it.has_body())
                });
                if let Some(name) = declaration.and_then(Func::name)
                    && let Some(variable) = modifier.scope().parent().and_then(|it| it.resolve_name(name.name()))
                    && seen.insert(variable)
                {
                    // For oxlint the function has to be called.
                    calls.extend(variable.references().filter(|it| !functions.is_oxlint || is_invocation(it)));
                }
            }
            functions.places(&calls)
        })
    }
}

impl<'a> Condition<'a> {
    /// ESLint's `isInLoop`, for any of `places`.
    fn is_any_in_loop(&self, places: &[(u32, Span)]) -> bool {
        let within = |span: Span| {
            places.partition_point(|it| (it.0, it.1.start) < (self.function, span.start))
                ..places.partition_point(|it| (it.0, it.1.end) <= (self.function, span.end))
        };
        let (inside, outside) = (within(self.inside), self.outside.map_or(0..0, within));
        inside.start < inside.end && (inside.start < outside.start || outside.end < inside.end)
    }

    /// ESLint's `hasModifierInLoop`, for any of the modifiers: it is in the loop, or in a function
    /// declaration that is referred to in the loop.
    fn has_modifier_in_loop(&self, modifiers: &mut Modifiers<'a>, functions: &mut Functions<'a>) -> bool {
        self.is_any_in_loop(&modifiers.writes) || self.is_any_in_loop(modifiers.calls(functions))
    }
}

/// What is above a node that is in no call, function or statement yet.
#[derive(Copy, Clone)]
struct Above<'a> {
    /// The loop whose test it is in.
    statement: Option<Stmt<'a>>,
    /// The outermost `BinaryExpression` or `ConditionalExpression` that it is, or is in.
    group: Option<Expr<'a>>,
    /// [`Condition::is_alone`]
    is_alone: bool,
}

#[derive(Default)]
pub struct State<'a> {
    /// The tests of the loops.
    tests: Vec<Span>,
    /// For the nodes that are far below the test, as in `a + a + ..`.
    above: FxHashMap<Node<'a>, Above<'a>>,
    /// `has_dynamic_expressions`
    is_dynamic: FxHashMap<Expr<'a>, bool>,
    is_oxlint: bool,
}

/// ESLint's `isWriteReference`. Of the initializers only those of `var` count: they are evaluated
/// again in each iteration of a loop around them. For oxc what a declaration initializes is no reference.
fn is_write_reference(reference: Reference, is_oxlint: bool) -> bool {
    if reference.is_init() {
        if is_oxlint {
            return false;
        }
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

/// oxlint goes on at a call or a member expression that is the whole of an optional chain, and at a member expression
/// that is written to.
fn is_passed_by_oxlint(node: Node) -> bool {
    let is_updated = |e: Expr| {
        matches!(e.parent(), Node::Expr(parent) if matches!(
            parent.kind(),
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. }
        ))
    };
    node.as_expr().is_some_and(|e| match e.tag() {
        ExprTag::Call => e.is_chain_root(),
        ExprTag::Dot | ExprTag::Index => e.is_chain_root() || utils::is_assignment_target(e) || is_updated(e),
        _ => false,
    })
}

/// ESLint's `hasDynamicExpressions`.
fn has_dynamic_expressions(root: Expr, is_oxlint: bool) -> bool {
    let mut stack = vec![Node::Expr(root)];
    while let Some(node) = stack.pop() {
        match utils::estree_type_name(node) {
            "CallExpression" | "MemberExpression" | "NewExpression" | "TaggedTemplateExpression"
            | "YieldExpression"
                if !(is_oxlint && is_passed_by_oxlint(node)) =>
            {
                return true;
            }
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
        // How many nodes have been passed up to the outermost conditional expression that makes no group.
        let mut alone_below = 0;
        let above = loop {
            if passed.len() >= NEAR
                && let Some(&known) = state.above.get(&node)
            {
                break known;
            }
            let node_type = utils::estree_type_name(node);
            let is_end = is_sentinel(node_type) && !(state.is_oxlint && is_passed_by_oxlint(node));
            if is_end || matches!(node, Node::File(_)) {
                let statement = node.as_stmt().filter(|it| {
                    let test = match it.kind() {
                        StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => Some(test),
                        StmtKind::For { test, .. } => test,
                        _ => None,
                    };
                    is_end && test.is_some_and(|test| Node::Expr(test) == child)
                });
                break Above { statement, group: None, is_alone: false };
            }
            passed.push(node);
            if (node_type == "BinaryExpression"
                || !self.check_conditional_expressions && node_type == "ConditionalExpression")
                && let Some(expression) = node.as_expr()
            {
                group = Some((expression, passed.len()));
            } else if node_type == "ConditionalExpression" {
                alone_below = passed.len();
            }
            child = node;
            node = utils::estree_parent(node);
        };
        let group_from = |count: usize| {
            above.group.or_else(|| group.filter(|it| count < it.1).map(|it| it.0))
        };
        let from = |count: usize| Above {
            statement: above.statement,
            group: group_from(count),
            is_alone: above.is_alone || count < alone_below,
        };
        for (count, &node) in passed.iter().enumerate().skip(NEAR) {
            state.above.insert(node, from(count));
        }
        from(0)
    }

    /// ESLint's `toLoopCondition`.
    fn to_loop_condition<'a>(
        &self,
        reference: Reference<'a>,
        state: &mut State<'a>,
        functions: &mut Functions<'a>,
    ) -> Option<Condition<'a>> {
        // oxlint does not look at types.
        if reference.is_init() || state.is_oxlint && !reference.is_value() {
            return None;
        }
        let child = reference.node();
        let node = match child {
            Node::Expr(_) | Node::Pat(_) => utils::estree_parent(child),
            // The name is a part of it.
            _ => child,
        };
        let Above { statement, group, is_alone } = self.look_above(child, node, state);
        let statement = statement?;
        // What is dynamic in a group is so in those around it.
        let is_oxlint = state.is_oxlint;
        if group.is_some_and(|it| *state.is_dynamic.entry(it).or_insert_with(|| has_dynamic_expressions(it, is_oxlint)))
            // What nothing defines is not a variable. For oxlint the file has to declare it.
            || reference.symbol().is_none() && (is_oxlint || reference.global().is_none())
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
            function: functions.around(Node::Stmt(statement)),
            is_modified: false,
            is_alone,
        })
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut spans = std::mem::take(&mut cx.state.tests);
        if spans.is_empty() {
            return;
        }
        utils::sort::sort_unstable_by_key(&mut spans, |it| it.start);
        // Only the references in the test of a loop are looked at.
        let mut conditions: Vec<Condition<'a>> = Vec::new();
        let is_oxlint = cx.state.is_oxlint;
        let mut functions =
            Functions { is_oxlint, nearest: AncestorMemo::default(), declarations: AncestorMemo::default() };
        let (mut tests, mut end) = (spans.iter().peekable(), 0u32);
        for reference in cx.file().references() {
            let start = reference.ident().start();
            while let Some(test) = tests.next_if(|it| it.start <= start) {
                end = end.max(test.end);
            }
            if start < end {
                conditions.extend(self.to_loop_condition(reference, &mut cx.state, &mut functions));
            } else if tests.peek().is_none() {
                break;
            }
        }
        let mut modified_groups: FxHashSet<Expr<'a>> = FxHashSet::default();
        let mut of_symbols: FxHashMap<Symbol<'a>, Modifiers<'a>> = FxHashMap::default();
        let mut of_globals: FxHashMap<Name<'a>, Modifiers<'a>> = FxHashMap::default();
        for condition in &mut conditions {
            let modifiers = match condition.reference.symbol() {
                Some(symbol) if !symbol.has_writes() => continue,
                Some(symbol) => (of_symbols.entry(symbol))
                    .or_insert_with(|| Modifiers::new(&mut symbol.references(), &mut functions)),
                None => {
                    let name = condition.reference.name();
                    let references = || cx.file().unresolved_references_to(name.bytes());
                    of_globals.entry(name).or_insert_with(|| Modifiers::new(&mut references(), &mut functions))
                }
            };
            condition.is_modified = condition.has_modifier_in_loop(modifiers, &mut functions);
            if condition.is_modified {
                modified_groups.extend(condition.group);
            }
        }
        // It is fine if anything in a group is modified.
        conditions.retain(|it| !it.is_modified && !it.group.is_some_and(|it| modified_groups.contains(&it)));
        if is_oxlint {
            // oxlint reports a variable once in a loop: where it is in no group, or else where it is first.
            let variable_in_loop = |it: &Condition<'a>| (it.inside.start, it.reference.symbol().map(Symbol::key));
            utils::sort::sort_by_key(&mut conditions, |it| (variable_in_loop(it), it.is_alone, it.group.is_some()));
            let mut last = None;
            conditions.retain(|it| it.is_alone || last.replace(variable_in_loop(it)) != Some(variable_in_loop(it)));
        }
        for condition in &conditions {
            cx.report(condition.reference, LOOP_CONDITION_NOT_MODIFIED).data("name", condition.reference.name());
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        on.stmts([StmtTag::While, StmtTag::DoWhile, StmtTag::For], |_, statement, cx| {
            let test = match statement.kind() {
                StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => Some(test),
                StmtKind::For { test, .. } => test,
                _ => None,
            };
            cx.state.tests.extend(test.map(Expr::span));
        });
        on.finish(Self::finish);
        State { is_oxlint: file.language().is_oxlint, ..State::default() }
    }
}
