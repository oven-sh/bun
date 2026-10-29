use bun_lint::prelude::*;
use bun_lint::types::IdMap;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::oxlint::AmbientAncestors;
use smallvec::{SmallVec, smallvec};
use std::cell::RefCell;

/// Require `let` or `const` instead of `var`.
pub struct NoVar;

const UNEXPECTED_VAR: Message =
    Message::new("unexpectedVar", "Unexpected var, use let or const instead.");

/// ESLint's `getEnclosingFunctionScope`.
fn get_enclosing_function_scope(scope: Scope<'_>) -> Option<Scope<'_>> {
    scope
        .chain()
        .find(|it| matches!(it.kind(), ScopeKind::Function | ScopeKind::Global))
}

/// ESLint's `isReferencedInClosure`.
fn is_referenced_in_closure(variable: Symbol<'_>) -> bool {
    let enclosing = get_enclosing_function_scope(variable.scope());
    variable
        .references()
        .any(|reference| get_enclosing_function_scope(reference.scope()) != enclosing)
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
            // A function's body is a `BlockStatement`. A `StaticBlock` isn't a scope node.
            Node::Func(func)
                if func.kind() != FnKind::StaticBlock && matches!(child, Node::Stmt(_)) =>
            {
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
    Node::VarDecl(declarator)
        .declared_symbols()
        .into_iter()
        .any(|variable| {
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

/// Per-file caches for the fixes.
#[derive(Default)]
pub struct State<'a> {
    /// The start offset of each function's first call.
    first_calls: RefCell<IdMap<Symbol<'a>, u32>>,
    /// ESLint's `isInLoop`
    loops: RefCell<AncestorMemo<'a, bool>>,
    ambient: AmbientAncestors<'a>,
}

impl<'a> State<'a> {
    /// Returns the start offset of the first call to `function`.
    fn first_call(&self, function: Symbol<'a>) -> u32 {
        *self
            .first_calls
            .borrow_mut()
            .get_or_insert_with(function, || {
                let calls = function
                    .references()
                    .filter(|it| it.expr().is_some_and(ast_utils::is_callee));
                calls.map(|it| it.span().start).min().unwrap_or(u32::MAX)
            })
    }

    fn is_in_loop(&self, statement: Stmt<'a>) -> bool {
        let is_in_loop =
            self.loops.borrow_mut().find(
                statement.into(),
                |_, parent| match ast_utils::is_function(parent) {
                    true => Some(false),
                    false => ast_utils::is_loop(parent).then_some(true),
                },
            );
        is_in_loop == Some(true)
    }

    /// ESLint's `hasUnsafeHoistedFunctionReference`. `declaration_start` is the declarator's start offset.
    fn has_unsafe_hoisted_function_reference(
        &self,
        variable: Symbol<'a>,
        declaration_start: u32,
    ) -> bool {
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
                    && let Some(function) = current
                        .parent()
                        .and_then(|upper| upper.get_name(name.name()))
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
            || matches!(parent, Node::Stmt(it) if it.tag() == StmtTag::Module)
                && knows_typescript(statement.file());
        if !is_in_statement_list && !utils::is_for_init(statement) {
            return false;
        }

        // The checks that don't need the references come first. After them every variable is declared once, so its
        // references are only scanned for one declaration.
        let variables = Node::Stmt(statement).declared_symbols();
        let is_never_let = |variable: &Symbol<'a>| {
            variable.scope().kind() == ScopeKind::Global
                || variable.declarations().len() >= 2
                || variable.name().is("let")
        };
        if variables.iter().any(is_never_let) || declarations.iter().any(has_self_reference_in_tdz)
        {
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
            let Some(declarator) = variable.declarations().next().and_then(Declaration::node)
            else {
                return true;
            };
            let declaration_start = declarator.span().start;
            variable
                .references()
                .any(|reference| !reference.is_init() && reference.span().start < declaration_start)
                || self.has_unsafe_hoisted_function_reference(variable, declaration_start)
        };
        if variables.iter().any(|&variable| cannot_be_let(variable)) {
            return false;
        }

        if self.is_in_loop(statement) {
            if variables
                .iter()
                .any(|&variable| is_referenced_in_closure(variable))
            {
                return false;
            }
            if !is_loop_assignee(statement) && !declarations.iter().all(|it| it.init().is_some()) {
                return false;
            }
        }
        true
    }
}

/// True if the rule treats TypeScript's blocks as ESLint 9 and later do. ESLint 8's rule only knows JavaScript.
fn knows_typescript(file: &File<'_>) -> bool {
    file.language().eslint_major >= 9
}

/// True if `node` is a `global { }` block.
fn is_global_block(node: Node<'_>) -> bool {
    let module = node.as_stmt().and_then(Stmt::as_module);
    module.is_some_and(|it| matches!(it.name(), ModuleName::Global))
}

/// Returns the `var` keyword of `statement`, which can come after modifiers.
fn var_keyword(statement: Stmt<'_>) -> Option<Span> {
    let source = statement.file().text();
    let start = match statement.modifiers().last() {
        Some(last) => skip_trivia(source, last.span().end),
        None => statement.span().start,
    };
    source
        .get(start as usize..)?
        .starts_with(b"var")
        .then(|| Span::new(start, start + 3))
}

/// oxlint's `is_written_to`: true if one of the variables is assigned after the declaration. A default value counts as
/// an assignment, and an array pattern's rest element isn't checked.
fn oxlint_is_written_to(pat: Pat) -> bool {
    let mut pending: SmallVec<[Pat; 8]> = smallvec![pat];
    while let Some(pat) = pending.pop() {
        match pat.kind() {
            PatKind::Missing => {}
            PatKind::Ident(_) => {
                if pat
                    .symbol()
                    .is_some_and(|it| it.references().any(|it| it.is_write() && !it.is_init()))
                {
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
                pending.extend(
                    elems
                        .iter()
                        .filter(|it| !it.is_rest())
                        .filter_map(PatElem::pat),
                );
            }
        }
    }
    false
}

/// oxlint 1.87's fix. There's none if a variable is referenced outside the declaration's parent. The keyword is `const`
/// if nothing is assigned later and every variable has an initializer. The fix replaces the whole declaration, so that
/// no other fix changes it in the same pass.
fn fix_as_oxlint<'a>(
    fixer: Fixer<'a>,
    statement: Stmt<'a>,
    declarations: List<'a, VarDecl<'a>>,
) -> Option<Fix> {
    let var = var_keyword(statement)?;
    // A variable can't escape the file. A parameter's default value is outside the function's body.
    let enclosing_span = match statement.parent() {
        _ if statement.is_exported() => Some(statement.span()),
        Node::Stmt(parent) => Some(parent.span()),
        Node::Case(case) => Some(case.span()),
        Node::Func(func) => func.body_span(),
        _ => None,
    };
    if let Some(enclosing_span) = enclosing_span {
        let is_body = matches!(statement.parent(), Node::Func(_));
        let mut escapes = false;
        for declaration in declarations {
            declaration.pat().for_each_binding(&mut |pat| {
                // oxlint doesn't count a parameter getting its default value as a reference.
                escapes |= pat.symbol().is_some_and(|it| {
                    it.references()
                        .any(|it| !enclosing_span.contains(it.span()) && !(is_body && it.is_init()))
                });
            });
        }
        if escapes {
            return None;
        }
    }
    let is_let = declarations
        .iter()
        .any(|it| it.init().is_none() || oxlint_is_written_to(it.pat()));
    let (file, span) = (fixer.file(), statement.span_without_export());
    let before = file.slice(Span::before(span.start, var));
    let after = file.slice(Span::after(var, span.end));
    let keyword: &[u8] = if is_let { b"let" } else { b"const" };
    Some(fixer.replace(span, [before, keyword, after].concat()))
}

impl Rule for NoVar {
    const META: Meta = Meta::eslint("no-var", Kind::Suggestion)
        .fixable(Fixable::Code)
        .reports_on_exit();
    const ON: On = On::new().stmts(&[StmtTag::Var]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoVar
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // `const`, `let`
        if matches!(
            cx.text().get(statement.span().start as usize),
            Some(b'c' | b'l')
        ) {
            return;
        }
        let Some(declarations) = statement.as_var() else {
            return;
        };
        if declarations
            .first()
            .is_none_or(|it| it.var_kind() != VarKind::Var)
        {
            return;
        }
        let span = statement.span_without_export();
        let is_oxlint = cx.language().is_oxlint;
        let is_eslint = !is_oxlint && !cx.language().has_no_foreign_config;
        // ESLint reports every ambient `var` that isn't directly in a `global` block, and projects have comments that
        // disable those reports. ESLint 8 reports that one too. oxlint reports `declare var`, but no `var` in an ambient
        // block.
        // Without either config, no ambient `var` is reported. It declares that a global exists. Only a `var` becomes a
        // property of `globalThis`, and only a `var` can be declared in two files, so with `let` the project would stop
        // type checking.
        let is_allowed = match is_eslint {
            true => {
                knows_typescript(cx)
                    && !statement.is_exported()
                    && is_global_block(statement.parent())
            }
            false => {
                (!is_oxlint && statement.flags().contains(Flags::AMBIENT))
                    || cx
                        .state
                        .ambient
                        .has_ambient_typescript_ancestor(statement.into())
            }
        };
        if is_allowed {
            return;
        }
        // oxlint reports only the `var` keyword.
        let location = var_keyword(statement).filter(|_| is_oxlint).unwrap_or(span);
        cx.report(location, UNEXPECTED_VAR)
            .called_with(statement)
            .fix(|fixer| {
                if is_oxlint {
                    return fix_as_oxlint(fixer, statement, declarations);
                }
                let var = var_keyword(statement)?;
                cx.state
                    .can_fix(statement, declarations)
                    .then(|| fixer.replace(var, "let"))
            });
    }
}
