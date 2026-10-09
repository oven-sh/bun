use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::symbol_of;
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
struct Modifiers<'a> {
    /// The references that write to it.
    all: Vec<Reference<'a>>,
    /// Where these are, in the order of the source.
    writes: Vec<Span>,
    /// The references to the function declarations that one of these is in, in the order of the
    /// source. They are looked for when a loop has none of `writes` in it.
    calls: Option<Vec<Span>>,
}

impl<'a> Modifiers<'a> {
    fn new(references: impl Iterator<Item = Reference<'a>>) -> Self {
        let all: Vec<Reference<'a>> = references.filter(|it| is_write_reference(*it)).collect();
        let mut writes: Vec<Span> = all.iter().map(|it| it.span()).collect();
        utils::sort::sort_unstable_by_key(&mut writes, |it| it.start);
        Modifiers {
            all,
            writes,
            calls: None,
        }
    }

    /// `declarations`: the function declaration around a node.
    fn calls(&mut self, declarations: &mut AncestorMemo<'a, Func<'a>>) -> &[Span] {
        let all = &self.all;
        self.calls.get_or_insert_with(|| {
            let mut calls: Vec<Span> = Vec::new();
            let mut functions: FxHashSet<Symbol<'a>> = FxHashSet::default();
            for modifier in all {
                let declaration = declarations.find(modifier.node(), |_, it| {
                    it.as_func().filter(|it| it.kind() == FnKind::Decl && it.has_body())
                });
                if let Some(name) = declaration.and_then(Func::name)
                    && let Some(variable) = modifier.scope().parent().and_then(|it| it.resolve_name(name.name()))
                    && functions.insert(variable)
                {
                    calls.extend(variable.references().map(Reference::span));
                }
            }
            utils::sort::sort_unstable_by_key(&mut calls, |it| it.start);
            calls
        })
    }
}

impl<'a> Condition<'a> {
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
    fn has_modifier_in_loop(
        &self,
        modifiers: &mut Modifiers<'a>,
        declarations: &mut AncestorMemo<'a, Func<'a>>,
    ) -> bool {
        self.is_any_in_loop(&modifiers.writes) || self.is_any_in_loop(modifiers.calls(declarations))
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
    oxlint: Oxlint<'a>,
}

/// A loop, for oxlint.
struct Loop {
    /// The function that it is in: `Oxlint::number_of_function`.
    function: u32,
    inside: Span,
    /// The `init` of a `for`.
    outside: Option<Span>,
}

/// References, each with the function that it is in, sorted by that and by where they are.
type Places = Vec<(u32, Span)>;

/// oxlint's `is_in_loop`, for any of `places`: it is in the loop, not in a function in the loop.
fn is_any_in_loop(places: &[(u32, Span)], at: &Loop) -> bool {
    let within = |span: Span| {
        places.partition_point(|it| (it.0, it.1.start) < (at.function, span.start))
            ..places.partition_point(|it| (it.0, it.1.end) <= (at.function, span.end))
    };
    let (inside, outside) = (within(at.inside), at.outside.map_or(0..0, within));
    inside.start < inside.end && (inside.start < outside.start || outside.end < inside.end)
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

/// What oxlint's rule knows about the file.
#[derive(Default)]
struct Oxlint<'a> {
    /// The function around a node.
    functions: AncestorMemo<'a, Func<'a>>,
    numbers: FxHashMap<Func<'a>, u32>,
    /// The function declaration around a node.
    declarations: AncestorMemo<'a, Func<'a>>,
    /// Where a variable is written to.
    writes: FxHashMap<Symbol<'a>, Places>,
    /// Where the function declarations are called that a variable is written to in.
    calls: FxHashMap<Symbol<'a>, Places>,
}

impl<'a> Oxlint<'a> {
    /// 0 for what is in no function. A static block is none.
    fn number_of_function(&mut self, node: Node<'a>) -> u32 {
        let function = self.functions.find(node, |_, it| it.as_func().filter(|it| it.kind() != FnKind::StaticBlock));
        let next = self.numbers.len() as u32 + 1;
        function.map_or(0, |it| *self.numbers.entry(it).or_insert(next))
    }

    fn places(&mut self, references: impl Iterator<Item = Reference<'a>>) -> Places {
        let mut places: Places = references.map(|it| (self.number_of_function(it.node()), it.span())).collect();
        utils::sort::sort_unstable_by_key(&mut places, |it| (it.0, it.1.start));
        places
    }

    /// oxlint's `is_symbol_modified_in_loop`
    fn is_modified(&mut self, symbol: Symbol<'a>, at: &Loop) -> bool {
        // What a declaration initializes is no reference for oxc.
        let modifiers = || symbol.references().filter(|it| it.is_write() && !it.is_init());
        if !symbol.has_writes() {
            return false;
        }
        if !self.writes.contains_key(&symbol) {
            let writes = self.places(modifiers());
            self.writes.insert(symbol, writes);
        }
        if self.writes.get(&symbol).is_some_and(|it| is_any_in_loop(it, at)) {
            return true;
        }
        if !self.calls.contains_key(&symbol) {
            let mut functions: FxHashSet<Symbol<'a>> = FxHashSet::default();
            let mut invocations: Vec<Reference<'a>> = Vec::new();
            for modifier in modifiers() {
                let declaration = self.declarations.find(modifier.node(), |_, it| {
                    it.as_func().filter(|it| it.kind() == FnKind::Decl && it.has_body())
                });
                if let Some(function) = declaration.and_then(Func::symbol)
                    && functions.insert(function)
                {
                    invocations.extend(function.references().filter(is_invocation));
                }
            }
            let calls = self.places(invocations.into_iter());
            self.calls.insert(symbol, calls);
        }
        self.calls.get(&symbol).is_some_and(|it| is_any_in_loop(it, at))
    }
}

/// What oxlint finds in the test of a loop: a name that something in the file declares.
struct Found<'a> {
    symbol: Symbol<'a>,
    at: Span,
    /// The outermost `BinaryExpression` or `ConditionalExpression` that it is in.
    group: Option<Span>,
    /// It is in a conditional expression, with `checkConditionalExpressions`.
    is_alone: bool,
}

/// What is still to be looked at in the test of a loop.
enum Step<'a> {
    /// `is_target`: it is assigned to.
    Visit { e: Expr<'a>, is_target: bool },
    /// The name in a tag.
    Name { symbol: Symbol<'a>, at: Span },
}

/// What the name in a tag refers to for oxc: the `A` of `<A>` and the `a` of `<a.b>`. `<a>` is the name of an element.
fn reference_in_tag(tag: Expr<'_>) -> Option<Expr<'_>> {
    let mut first = tag;
    while let ExprKind::Dot { obj, .. } = first.kind() {
        first = obj;
    }
    let is_element = first == tag && first.text().first().is_some_and(u8::is_ascii_lowercase);
    (!is_element).then_some(first)
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
    /// oxlint's `ConditionSymbolsCollector`: the names in `test`, in the order of the source, and the groups that have something
    /// dynamic in them. It goes no further at a call or a member expression, unless that is the whole of an optional chain or
    /// is assigned to.
    fn collect_for_oxlint<'a>(&self, test: Expr<'a>) -> (Vec<Found<'a>>, FxHashSet<Span>) {
        let expression = |e: Expr<'a>| Step::Visit { e, is_target: false };
        let (mut found, mut dynamic_groups) = (Vec::new(), FxHashSet::default());
        let mut stack = vec![(expression(test), None, false)];
        while let Some((step, mut group, mut is_alone)) = stack.pop() {
            let (e, is_target) = match step {
                Step::Visit { e, is_target } => (e, is_target),
                Step::Name { symbol, at } => {
                    found.push(Found { symbol, at, group, is_alone });
                    continue;
                }
            };
            let same = |e: Expr<'a>| Step::Visit { e, is_target };
            let mut next: SmallVec<[Step<'a>; 4]> = SmallVec::new();
            match e.kind() {
                ExprKind::Ident(_) => next.extend(symbol_of(e).map(|symbol| Step::Name { symbol, at: e.span() })),
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, left, right } => {
                    next.extend([expression(left), expression(right)]);
                }
                // `#a in b`
                ExprKind::Binary { left, right, .. } if left.tag() == ExprTag::PrivateIdentifier => {
                    next.push(expression(right));
                }
                ExprKind::Binary { left, right, .. } => {
                    group = group.or_else(|| Some(e.span()));
                    next.extend([expression(left), expression(right)]);
                }
                ExprKind::Cond { test, yes, no } => {
                    match self.check_conditional_expressions {
                        true => is_alone = true,
                        false => group = group.or_else(|| Some(e.span())),
                    }
                    next.extend([expression(test), expression(yes), expression(no)]);
                }
                ExprKind::Dot { obj, .. } if is_target || e.is_chain_root() => next.push(expression(obj)),
                ExprKind::Index { obj, index, .. } if is_target || e.is_chain_root() => {
                    next.extend([expression(obj), expression(index)]);
                }
                ExprKind::Call(call) if e.is_chain_root() => {
                    next.push(expression(call.callee()));
                    next.extend(call.args().iter().map(expression));
                }
                ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Yield { .. } => dynamic_groups.extend(group),
                ExprKind::Assign { target, value, .. } => {
                    next.extend([Step::Visit { e: target, is_target: true }, expression(value)]);
                }
                ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand } => {
                    next.push(Step::Visit { e: operand, is_target: true });
                }
                ExprKind::Unary { operand, .. }
                | ExprKind::Await(operand)
                | ExprKind::AsConst(operand)
                | ExprKind::NonNull(operand)
                | ExprKind::As { expr: operand, .. }
                | ExprKind::Satisfies { expr: operand, .. }
                | ExprKind::Instantiation { expr: operand, .. } => next.push(expression(operand)),
                ExprKind::Spread(operand) => next.push(same(operand)),
                ExprKind::Array(elements) => next.extend(elements.iter().map(same)),
                ExprKind::Object(properties) => {
                    for property in properties {
                        if let Some(KeyKind::Computed(key)) = property.key().map(Key::kind) {
                            next.push(expression(key));
                        }
                        next.extend(property.value().map(same));
                    }
                }
                ExprKind::Template(template) => next.extend(template.exprs().iter().map(expression)),
                ExprKind::ImportCall { args } => next.extend(args.iter().map(expression)),
                ExprKind::Jsx(jsx) => {
                    // The name in the closing tag is a reference of its own.
                    let symbol = jsx.tag().and_then(reference_in_tag).and_then(symbol_of);
                    let name = |tag: Option<Expr<'a>>| Some(Step::Name { symbol: symbol?, at: reference_in_tag(tag?)?.span() });
                    next.extend(name(jsx.tag()));
                    next.extend(jsx.attrs().iter().filter_map(Prop::value).map(expression));
                    next.extend(jsx.children().iter().map(expression));
                    next.extend(name(jsx.close_tag()));
                }
                _ => {}
            }
            stack.extend(next.into_iter().rev().map(|step| (step, group, is_alone)));
        }
        (found, dynamic_groups)
    }

    /// oxlint's `check_loop_condition`
    fn check_loop_for_oxlint<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (test, init) = match statement.kind() {
            StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => (test, None),
            StmtKind::For { test: Some(test), init, .. } => (test, init),
            _ => return,
        };
        let (found, mut fine_groups) = self.collect_for_oxlint(test);
        // Of a variable the first in each group counts, and the first of those that are in no group.
        let mut seen: FxHashSet<(Option<Span>, Symbol<'a>)> = FxHashSet::default();
        let found: Vec<Found<'a>> =
            found.into_iter().filter(|it| it.is_alone || seen.insert((it.group, it.symbol))).collect();
        if found.is_empty() {
            return;
        }
        let known = &mut cx.state.oxlint;
        let at = Loop {
            function: known.number_of_function(Node::Stmt(statement)),
            inside: statement.span(),
            outside: init.map(|it| utils::estree_span(Node::Stmt(it))),
        };
        let is_modified: Vec<bool> = found.iter().map(|it| known.is_modified(it.symbol, &at)).collect();
        // It is fine if anything in a group is modified.
        fine_groups.extend(found.iter().zip(&is_modified).filter(|it| *it.1).filter_map(|it| it.0.group));
        // Those in no group come first.
        let mut reported: FxHashSet<Symbol<'a>> = FxHashSet::default();
        for is_in_group in [false, true] {
            for (it, &is_modified) in found.iter().zip(&is_modified) {
                let is_fine = it.group.map_or(is_modified, |group| fine_groups.contains(&group));
                if it.group.is_some() == is_in_group && !is_fine && (it.is_alone || reported.insert(it.symbol)) {
                    cx.report(it.at, LOOP_CONDITION_NOT_MODIFIED).data("name", it.symbol.name());
                }
            }
        }
    }

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
        utils::sort::sort_unstable_by_key(&mut spans, |it| it.start);
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
        let mut of_symbols: FxHashMap<Symbol<'a>, Modifiers<'a>> = FxHashMap::default();
        let mut of_globals: FxHashMap<Name<'a>, Modifiers<'a>> = FxHashMap::default();
        let mut declarations = AncestorMemo::default();
        for condition in &mut conditions {
            let modifiers = match condition.reference.symbol() {
                Some(symbol) if !symbol.has_writes() => continue,
                Some(symbol) => of_symbols.entry(symbol).or_insert_with(|| Modifiers::new(symbol.references())),
                None => {
                    let name = condition.reference.name();
                    let references = || cx.file().unresolved_references_to(name.bytes());
                    of_globals.entry(name).or_insert_with(|| Modifiers::new(references()))
                }
            };
            condition.is_modified = condition.has_modifier_in_loop(modifiers, &mut declarations);
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.language().is_oxlint {
            on.stmts([StmtTag::While, StmtTag::DoWhile, StmtTag::For], Self::check_loop_for_oxlint);
            return State::default();
        }
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
