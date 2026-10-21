use bun_lint::prelude::*;
use bun_lint::types::{IdMap, IdSet};
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow unmodified loop conditions.
pub struct NoUnmodifiedLoopCondition {
    check_conditional_expressions: bool,
}

const LOOP_CONDITION_NOT_MODIFIED: Message = Message::new(
    "loopConditionNotModified",
    "'{{name}}' is not modified in this loop.",
);

/// ESLint's `SENTINEL_PATTERN`, tested against a `node.type`.
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
    /// The outermost `BinaryExpression` or `ConditionalExpression` that contains the reference.
    group: Option<Expr<'a>>,
    /// The loop.
    inside: Span,
    /// The `init` of a `for`.
    outside: Option<Span>,
    /// The result of [`Functions::enclosing_id`] for the loop.
    function: u32,
    is_modified: bool,
    /// True if it's in a conditional expression and `checkConditionalExpressions` is on.
    is_in_conditional: bool,
}

/// Memos for finding a node's enclosing function.
struct Functions<'a> {
    is_oxlint: bool,
    nearest: AncestorMemo<'a, Func<'a>>,
    /// The function declaration enclosing a node.
    declarations: AncestorMemo<'a, Func<'a>>,
}

impl<'a> Functions<'a> {
    /// Returns an ID for the function that `node` is in, or 0 outside a function. oxlint doesn't count code in a
    /// function nested in a loop as part of the loop. A static block isn't a function. Always 0 for ESLint.
    fn enclosing_id(&mut self, node: Node<'a>) -> u32 {
        if !self.is_oxlint {
            return 0;
        }
        let is_function = |it: &Func<'a>| it.kind() != FnKind::StaticBlock;
        let function = self.nearest.find(node, |_, it| it.as_func().filter(is_function));
        function.map_or(0, |it| it.span().start + 1)
    }

    fn sorted(&mut self, references: &[Reference<'a>]) -> SortedReferences {
        let mut sorted: SortedReferences = references.iter().map(|it| (self.enclosing_id(it.node()), it.span())).collect();
        utils::sort::sort_unstable_by_key(&mut sorted, |it| (it.0, it.1.start));
        sorted
    }
}

/// References, each with its [`Functions::enclosing_id`] ID, sorted by ID and then by position.
type SortedReferences = Vec<(u32, Span)>;

/// The writes to a variable, and the calls that may write to it.
struct Modifiers<'a> {
    /// The references that write to it.
    all: Vec<Reference<'a>>,
    writes: SortedReferences,
    /// The references to the function declarations that contain one of the writes. Computed the first time a loop has
    /// none of `writes` in it.
    calls: Option<SortedReferences>,
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
            writes: functions.sorted(&all),
            all,
            calls: None,
        }
    }

    fn calls(&mut self, functions: &mut Functions<'a>) -> &[(u32, Span)] {
        let all = &self.all;
        self.calls.get_or_insert_with(|| {
            let mut calls: Vec<Reference<'a>> = Vec::new();
            let mut seen: IdSet<Symbol<'a>> = IdSet::new();
            for modifier in all {
                let declaration = functions.declarations.find(modifier.node(), |_, it| {
                    it.as_func().filter(|it| it.kind() == FnKind::Decl && it.has_body())
                });
                if let Some(name) = declaration.and_then(Func::name)
                    && let Some(variable) = modifier.scope().parent().and_then(|it| it.resolve_name(name.name()))
                    && seen.insert(variable)
                {
                    // oxlint requires the function to be called.
                    calls.extend(variable.references().filter(|it| !functions.is_oxlint || is_invocation(it)));
                }
            }
            functions.sorted(&calls)
        })
    }
}

impl<'a> Condition<'a> {
    /// ESLint's `isInLoop`, for any of `sorted`.
    fn is_any_in_loop(&self, sorted: &[(u32, Span)]) -> bool {
        let within = |span: Span| {
            sorted.partition_point(|it| (it.0, it.1.start) < (self.function, span.start))
                ..sorted.partition_point(|it| (it.0, it.1.end) <= (self.function, span.end))
        };
        let (inside, outside) = (within(self.inside), self.outside.map_or(0..0, within));
        inside.start < inside.end && (inside.start < outside.start || outside.end < inside.end)
    }

    /// ESLint's `hasModifierInLoop`, for any of the modifiers: it's in the loop, or in a function declaration that the
    /// loop references.
    fn has_modifier_in_loop(&self, modifiers: &mut Modifiers<'a>, functions: &mut Functions<'a>) -> bool {
        self.is_any_in_loop(&modifiers.writes) || self.is_any_in_loop(modifiers.calls(functions))
    }
}

/// The result of `look_above`, which walks from a node up to the nearest sentinel: a call, function, statement and so
/// on.
#[derive(Copy, Clone)]
struct Above<'a> {
    /// The loop whose test the node is in.
    statement: Option<Stmt<'a>>,
    /// The outermost `BinaryExpression` or `ConditionalExpression` that the node is, or is in.
    group: Option<Expr<'a>>,
    /// [`Condition::is_in_conditional`]
    is_in_conditional: bool,
}

#[derive(Default)]
pub struct State<'a> {
    /// The tests of the loops.
    tests: Vec<Span>,
    /// Caches `has_dynamic_expressions`.
    is_dynamic: IdMap<Expr<'a>, bool>,
    is_oxlint: bool,
}

/// ESLint's `isWriteReference`. Only a `var`'s initializer counts, because it runs again in each iteration of an
/// enclosing loop. In oxc, a declaration's initializer doesn't create a reference.
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

/// oxlint doesn't stop at a call or member expression that's the root of an optional chain, or at a member expression
/// that's written to.
fn oxlint_looks_through(node: Node) -> bool {
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
                if !(is_oxlint && oxlint_looks_through(node)) =>
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
    /// Walks up from `node`. `child` is the child the walk came from.
    fn look_above<'a>(&self, mut child: Node<'a>, mut node: Node<'a>, is_oxlint: bool) -> Above<'a> {
        let (mut group, mut is_in_conditional) = (None, false);
        loop {
            let node_type = utils::estree_type_name(node);
            let is_end = is_sentinel(node_type) && !(is_oxlint && oxlint_looks_through(node));
            if is_end || matches!(node, Node::File(_)) {
                let statement = node.as_stmt().filter(|it| {
                    let test = match it.kind() {
                        StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => Some(test),
                        StmtKind::For { test, .. } => test,
                        _ => None,
                    };
                    is_end && test.is_some_and(|test| Node::Expr(test) == child)
                });
                return Above { statement, group, is_in_conditional };
            }
            if (node_type == "BinaryExpression"
                || !self.check_conditional_expressions && node_type == "ConditionalExpression")
                && let Some(expression) = node.as_expr()
            {
                group = Some(expression);
            } else if node_type == "ConditionalExpression" {
                is_in_conditional = true;
            }
            child = node;
            node = utils::estree_parent(node);
        }
    }

    /// ESLint's `toLoopCondition`.
    fn to_loop_condition<'a>(
        &self,
        reference: Reference<'a>,
        state: &mut State<'a>,
        functions: &mut Functions<'a>,
    ) -> Option<Condition<'a>> {
        // oxlint ignores references in types.
        if reference.is_init() || state.is_oxlint && !reference.is_value() {
            return None;
        }
        let child = reference.node();
        let node = match child {
            Node::Expr(_) | Node::Pat(_) => utils::estree_parent(child),
            // The name is part of this node.
            _ => child,
        };
        let Above { statement, group, is_in_conditional } = self.look_above(child, node, state.is_oxlint);
        let statement = statement?;
        // Only the outermost group needs checking: anything dynamic in an inner group is also inside the outer one.
        let is_oxlint = state.is_oxlint;
        let is_dynamic = group
            .is_some_and(|it| *state.is_dynamic.get_or_insert_with(it, || has_dynamic_expressions(it, is_oxlint)));
        if is_dynamic
            // An undefined name isn't a variable. For oxlint the file has to declare it.
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
            function: functions.enclosing_id(Node::Stmt(statement)),
            is_modified: false,
            is_in_conditional,
        })
    }
}

impl Rule for NoUnmodifiedLoopCondition {
    const META: Meta = Meta::eslint("no-unmodified-loop-condition", Kind::Problem).reports_at_the_end();
    const ON: On = On::new().stmts(&[StmtTag::While, StmtTag::DoWhile, StmtTag::For]).finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoUnmodifiedLoopCondition {
            check_conditional_expressions: options.object(0).bool_or("checkConditionalExpressions", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        Some(State { is_oxlint: file.language().is_oxlint, ..State::default() })
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let test = match statement.kind() {
            StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => Some(test),
            StmtKind::For { test, .. } => test,
            _ => None,
        };
        cx.state.tests.extend(test.map(Expr::span));
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut spans = std::mem::take(&mut cx.state.tests);
        if spans.is_empty() {
            return;
        }
        utils::sort::sort_unstable_by_key(&mut spans, |it| it.start);
        // Only references in a loop's test matter.
        let mut conditions: Vec<Condition<'a>> = Vec::new();
        let is_oxlint = cx.state.is_oxlint;
        let mut functions =
            Functions { is_oxlint, nearest: AncestorMemo::default(), declarations: AncestorMemo::default() };
        // A test can be nested in another, so skip the part already visited.
        let mut end = 0u32;
        for test in spans {
            for reference in cx.file().references_within(Span::new(test.start.max(end), test.end)) {
                conditions.extend(self.to_loop_condition(reference, &mut cx.state, &mut functions));
            }
            end = end.max(test.end);
        }
        let mut modified_groups: IdSet<Expr<'a>> = IdSet::new();
        let mut symbol_modifiers: IdMap<Symbol<'a>, Modifiers<'a>> = IdMap::new();
        let mut global_modifiers: FxHashMap<Name<'a>, Modifiers<'a>> = FxHashMap::default();
        for condition in &mut conditions {
            let modifiers = match condition.reference.symbol() {
                Some(symbol) if !symbol.has_writes() => continue,
                Some(symbol) => {
                    symbol_modifiers.get_or_insert_with(symbol, || Modifiers::new(&mut symbol.references(), &mut functions))
                }
                None => {
                    let name = condition.reference.name();
                    let references = || cx.file().unresolved_references_to(name.bytes());
                    global_modifiers.entry(name).or_insert_with(|| Modifiers::new(&mut references(), &mut functions))
                }
            };
            condition.is_modified = condition.has_modifier_in_loop(modifiers, &mut functions);
            if condition.is_modified
                && let Some(group) = condition.group
            {
                modified_groups.insert(group);
            }
        }
        // A group is fine if anything in it is modified.
        conditions.retain(|it| !it.is_modified && !it.group.is_some_and(|it| modified_groups.contains(it)));
        if is_oxlint {
            // oxlint reports a variable once per loop: at a reference outside any group if there is one, otherwise at
            // the first.
            let variable_in_loop = |it: &Condition<'a>| (it.inside.start, it.reference.symbol().map(Symbol::key));
            utils::sort::sort_by_key(&mut conditions, |it| (variable_in_loop(it), it.is_in_conditional, it.group.is_some()));
            let mut last = None;
            conditions.retain(|it| it.is_in_conditional || last.replace(variable_in_loop(it)) != Some(variable_in_loop(it)));
        }
        for condition in &conditions {
            cx.report(condition.reference, LOOP_CONDITION_NOT_MODIFIED).data("name", condition.reference.name());
        }
    }
}
