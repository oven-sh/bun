use bun_lint::prelude::*;
use bun_lint::utils::fix_tracker::FixTracker;

/// Disallow `else` blocks after `return` statements in `if` statements.
pub struct NoElseReturn {
    allows_else_if: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unnecessary 'else' after 'return'.");

/// ESLint's `isSafeToDeclare`: true if `names` can be declared in `scope` without a conflict and without capturing a
/// reference.
fn is_safe_to_declare<'a>(names: &[Name<'a>], scope: Scope<'a>) -> bool {
    if names.is_empty() {
        return true;
    }
    let function_scope = scope.variable_scope();
    // Names that are declared here, or `arguments` if it's used.
    let is_taken = |symbol: Symbol<'a>| {
        names.contains(&symbol.name())
            && (symbol.declarations().next().is_some() || symbol.references().next().is_some())
    };
    if scope.symbols().any(is_taken) {
        return false;
    }
    if scope != function_scope
        && let Some(upper) = scope.parent()
        && upper.kind() == ScopeKind::Catch
        && upper.symbols().any(|it| names.contains(&it.name()))
    {
        return false;
    }
    if scope.through().any(|it| names.contains(&it.name())) {
        return false;
    }
    // A `var` in this block is hoisted out of it.
    if scope != function_scope {
        let block = scope.span();
        let is_declared_in_block = |symbol: Symbol<'a>| {
            let mut nodes = symbol.declarations().filter_map(Declaration::node);
            nodes.any(|node| block.contains(utils::estree_span(node)))
        };
        if function_scope
            .symbols()
            .any(|it| names.contains(&it.name()) && is_declared_in_block(it))
        {
            return false;
        }
    }
    true
}

/// ESLint's `isSafeFromNameCollisions`: true if `else_node`'s declarations can be moved to `scope`, which encloses it.
fn is_safe_from_name_collisions<'a>(else_node: Stmt<'a>, scope: Scope<'a>) -> bool {
    match else_node.kind() {
        // Engines differ in how they hoist a conditionally declared function.
        StmtKind::Fn(_) => return false,
        StmtKind::Block(_) => {}
        _ => return true,
    }
    let else_scope = Node::Stmt(else_node).scope();
    if else_scope.node() != Node::Stmt(else_node) || else_scope.parent() != Some(scope) {
        return true;
    }
    let names: Vec<Name<'a>> = else_scope.symbols().map(Symbol::name).collect();
    is_safe_to_declare(&names, scope)
}

/// True if `token` could continue the previous statement, if that doesn't end with a `;`.
fn can_continue_statement(token: Token) -> bool {
    matches!(
        token.text().first(),
        Some(b'(' | b'[' | b'/' | b'+' | b'`' | b'-')
    )
}

/// `consequent` is the consequent of the `if` whose `else` is `else_node`.
fn fix<'a>(fixer: Fixer<'a>, else_node: Stmt<'a>, consequent: Stmt<'a>) -> Option<Fix> {
    let file = fixer.file();
    if !is_safe_from_name_collisions(else_node, else_node.parent().scope()) {
        return None;
    }
    let start_token = file.first_token(else_node)?;
    let else_token = file.token_before(start_token)?;
    let last_if_token = file.token_before(else_token)?;
    let is_block = start_token.is_punctuator("{");
    let first_token_of_else_block = match is_block {
        true => file.token_after(start_token)?,
        false => start_token,
    };

    let if_block_maybe_unsafe = consequent.as_block().is_none() && !last_if_token.is(";");
    if if_block_maybe_unsafe && can_continue_statement(first_token_of_else_block) {
        return None;
    }

    let end_token = file.last_token(else_node)?;
    let last_token_of_else_block = file.token_before(end_token)?;
    if !last_token_of_else_block.is(";")
        && let Some(next_token) = file.token_after(end_token)
    {
        let is_on_same_line =
            file.is_on_same_line(next_token.start(), last_token_of_else_block.start());
        if can_continue_statement(next_token) || (is_on_same_line && !next_token.is("}")) {
            return None;
        }
    }

    let fixed_source = match is_block {
        true => file.slice(else_node.span().shrink(1, 1)),
        false => else_node.text(),
    };
    // The fix covers the whole function, so nothing else is moved into the same scope in the same pass.
    Some(
        FixTracker::new(fixer)
            .retain_enclosing_function(else_node)
            .replace_text_range(
                Span::new(else_token.start(), else_node.span().end),
                fixed_source,
            ),
    )
}

/// oxlint 1.87's fix. It replaces everything after `consequent`, so whatever surrounds the `else` is removed too. It
/// only looks for the block's declared names in the scope that contains the `if`. Where ESLint has no fix because two
/// statements would merge, it adds a line break or a `;`.
fn fix_as_oxlint<'a>(fixer: Fixer<'a>, else_node: Stmt<'a>, consequent: Stmt<'a>) -> Option<Fix> {
    let file = fixer.file();
    let (moved_span, last) = match else_node.kind() {
        StmtKind::Fn(_) => return None,
        StmtKind::Block(body) => {
            let (scope, else_scope) = (else_node.parent().scope(), Node::Stmt(else_node).scope());
            // For oxc nothing declares `arguments`, and a `catch` parameter is in its block's scope.
            let catch_scope = scope.parent().filter(|it| it.kind() == ScopeKind::Catch);
            let is_taken = |name: Name<'a>| {
                scope
                    .get_name(name)
                    .is_some_and(|it| !it.is_implicit_arguments())
                    || catch_scope.is_some_and(|it| it.get_name(name).is_some())
            };
            if else_scope.node() == Node::Stmt(else_node)
                && else_scope.symbols().any(|it| is_taken(it.name()))
            {
                return None;
            }
            (else_node.span().shrink(1, 1), body.last())
        }
        _ => (else_node.span(), Some(else_node)),
    };
    let (start, end) = (consequent.span().end, else_node.span().end);
    let needs_newline = matches!(consequent.tag(), StmtTag::Expr | StmtTag::Return)
        && !consequent.text().ends_with(b";");
    let is_open =
        last.is_some_and(|it| !matches!(it.text().trim_ascii_end().last(), Some(b';' | b'}')));
    let after = file.text().get(end as usize..).unwrap_or_default();
    let next = after
        .iter()
        .copied()
        .find(|it| !matches!(it, b' ' | b'\t' | 0x0b | 0x0c));
    let needs_semicolon =
        is_open && next.is_some_and(|it| !matches!(it, b'\n' | b'\r' | b'}' | b';'));
    let newline: &[u8] = if needs_newline { b"\n" } else { b"" };
    let semicolon: &[u8] = if needs_semicolon { b";" } else { b"" };
    let text = [newline, file.slice(moved_span), semicolon];
    Some(fixer.replace(Span::new(start, end), text.concat()))
}

fn is_return(statement: Stmt) -> bool {
    statement.tag() == StmtTag::Return
}

/// ESLint's `naiveHasReturn`: a `return`, or a block that ends with one.
fn naive_has_return(statement: Stmt) -> bool {
    match statement.as_block() {
        Some(body) => body.last().is_some_and(is_return),
        None => is_return(statement),
    }
}

/// ESLint's `checkForReturnOrIf`: a `return`, or an `if` that returns on both branches.
fn check_for_return_or_if(statement: Stmt) -> bool {
    match statement.as_if() {
        Some((_, yes, Some(no))) => naive_has_return(no) && naive_has_return(yes),
        _ => is_return(statement),
    }
}

/// ESLint's `alwaysReturns`.
fn always_returns(statement: Stmt) -> bool {
    match statement.as_block() {
        Some(body) => body.iter().any(check_for_return_or_if),
        None => check_for_return_or_if(statement),
    }
}

/// Returns the statement that makes [`always_returns`] true.
fn returning_statement(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    match statement.kind() {
        StmtKind::Block(body) => body.iter().find(|it| check_for_return_or_if(*it)),
        _ => Some(statement),
    }
}

impl Rule for NoElseReturn {
    const META: Meta = Meta::eslint("no-else-return", Kind::Suggestion)
        .fixable(Fixable::Code)
        .reports_on_exit();
    const ON: On = On::new().stmts(&[StmtTag::If]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoElseReturn {
            allows_else_if: options.object(0).bool_or("allowElseIf", true),
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (mut consequent, mut else_node) = match statement.as_if() {
            Some((_, yes, Some(no))) if always_returns(yes) => (yes, no),
            _ => return,
        };
        // Skip the `if` of an `else if`, and places where removing the `else` would change what the following statement
        // belongs to.
        if !ast_utils::is_statement_list_parent(statement.parent()) {
            return;
        }
        if self.allows_else_if {
            while let Some((_, yes, no)) = else_node.as_if() {
                let Some(no) = no.filter(|_| always_returns(yes)) else {
                    return;
                };
                (consequent, else_node) = (yes, no);
            }
        }
        // oxlint reports at the statement that returns. Disable comments apply to the span between the branches.
        let report = match returning_statement(consequent).filter(|_| cx.language().is_oxlint) {
            Some(returning) => {
                let (start, end) = (consequent.span().end, else_node.span().start);
                cx.report(returning, UNEXPECTED)
                    .called_with(statement)
                    .comments_apply_at(Span::new(start, end))
                    .first_label("This consequent block always returns,")
                    .label(
                        Span::new(start, end),
                        "Making this `else` block unnecessary.",
                    )
            }
            None => cx.report(else_node, UNEXPECTED),
        };
        report.fix(|fixer| match fixer.file().language().is_oxlint {
            true => fix_as_oxlint(fixer, else_node, consequent),
            false => fix(fixer, else_node, consequent),
        });
    }
}
