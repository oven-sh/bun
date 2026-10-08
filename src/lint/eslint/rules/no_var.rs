use bun_lint::prelude::*;
use bun_lint::utils::fix_tracker::FixTracker;

/// Require `let` or `const` instead of `var`.
pub struct NoVar;

const UNEXPECTED_VAR: Message = Message::new("unexpectedVar", "Unexpected var, use let or const instead.");

/// ESLint's `getEnclosingFunctionScope`.
fn get_enclosing_function_scope(scope: Scope<'_>) -> Option<Scope<'_>> {
    scope.chain().find(|it| matches!(it.kind(), ScopeKind::Function | ScopeKind::Global))
}

/// ESLint's `isReferencedInClosure`.
fn is_referenced_in_closure(variable: Symbol<'_>) -> bool {
    let enclosing = get_enclosing_function_scope(variable.scope());
    variable.references().any(|reference| get_enclosing_function_scope(reference.scope()) != enclosing)
}

/// ESLint's `isLoopAssignee`.
fn is_loop_assignee(statement: Stmt<'_>) -> bool {
    matches!(
        statement.parent().as_stmt().map(Stmt::kind),
        Some(StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) if left == statement
    )
}

/// The range of ESLint's `getScopeNode(statement)`.
fn scope_node_span(statement: Stmt<'_>) -> Span {
    let mut child = Node::Stmt(statement);
    loop {
        let parent = child.parent();
        match parent {
            Node::File(file) => return file.span(),
            Node::Stmt(it)
                if matches!(
                    it.kind(),
                    StmtKind::Block(_)
                        | StmtKind::Switch { .. }
                        | StmtKind::For { .. }
                        | StmtKind::ForIn { .. }
                        | StmtKind::ForOf { .. }
                ) =>
            {
                return it.span();
            }
            // The body of a function is a `BlockStatement`. A `StaticBlock` is not a scope node.
            Node::Func(func) if func.kind() != FnKind::StaticBlock && matches!(child, Node::Stmt(_)) => {
                if let Some(body) = func.body_span() {
                    return body;
                }
            }
            _ => {}
        }
        child = parent;
    }
}

/// ESLint's `hasSelfReferenceInTDZ`.
fn has_self_reference_in_tdz(declarator: VarDecl<'_>) -> bool {
    let Some(init) = declarator.init() else {
        return false;
    };
    let init_span = (!ast_utils::is_function(init)).then(|| init.span());
    Node::VarDecl(declarator).declared_symbols().into_iter().any(|variable| {
        let Some(first) = variable.declarations().next() else {
            return false;
        };
        let Some(id) = first.name_span() else {
            return false;
        };
        let default_value = match first {
            Declaration::Var(pat) | Declaration::Param(pat) => match pat.parent() {
                Node::PatProp(prop) => prop.default(),
                Node::PatElem(element) => element.default(),
                Node::Param(param) => param.default(),
                _ => None,
            },
            _ => None,
        };
        let default_span = default_value.map(Expr::span);
        variable.references().any(|reference| {
            let at = reference.span();
            !reference.is_init()
                && (at.start < id.start
                    || default_span.is_some_and(|it| it.contains(at))
                    || init_span.is_some_and(|it| it.contains(at)))
        })
    })
}

/// ESLint's `hasUnsafeHoistedFunctionReference`. `declaration_start`: where the declarator starts.
fn has_unsafe_hoisted_function_reference(variable: Symbol<'_>, declaration_start: u32) -> bool {
    let home = variable.scope();
    for reference in variable.references() {
        if reference.is_init() || reference.span().start < declaration_start {
            continue;
        }
        let mut current = reference.scope().variable_scope();
        while current != home {
            if let Node::Func(func) = current.node()
                && func.kind() == FnKind::Decl
                && func.has_body()
                && let Some(name) = func.name()
                && let Some(function) = current.parent().and_then(|upper| upper.get_name(name.name()))
                && function.references().any(|it| {
                    it.span().start < declaration_start && it.expr().is_some_and(ast_utils::is_callee)
                })
            {
                return true;
            }
            match current.parent() {
                Some(upper) => current = upper.variable_scope(),
                None => break,
            }
        }
    }
    false
}

/// ESLint's `canFix`.
fn can_fix<'a>(statement: Stmt<'a>, declarations: List<'a, VarDecl<'a>>) -> bool {
    let parent = statement.parent();
    // Its parent is an `ExportNamedDeclaration`.
    if statement.is_exported() || matches!(parent, Node::Case(_)) {
        return false;
    }
    let is_in_statement_list = ast_utils::is_statement_list_parent(parent)
        || matches!(parent, Node::Stmt(it) if it.tag() == StmtTag::Module);
    if !is_in_statement_list && !utils::is_for_init(statement) {
        return false;
    }
    if declarations.iter().any(has_self_reference_in_tdz) {
        return false;
    }

    let variables = Node::Stmt(statement).declared_symbols();
    let scope_node = scope_node_span(statement);
    let scope = Node::Stmt(statement).scope();
    let cannot_be_let = |variable: Symbol<'a>| {
        if variable.scope().kind() == ScopeKind::Global
            || variable.declarations().len() >= 2
            || variable.name().is("let")
            || variable.references().any(|reference| !scope_node.contains(reference.span()))
            // A `catch` parameter shadows it.
            || scope.resolve_name(variable.name()) != Some(variable)
        {
            return true;
        }
        let Some(declarator) = variable.declarations().next().and_then(Declaration::node) else {
            return true;
        };
        let declaration_start = declarator.span().start;
        variable.references().any(|reference| !reference.is_init() && reference.span().start < declaration_start)
            || has_unsafe_hoisted_function_reference(variable, declaration_start)
    };
    if variables.iter().any(|&variable| cannot_be_let(variable)) {
        return false;
    }

    if ast_utils::is_in_loop(statement) {
        if variables.iter().any(|&variable| is_referenced_in_closure(variable)) {
            return false;
        }
        if !is_loop_assignee(statement) && !declarations.iter().all(|it| it.init().is_some()) {
            return false;
        }
    }
    true
}

/// The `var` of `statement`, which modifiers can precede.
fn var_keyword(statement: Stmt<'_>) -> Option<Span> {
    let source = statement.file().text();
    let start = match statement.modifiers().last() {
        Some(last) => skip_trivia(source, last.span().end),
        None => statement.span().start,
    };
    source.get(start as usize..)?.starts_with(b"var").then(|| Span::new(start, start + 3))
}

impl NoVar {
    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(declarations) = statement.kind() else {
            return;
        };
        if declarations.first().is_none_or(|it| it.var_kind() != VarKind::Var) {
            return;
        }
        if let Node::Stmt(parent) = statement.parent()
            && let StmtKind::Module(module) = parent.kind()
            && matches!(module.name(), ModuleName::Global)
            && !statement.is_exported()
        {
            return;
        }
        let span = statement.span_without_export();
        cx.report(span, UNEXPECTED_VAR).fix(|fixer| {
            let var = var_keyword(statement)?;
            can_fix(statement, declarations)
                .then(|| FixTracker::new(fixer).retain_range(span).replace_text_range(var, "let"))
        });
    }
}

impl Rule for NoVar {
    const META: Meta = Meta::eslint("no-var", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoVar
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Var], Self::check);
    }
}
