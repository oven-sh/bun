use bun_lint::prelude::*;
use rustc_hash::FxHashSet;

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

impl<'a> Condition<'a> {
    /// ESLint's `isInLoop`.
    fn is_in_loop(&self, reference: Reference<'a>) -> bool {
        let span = reference.span();
        self.inside.contains(span) && !self.outside.is_some_and(|it| it.contains(span))
    }

    /// ESLint's `hasModifierInLoop`: `modifier` is in the loop, or in a function declaration that
    /// is referred to in the loop.
    fn has_modifier_in_loop(&self, modifier: Reference<'a>) -> bool {
        if self.is_in_loop(modifier) {
            return true;
        }
        let mut functions = modifier.node().ancestors().filter_map(Node::as_func);
        let declaration = functions.find(|it| it.kind() == FnKind::Decl && it.has_body());
        let Some(name) = declaration.and_then(Func::name) else {
            return false;
        };
        let variable = modifier.scope().parent().and_then(|it| it.resolve_name(name.name()));
        variable.is_some_and(|it| it.references().any(|reference| self.is_in_loop(reference)))
    }

    /// Whether something writes to the variable in the loop.
    fn find_modifier(&self) -> bool {
        let is_modifier = |it: Reference<'a>| is_write_reference(it) && self.has_modifier_in_loop(it);
        match self.reference.symbol() {
            Some(symbol) => symbol.references().any(is_modifier),
            None => {
                let file = self.reference.node().file();
                file.unresolved_references_to(self.reference.name().bytes()).any(is_modifier)
            }
        }
    }
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
    /// ESLint's `toLoopCondition`.
    fn to_loop_condition<'a>(&self, reference: Reference<'a>) -> Option<Condition<'a>> {
        if reference.is_init() {
            return None;
        }
        let mut child = reference.node();
        let mut node = match child {
            Node::Expr(_) | Node::Pat(_) => utils::estree_parent(child),
            // The name is a part of it.
            _ => child,
        };
        let mut group = None;
        loop {
            let node_type = utils::estree_type_name(node);
            if is_sentinel(node_type) {
                let (test, init) = match node.as_stmt()?.kind() {
                    StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => (test, None),
                    StmtKind::For { test, init, .. } => (test?, init),
                    _ => return None,
                };
                // What nothing defines is not a variable.
                if Node::Expr(test) != child
                    || reference.symbol().is_none() && reference.global().is_none()
                {
                    return None;
                }
                return Some(Condition {
                    reference,
                    group,
                    inside: node.span(),
                    outside: init.map(|it| utils::estree_span(Node::Stmt(it))),
                    is_modified: false,
                });
            }
            if node_type == "BinaryExpression"
                || !self.check_conditional_expressions && node_type == "ConditionalExpression"
            {
                let expression = node.as_expr()?;
                if has_dynamic_expressions(expression) {
                    return None;
                }
                group = Some(expression);
            }
            if let Node::File(_) = node {
                return None;
            }
            child = node;
            node = utils::estree_parent(node);
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut spans = std::mem::take(&mut cx.state);
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
                conditions.extend(self.to_loop_condition(reference));
            } else if tests.peek().is_none() {
                break;
            }
        }
        let mut modified_groups: FxHashSet<Expr<'a>> = FxHashSet::default();
        for condition in &mut conditions {
            condition.is_modified = condition.find_modifier();
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
    /// The tests of the loops.
    type State<'a> = Vec<Span>;

    fn new(options: &Options) -> Self {
        NoUnmodifiedLoopCondition {
            check_conditional_expressions: options.object(0).bool_or("checkConditionalExpressions", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Vec<Span> {
        on.stmts([StmtTag::While, StmtTag::DoWhile, StmtTag::For], |_, statement, cx| {
            let test = match statement.kind() {
                StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } => Some(test),
                StmtKind::For { test, .. } => test,
                _ => None,
            };
            cx.state.extend(test.map(Expr::span));
        });
        on.finish(Self::finish);
        Vec::new()
    }
}
