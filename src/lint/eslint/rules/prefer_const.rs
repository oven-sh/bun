use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
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

/// The ways out of patterns. In a deep one they are long, and many start in it: they are remembered.
#[derive(Default)]
struct Patterns<'a> {
    /// By a part of a pattern in a declaration or a parameter.
    declared: AncestorMemo<'a, Node<'a>>,
    /// By a part of a pattern that is assigned to.
    assigned: AncestorMemo<'a, Node<'a>>,
}

impl<'a> Patterns<'a> {
    /// The first ancestor of `identifier`, an `Expr` or a `Pat`, whose type does not match ESLint's
    /// `PATTERN_TYPE`: it is no `Pattern` and no `RestElement`.
    fn skip(&mut self, identifier: Node<'a>) -> Node<'a> {
        let Node::Expr(at) = identifier else {
            let found = self.declared.find(identifier, |_, parent| {
                (!matches!(parent, Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_))).then_some(parent)
            });
            return found.unwrap_or(identifier);
        };
        let parent = match at.parent() {
            Node::Prop(property) => property.parent(),
            parent => parent,
        };
        let Node::Expr(e) = parent else {
            return parent;
        };
        let is_pattern = match e.kind() {
            ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Spread(_) => utils::is_assignment_target(e),
            ExprKind::Assign { target, .. } => target == at && utils::is_assignment_target(e),
            _ => false,
        };
        if !is_pattern {
            return parent;
        }
        // What is around a part of a pattern, up to the next assignment, is a part of it too.
        let found = self.assigned.find(parent, |child, parent| match (child, parent) {
            (Node::Expr(_), Node::Prop(_)) => None,
            (_, Node::Expr(e)) => {
                let is_pattern = match e.kind() {
                    ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Spread(_) => true,
                    ExprKind::Assign { target, .. } => {
                        Node::Expr(target) == child && utils::is_assignment_target(e)
                    }
                    _ => false,
                };
                (!is_pattern).then_some(parent)
            }
            _ => Some(parent),
        });
        found.unwrap_or(parent)
    }
}

fn can_become_variable_declaration<'a>(identifier: Node<'a>, patterns: &mut Patterns<'a>) -> bool {
    match patterns.skip(identifier) {
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

/// Whether `scope.through` has a reference to a variable called `name`, which the configuration
/// defines if `is_global`.
fn is_name_in_through<'a>(scope: Scope<'a>, name: Name<'a>, is_global: bool) -> bool {
    if !is_global {
        // It is a reference to one of the variables of that name around the scope. If these have
        // few, that is sooner said than by all the references in the scope.
        let outer = scope.chain().skip(1).filter_map(|it| it.get_name(name));
        let mut references = outer.flat_map(Symbol::references);
        for _ in 0..64 {
            match references.next() {
                Some(reference) if scope.contains(reference.scope()) => return true,
                Some(_) => {}
                None => return false,
            }
        }
    }
    scope.through().any(|it| it.name() == name && (it.symbol().is_some() || is_global))
}

/// What has been found out about the variables, the scopes and the assignments of the file.
#[derive(Default)]
struct Known<'a> {
    /// Whether `scope.through` has a reference to a variable of that name.
    through: FxHashMap<(Scope<'a>, Name<'a>), bool>,
    /// Whether an assignment to a pattern keeps the variables of a scope from being `const`.
    assignments: FxHashMap<(Expr<'a>, Scope<'a>), bool>,
    /// For a variable that is declared more than once: the identifier to report, and what writes
    /// to it if there is one.
    redeclared: FxHashMap<Symbol<'a>, (Option<Node<'a>>, SmallVec<[Node<'a>; 1]>)>,
    patterns: Patterns<'a>,
}

impl<'a> Known<'a> {
    fn is_outer_variable_in_destructing(&mut self, name: Name<'a>, init_scope: Scope<'a>, file: &'a File<'a>) -> bool {
        // ESLint resolves a reference to a global of the configuration, except in `through` of the
        // global scope, which it is taken out of.
        let is_global =
            init_scope.kind() != ScopeKind::Global && ast_utils::is_configured_global(file, name.bytes());
        // Only to what has the name outside of the scope can a reference lead out of it.
        if (is_global || init_scope.parent().is_some_and(|it| it.resolve_name(name).is_some()))
            && (self.through.entry((init_scope, name)))
                .or_insert_with(|| is_name_in_through(init_scope, name, is_global))
                .to_owned()
        {
            return true;
        }
        let variable = init_scope.resolve_name(name);
        variable.is_some_and(|it| it.declarations().any(|def| matches!(def, Declaration::Param(_))))
    }

    /// `left`: the left of an `AssignmentExpression`.
    fn has_outer_variables(&mut self, left: Expr<'a>, scope: Scope<'a>) -> bool {
        let is_outer = |name| self.is_outer_variable_in_destructing(name, scope, left.file());
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

    /// Whether `host`, which assigns to `left`, also assigns to what cannot be declared with the
    /// variables of `scope`. Each of the variables that it writes to asks.
    fn assigns_to_others(&mut self, host: Expr<'a>, left: Expr<'a>, scope: Scope<'a>) -> bool {
        if left.tag() == ExprTag::Ident {
            return false;
        }
        if let Some(&known) = self.assignments.get(&(host, scope)) {
            return known;
        }
        let found = self.has_outer_variables(left, scope) || has_member_expression_assignment(left);
        self.assignments.insert((host, scope), found);
        found
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
fn get_destructuring_host<'a>(reference: Reference<'a>, patterns: &mut Patterns<'a>) -> Option<Node<'a>> {
    if !reference.is_write() {
        return None;
    }
    let node = patterns.skip(reference.node());
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
fn find_variable_declaration<'a>(
    identifier: Node<'a>,
    patterns: &mut Patterns<'a>,
) -> Option<(Stmt<'a>, List<'a, VarDecl<'a>>)> {
    let Node::Pat(_) = identifier else {
        return None;
    };
    let Node::VarDecl(declarator) = patterns.skip(identifier) else {
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
    /// Of the declaration that the last group was in. The groups of a declaration follow each other.
    declaration: Option<(Stmt<'a>, DeclarationFacts)>,
}

#[derive(Copy, Clone)]
struct DeclarationFacts {
    is_single: bool,
    is_all_initialized: bool,
    /// How many elements the patterns have, and how many declarators have none.
    element_count: usize,
}

impl<'a> Checked<'a> {
    fn facts_of(&mut self, statement: Stmt<'a>, declarations: List<'a, VarDecl<'a>>) -> DeclarationFacts {
        if let Some((known, facts)) = self.declaration
            && known == statement
        {
            return facts;
        }
        let (mut count, mut element_count, mut is_all_initialized) = (0, 0, true);
        for declaration in declarations {
            count += 1;
            is_all_initialized &= declaration.init().is_some();
            element_count += match declaration.pat().kind() {
                PatKind::Object(properties) => properties.len(),
                PatKind::Array(elements) => elements.len(),
                _ => 1,
            };
        }
        let facts = DeclarationFacts {
            is_single: count == 1,
            is_all_initialized,
            element_count,
        };
        self.declaration = Some((statement, facts));
        facts
    }
}

impl PreferConst {
    fn get_identifier_if_should_be_const<'a>(
        &self,
        variable: Symbol<'a>,
        known: &mut Known<'a>,
    ) -> Option<Node<'a>> {
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
                if let Some(Node::Expr(host)) = get_destructuring_host(reference, &mut known.patterns)
                    && let ExprKind::Assign { target, .. } = host.kind()
                    && known.assigns_to_others(host, target, scope)
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
        // For oxlint `a ??= 1` and `a += 1` are no first assignment.
        if writer.is_read() && variable.file().language().is_oxlint {
            return None;
        }
        if writer.scope() != scope || !can_become_variable_declaration(writer.node(), &mut known.patterns) {
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
    fn group<'a>(&self, variable: Symbol<'a>, groups: &mut Groups<'a>, known: &mut Known<'a>) {
        let is_redeclared = variable.declarations().len() > 1;
        if is_redeclared && let Some((identifier, hosts)) = known.redeclared.get(&variable) {
            for &host in hosts {
                groups.push(host, *identifier);
            }
            return;
        }
        let identifier = self.get_identifier_if_should_be_const(variable, known);
        let mut hosts = SmallVec::new();
        let mut previous = None;
        for reference in variable.references() {
            let id = reference.ident().start();
            if previous.replace(id) == Some(id) {
                continue;
            }
            if let Some(host) = get_destructuring_host(reference, &mut known.patterns)
                // A group that is a single `None` has no effect.
                && (identifier.is_some() || is_destructuring(host))
            {
                groups.push(host, identifier);
                // One `None` in a group is as good as several.
                if is_redeclared && identifier.is_some() {
                    hosts.push(host);
                }
            }
        }
        if is_redeclared {
            known.redeclared.insert(variable, (identifier, hosts));
        }
    }

    fn check_group<'a>(
        &self,
        nodes: &[Option<Node<'a>>],
        checked: &mut Checked<'a>,
        patterns: &mut Patterns<'a>,
        cx: &Cx<'a, Self>,
    ) {
        let count = nodes.iter().flatten().count();
        if !self.should_match_any_destructured_variable && count != nodes.len() {
            return;
        }
        let first = nodes.first().copied().flatten();
        let parent = first.and_then(|it| find_variable_declaration(it, patterns));

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

        let facts = parent.map(|(statement, declarations)| checked.facts_of(statement, declarations));
        let mut should_fix = count == nodes.len()
            && parent.zip(facts).is_some_and(|((statement, _), facts)| {
                matches!(statement.parent(), Node::Stmt(it) if matches!(it.tag(), StmtTag::ForIn | StmtTag::ForOf))
                    || facts.is_all_initialized
            });

        if let Some(facts) = facts
            && !facts.is_single
        {
            checked.report_count += count;
            should_fix = should_fix && checked.report_count == facts.element_count;
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
            // oxlint points at the declaration, also of what is assigned later, without its type annotation.
            let declared = match node {
                Node::Pat(pat) if cx.language().is_oxlint => Some(pat.span()),
                Node::Expr(e) if cx.language().is_oxlint => {
                    e.symbol().and_then(|it| it.declarations().next()?.name_span())
                }
                _ => None,
            };
            let place = declared.unwrap_or_else(|| utils::estree_span(node));
            let report = cx.report(place, USE_CONST).data("name", name);
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
}

impl Rule for PreferConst {
    const META: Meta = Meta::eslint("prefer-const", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Var]).finish();
    /// The `let` declarations.
    type State<'a> = Vec<Stmt<'a>>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        PreferConst {
            should_match_any_destructured_variable: object.str("destructuring") != Some("all"),
            ignore_read_before_assign: object.bool_or("ignoreReadBeforeAssign", false),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Vec<Stmt<'a>>> {
        Some(Vec::new())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Var(declarations) = stmt.kind()
            && declarations.first().is_some_and(|it| it.var_kind() == VarKind::Let)
            && (!is_init_of_for_statement(stmt) || cx.language().is_oxlint)
        {
            cx.state.push(stmt);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut statements = std::mem::take(&mut cx.state);
        utils::sort::sort_unstable_by_key(&mut statements, |it| it.span().start);
        let (mut groups, mut known) = (Groups::default(), Known::default());
        for statement in statements {
            let StmtKind::Var(declarations) = statement.kind() else {
                continue;
            };
            // Which only oxlint looks at: all of the variables or none.
            if declarations.len() > 1 && is_init_of_for_statement(statement) {
                let mut is_all_const = true;
                for declaration in declarations {
                    declaration.pat().for_each_binding(&mut |pat| {
                        let variable = pat.symbol().filter(|_| is_all_const);
                        is_all_const =
                            variable.is_some_and(|it| self.get_identifier_if_should_be_const(it, &mut known).is_some());
                    });
                }
                if !is_all_const {
                    continue;
                }
            }
            for declaration in declarations {
                declaration.pat().for_each_binding(&mut |pat| {
                    if let Some(variable) = pat.symbol() {
                        self.group(variable, &mut groups, &mut known);
                    }
                });
            }
        }
        let mut checked = Checked::default();
        for nodes in &groups.nodes {
            self.check_group(nodes, &mut checked, &mut known.patterns, cx);
        }
    }
}
