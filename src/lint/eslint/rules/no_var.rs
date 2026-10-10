use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::oxlint::AmbientAncestors;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::cell::RefCell;

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

/// What the fixes of a file find out.
#[derive(Default)]
pub struct State<'a> {
    /// Where a function is called first.
    first_calls: RefCell<FxHashMap<Symbol<'a>, u32>>,
    /// ESLint's `isInLoop`
    loops: RefCell<AncestorMemo<'a, bool>>,
    ambient: AmbientAncestors<'a>,
}

impl<'a> State<'a> {
    /// Where the first call of `function` starts.
    fn first_call(&self, function: Symbol<'a>) -> u32 {
        *self.first_calls.borrow_mut().entry(function).or_insert_with(|| {
            let calls = function.references().filter(|it| it.expr().is_some_and(ast_utils::is_callee));
            calls.map(|it| it.span().start).min().unwrap_or(u32::MAX)
        })
    }

    fn is_in_loop(&self, statement: Stmt<'a>) -> bool {
        let is_in_loop = self.loops.borrow_mut().find(statement.into(), |_, parent| {
            match ast_utils::is_function(parent) {
                true => Some(false),
                false => ast_utils::is_loop(parent).then_some(true),
            }
        });
        is_in_loop == Some(true)
    }

    /// ESLint's `hasUnsafeHoistedFunctionReference`. `declaration_start`: where the declarator starts.
    fn has_unsafe_hoisted_function_reference(&self, variable: Symbol<'a>, declaration_start: u32) -> bool {
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
                    && self.first_call(function) < declaration_start
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
    fn can_fix(&self, statement: Stmt<'a>, declarations: List<'a, VarDecl<'a>>) -> bool {
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

        // What takes no look at the references comes first: those of a variable that is declared once
        // are then looked at for one declaration.
        let variables = Node::Stmt(statement).declared_symbols();
        let is_never_let = |variable: &Symbol<'a>| {
            variable.scope().kind() == ScopeKind::Global
                || variable.declarations().len() >= 2
                || variable.name().is("let")
        };
        if variables.iter().any(is_never_let) || declarations.iter().any(has_self_reference_in_tdz) {
            return false;
        }

        let scope_node = scope_node_span(statement);
        let scope = Node::Stmt(statement).scope();
        let cannot_be_let = |variable: Symbol<'a>| {
            if variable.references().any(|reference| !scope_node.contains(reference.span()))
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
                || self.has_unsafe_hoisted_function_reference(variable, declaration_start)
        };
        if variables.iter().any(|&variable| cannot_be_let(variable)) {
            return false;
        }

        if self.is_in_loop(statement) {
            if variables.iter().any(|&variable| is_referenced_in_closure(variable)) {
                return false;
            }
            if !is_loop_assignee(statement) && !declarations.iter().all(|it| it.init().is_some()) {
                return false;
            }
        }
        true
    }
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

/// oxlint's `is_written_to`: something is assigned to one of the variables after the declaration. A default value
/// counts as that, and the rest element of an array pattern is not looked at.
fn oxlint_is_written_to(pat: Pat) -> bool {
    let mut pending: SmallVec<[Pat; 8]> = smallvec![pat];
    while let Some(pat) = pending.pop() {
        match pat.kind() {
            PatKind::Missing => {}
            PatKind::Ident(_) => {
                if pat.symbol().is_some_and(|it| it.references().any(|it| it.is_write() && !it.is_init())) {
                    return true;
                }
            }
            PatKind::Object(props) => {
                if props.iter().any(|it| it.default().is_some()) {
                    return true;
                }
                pending.extend(props.iter().map(PatProp::value));
            }
            PatKind::Array(elems) => {
                if elems.iter().any(|it| it.default().is_some()) {
                    return true;
                }
                pending.extend(elems.iter().filter(|it| !it.is_rest()).filter_map(PatElem::pat));
            }
        }
    }
    false
}

/// The fix of oxlint 1.87. There is none if a variable is referred to outside of what the declaration is in. It is
/// `const` if nothing is assigned later and all have a value. All of the declaration is replaced, so that no other fix
/// changes it in the same pass.
fn fix_as_oxlint<'a>(fixer: Fixer<'a>, statement: Stmt<'a>, declarations: List<'a, VarDecl<'a>>) -> Option<Fix> {
    let var = var_keyword(statement)?;
    // A variable does not leave the function or the file.
    let around = match statement.parent() {
        _ if statement.is_exported() => Some(statement.span()),
        Node::Stmt(parent) => Some(parent.span()),
        Node::Case(case) => Some(case.span()),
        _ => None,
    };
    if let Some(around) = around {
        let mut leaves = false;
        for declaration in declarations {
            declaration.pat().for_each_binding(&mut |pat| {
                leaves |= pat.symbol().is_some_and(|it| it.references().any(|it| !around.contains(it.span())));
            });
        }
        if leaves {
            return None;
        }
    }
    let is_let = statement.flags().contains(Flags::AMBIENT)
        || declarations.iter().any(|it| it.init().is_none() || oxlint_is_written_to(it.pat()));
    let (file, span) = (fixer.file(), statement.span_without_export());
    let before = file.slice(Span::before(span.start, var));
    let after = file.slice(Span::after(var, span.end));
    let keyword: &[u8] = if is_let { b"let" } else { b"const" };
    Some(fixer.replace(span, [before, keyword, after].concat()))
}

impl Rule for NoVar {
    const META: Meta = Meta::eslint("no-var", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Var]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoVar
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
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
        // oxlint says nothing about ambient declarations, and points at the keyword.
        let is_oxlint = cx.language().is_oxlint;
        if is_oxlint && cx.state.ambient.has_ambient_typescript_ancestor(statement.into()) {
            return;
        }
        let place = var_keyword(statement).filter(|_| is_oxlint).unwrap_or(span);
        cx.report(place, UNEXPECTED_VAR).fix(|fixer| {
            if is_oxlint {
                return fix_as_oxlint(fixer, statement, declarations);
            }
            let var = var_keyword(statement)?;
            cx.state.can_fix(statement, declarations).then(|| fixer.replace(var, "let"))
        });
    }
}
