use bun_lint::prelude::*;
use bun_lint::utils::fix_tracker::FixTracker;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Require `const` declarations for variables that are never reassigned after declared.
pub struct PreferConst {
    should_match_any_destructured_variable: bool,
    ignore_read_before_assign: bool,
}

const USE_CONST: Message =
    Message::new("useConst", "'{{name}}' is never reassigned. Use 'const' instead.");

fn is_init_of_for_statement(stmt: Stmt) -> bool {
    matches!(stmt.parent(), Node::Stmt(parent)
        if matches!(parent.kind(), StmtKind::For { init: Some(init), .. } if init == stmt))
}

/// Whether `e`, the parent of `child`, is a `Pattern` or a `RestElement` of ESLint.
fn is_pattern<'a>(e: Expr<'a>, child: Expr<'a>) -> bool {
    match e.kind() {
        ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Spread(_) => utils::is_assignment_target(e),
        ExprKind::Assign { target, .. } => target == child && utils::is_assignment_target(e),
        _ => false,
    }
}

/// The first ancestor of `identifier`, an `Expr` or a `Pat`, whose type does not match ESLint's
/// `PATTERN_TYPE`.
fn skip_patterns<'a>(identifier: Node<'a>) -> Node<'a> {
    let Node::Expr(mut at) = identifier else {
        let mut ancestors = identifier.ancestors();
        let found = ancestors.find(|it| !matches!(it, Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_)));
        return found.unwrap_or(identifier);
    };
    loop {
        let parent = match at.parent() {
            Node::Prop(property) => property.parent(),
            parent => parent,
        };
        match parent {
            Node::Expr(e) if is_pattern(e, at) => at = e,
            _ => return parent,
        }
    }
}

fn can_become_variable_declaration(identifier: Node) -> bool {
    match skip_patterns(identifier) {
        Node::VarDecl(_) => true,
        Node::Expr(e) if e.tag() == ExprTag::Assign => match e.parent() {
            Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Expr(_)) => {
                match statement.parent() {
                    Node::File(_) | Node::Func(_) | Node::Case(_) => true,
                    Node::Stmt(host) => matches!(host.kind(), StmtKind::Block(_)),
                    _ => false,
                }
            }
            _ => false,
        },
        _ => false,
    }
}

fn is_outer_variable_in_destructing<'a>(name: Name<'a>, init_scope: Scope<'a>, file: &'a File<'a>) -> bool {
    // ESLint resolves a reference to a global of the configuration, except in `through` of the
    // global scope, which it is taken out of.
    let is_global = || {
        init_scope.kind() != ScopeKind::Global && ast_utils::is_configured_global(file, name.bytes())
    };
    if init_scope.through().any(|it| it.name() == name && (it.symbol().is_some() || is_global())) {
        return true;
    }
    let variable = init_scope.resolve_name(name);
    variable.is_some_and(|it| it.declarations().any(|def| matches!(def, Declaration::Param(_))))
}

/// `left`: the left of an `AssignmentExpression`.
fn has_outer_variables<'a>(left: Expr<'a>, scope: Scope<'a>) -> bool {
    let is_outer = |name| is_outer_variable_in_destructing(name, scope, left.file());
    match left.kind() {
        ExprKind::Object(properties) => properties
            .iter()
            .filter(|it| it.kind() != PropKind::Spread)
            .filter_map(|it| it.value()?.as_ident())
            .any(is_outer),
        ExprKind::Array(elements) => elements.iter().filter_map(Expr::as_ident).any(is_outer),
        _ => false,
    }
}

fn has_member_expression_assignment(node: Expr) -> bool {
    match node.kind() {
        ExprKind::Object(properties) => {
            properties.iter().filter_map(Prop::value).any(has_member_expression_assignment)
        }
        ExprKind::Array(elements) => elements.iter().any(has_member_expression_assignment),
        ExprKind::Assign { target, .. } => has_member_expression_assignment(target),
        ExprKind::Dot { .. } | ExprKind::Index { .. } => true,
        _ => false,
    }
}

/// The `VarDecl` or the `Expr` that is an assignment which `reference` is written by.
fn get_destructuring_host<'a>(reference: Reference<'a>) -> Option<Node<'a>> {
    if !reference.is_write() {
        return None;
    }
    let node = skip_patterns(reference.node());
    match node {
        Node::VarDecl(_) => Some(node),
        Node::Expr(e) if e.tag() == ExprTag::Assign => Some(node),
        _ => None,
    }
}

/// Whether `host` can write to several variables.
fn is_destructuring(host: Node) -> bool {
    match host {
        Node::VarDecl(declarator) => declarator.pat().tag() != PatTag::Ident,
        Node::Expr(e) => {
            matches!(e.kind(), ExprKind::Assign { target, .. } if target.tag() != ExprTag::Ident)
        }
        _ => false,
    }
}

/// ESLint's `findUp(identifier, "VariableDeclaration", ..)`.
fn find_variable_declaration<'a>(identifier: Node<'a>) -> Option<(Stmt<'a>, List<'a, VarDecl<'a>>)> {
    let Node::Pat(_) = identifier else {
        return None;
    };
    let Node::VarDecl(declarator) = skip_patterns(identifier) else {
        return None;
    };
    let Node::Stmt(statement) = declarator.parent() else {
        return None;
    };
    match statement.kind() {
        StmtKind::Var(declarations) => Some((statement, declarations)),
        _ => None,
    }
}

/// The identifiers to report, or `None` for a variable that stays as it is, by what writes to
/// them, in the order of ESLint's `Map`.
#[derive(Default)]
struct Groups<'a> {
    index: FxHashMap<Node<'a>, usize>,
    nodes: Vec<SmallVec<[Option<Node<'a>>; 2]>>,
}

impl<'a> Groups<'a> {
    fn push(&mut self, host: Node<'a>, identifier: Option<Node<'a>>) {
        let next = self.nodes.len();
        let at = *self.index.entry(host).or_insert(next);
        if at == next {
            self.nodes.push(SmallVec::new());
        }
        if let Some(group) = self.nodes.get_mut(at) {
            group.push(identifier);
        }
    }
}

/// What ESLint's `checkGroup` keeps from one group to the next.
#[derive(Default)]
struct Checked<'a> {
    report_count: usize,
    id: Option<Pat<'a>>,
    /// `None`: the empty string. `Some(None)`: `undefined`.
    name: Option<Option<Name<'a>>>,
}

impl PreferConst {
    fn get_identifier_if_should_be_const<'a>(&self, variable: Symbol<'a>) -> Option<Node<'a>> {
        let scope = variable.scope();
        if scope.kind() == ScopeKind::Global && variable.is_marked_used() {
            return None;
        }
        let mut writer: Option<Reference<'a>> = None;
        let mut is_read_before_init = false;
        for reference in variable.references() {
            if reference.is_write() {
                if writer.is_some_and(|it| it.ident().start() != reference.ident().start()) {
                    return None;
                }
                if let Some(Node::Expr(host)) = get_destructuring_host(reference)
                    && let ExprKind::Assign { target, .. } = host.kind()
                    && (has_outer_variables(target, scope) || has_member_expression_assignment(target))
                {
                    return None;
                }
                writer = Some(reference);
            } else if reference.is_read() && writer.is_none() {
                if self.ignore_read_before_assign {
                    return None;
                }
                is_read_before_init = true;
            }
        }
        let writer = writer?;
        if writer.scope() != scope || !can_become_variable_declaration(writer.node()) {
            return None;
        }
        if !is_read_before_init {
            return Some(writer.node());
        }
        match variable.declarations().next()? {
            Declaration::Var(pat) => Some(Node::Pat(pat)),
            _ => None,
        }
    }

    /// ESLint's `groupByDestructuring`, for one variable.
    fn group<'a>(&self, variable: Symbol<'a>, groups: &mut Groups<'a>) {
        let identifier = self.get_identifier_if_should_be_const(variable);
        let mut previous = None;
        for reference in variable.references() {
            let id = reference.ident().start();
            if previous.replace(id) == Some(id) {
                continue;
            }
            if let Some(host) = get_destructuring_host(reference)
                // A group that is a single `None` has no effect.
                && (identifier.is_some() || is_destructuring(host))
            {
                groups.push(host, identifier);
            }
        }
    }

    fn check_group<'a>(&self, nodes: &[Option<Node<'a>>], checked: &mut Checked<'a>, cx: &Cx<'a, Self>) {
        let count = nodes.iter().flatten().count();
        if !self.should_match_any_destructured_variable && count != nodes.len() {
            return;
        }
        let parent = nodes.first().copied().flatten().and_then(find_variable_declaration);

        if let Some((_, declarations)) = parent
            && let Some(first) = declarations.first()
            && let Some(init) = first.init()
        {
            let id = first.pat();
            if checked.name != Some(id.as_ident()) {
                checked.name = Some(id.as_ident());
                checked.report_count = 0;
            }
            if id.tag() == PatTag::Object && checked.name != Some(init.as_ident()) {
                checked.name = Some(init.as_ident());
                checked.report_count = 0;
            }
            if checked.id != Some(id) {
                checked.id = Some(id);
                checked.report_count = 0;
            }
        }

        let mut should_fix = count == nodes.len()
            && parent.is_some_and(|(statement, declarations)| {
                matches!(statement.parent(), Node::Stmt(it) if matches!(it.tag(), StmtTag::ForIn | StmtTag::ForOf))
                    || declarations.iter().all(|it| it.init().is_some())
            });

        if let Some((_, declarations)) = parent
            && declarations.len() != 1
        {
            checked.report_count += count;
            let total: usize = declarations
                .iter()
                .map(|it| match it.pat().kind() {
                    PatKind::Object(properties) => properties.len(),
                    PatKind::Array(elements) => elements.len(),
                    _ => 1,
                })
                .sum();
            should_fix = should_fix && checked.report_count == total;
        }

        for &node in nodes.iter().flatten() {
            let name = match node {
                Node::Expr(e) => e.as_ident(),
                Node::Pat(pat) => pat.as_ident(),
                _ => None,
            };
            let Some(name) = name else {
                continue;
            };
            let report = cx.report(utils::estree_span(node), USE_CONST).data("name", name);
            if should_fix && let Some((statement, _)) = parent {
                report.fix(|fixer| {
                    let range = statement.span_without_export();
                    let keyword = fixer.file().tokens_in(range).find(|token| token.is("let"))?;
                    // The whole declaration, so that no other fix changes it in the same pass.
                    Some(FixTracker::new(fixer).retain_range(range).replace_text_range(keyword.span(), "const"))
                });
            }
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut statements = std::mem::take(&mut cx.state);
        statements.sort_unstable_by_key(|it| it.span().start);
        let mut groups = Groups::default();
        for statement in statements {
            let StmtKind::Var(declarations) = statement.kind() else {
                continue;
            };
            for declaration in declarations {
                declaration.pat().for_each_binding(&mut |pat| {
                    if let Some(variable) = pat.symbol() {
                        self.group(variable, &mut groups);
                    }
                });
            }
        }
        let mut checked = Checked::default();
        for nodes in &groups.nodes {
            self.check_group(nodes, &mut checked, cx);
        }
    }
}

impl Rule for PreferConst {
    const META: Meta = Meta::eslint("prefer-const", Kind::Suggestion).fixable(Fixable::Code);
    /// The `let` declarations.
    type State<'a> = Vec<Stmt<'a>>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        PreferConst {
            should_match_any_destructured_variable: object.str("destructuring") != Some("all"),
            ignore_read_before_assign: object.bool_or("ignoreReadBeforeAssign", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Vec<Stmt<'a>> {
        on.stmts([StmtTag::Var], |_, stmt, cx| {
            if let StmtKind::Var(declarations) = stmt.kind()
                && declarations.first().is_some_and(|it| it.var_kind() == VarKind::Let)
                && !is_init_of_for_statement(stmt)
            {
                cx.state.push(stmt);
            }
        });
        on.finish(Self::finish);
        Vec::new()
    }
}
