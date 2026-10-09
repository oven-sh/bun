use bun_lint::prelude::*;
use bun_lint::utils::fix_tracker::FixTracker;

/// Disallow `else` blocks after `return` statements in `if` statements.
pub struct NoElseReturn {
    allows_else_if: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unnecessary 'else' after 'return'.");

/// ESLint's `isSafeToDeclare`: whether `names` can be declared in `scope` without a conflict and
/// without capturing a reference.
fn is_safe_to_declare<'a>(names: &[Name<'a>], scope: Scope<'a>) -> bool {
    if names.is_empty() {
        return true;
    }
    let function_scope = scope.variable_scope();
    // What is declared here, and the `arguments` that is used.
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
    // A `var` in this block, which is hoisted out of it.
    if scope != function_scope {
        let block = scope.span();
        let is_declared_in_block = |symbol: Symbol<'a>| {
            let mut nodes = symbol.declarations().filter_map(Declaration::node);
            nodes.any(|node| block.contains(utils::estree_span(node)))
        };
        if function_scope.symbols().any(|it| names.contains(&it.name()) && is_declared_in_block(it)) {
            return false;
        }
    }
    true
}

/// ESLint's `isSafeFromNameCollisions`: whether what `else_node` declares can be declared in
/// `scope`, which is around it.
fn is_safe_from_name_collisions<'a>(else_node: Stmt<'a>, scope: Scope<'a>) -> bool {
    match else_node.kind() {
        // How a function that is declared conditionally is hoisted differs between engines.
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

/// It could continue the statement before it, if that does not end with a `;`.
fn can_continue_statement(token: Token) -> bool {
    matches!(token.text().first(), Some(b'(' | b'[' | b'/' | b'+' | b'`' | b'-'))
}

/// `consequent`: that of the `if` whose `else` is `else_node`.
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

    let if_block_maybe_unsafe = !matches!(consequent.kind(), StmtKind::Block(_)) && !last_if_token.is(";");
    if if_block_maybe_unsafe && can_continue_statement(first_token_of_else_block) {
        return None;
    }

    let end_token = file.last_token(else_node)?;
    let last_token_of_else_block = file.token_before(end_token)?;
    if !last_token_of_else_block.is(";")
        && let Some(next_token) = file.token_after(end_token)
    {
        let is_on_same_line = file.is_on_same_line(next_token.start(), last_token_of_else_block.start());
        if can_continue_statement(next_token) || (is_on_same_line && !next_token.is("}")) {
            return None;
        }
    }

    let fixed_source = match is_block {
        true => file.slice(else_node.span().shrink(1, 1)),
        false => else_node.text(),
    };
    // The whole function, so that nothing else is moved into the same scope in the same pass.
    Some(
        FixTracker::new(fixer)
            .retain_enclosing_function(else_node)
            .replace_text_range(Span::new(else_token.start(), else_node.span().end), fixed_source),
    )
}

fn is_return(statement: Stmt) -> bool {
    statement.tag() == StmtTag::Return
}

/// ESLint's `naiveHasReturn`: it is a `return`, or a block that ends with one.
fn naive_has_return(statement: Stmt) -> bool {
    match statement.kind() {
        StmtKind::Block(body) => body.last().is_some_and(is_return),
        _ => is_return(statement),
    }
}

/// ESLint's `checkForReturnOrIf`: a `return`, or an `if` that returns on both branches.
fn check_for_return_or_if(statement: Stmt) -> bool {
    match statement.kind() {
        StmtKind::Return(_) => true,
        StmtKind::If { yes, no: Some(no), .. } => naive_has_return(no) && naive_has_return(yes),
        _ => false,
    }
}

/// ESLint's `alwaysReturns`.
fn always_returns(statement: Stmt) -> bool {
    match statement.kind() {
        StmtKind::Block(body) => body.iter().any(check_for_return_or_if),
        _ => check_for_return_or_if(statement),
    }
}

/// The statement for which [`always_returns`] holds.
fn returning_statement(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    match statement.kind() {
        StmtKind::Block(body) => body.iter().find(|it| check_for_return_or_if(*it)),
        _ => Some(statement),
    }
}

impl Rule for NoElseReturn {
    const META: Meta = Meta::eslint("no-else-return", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoElseReturn {
            allows_else_if: options.object(0).bool_or("allowElseIf", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::If], |rule, statement, cx| {
            let (mut consequent, mut else_node) = match statement.kind() {
                StmtKind::If { yes, no: Some(no), .. } if always_returns(yes) => (yes, no),
                _ => return,
            };
            // Not the `if` of an `else if`, and not where removing the `else` would change what the
            // statement after it belongs to.
            if !ast_utils::is_statement_list_parent(statement.parent()) {
                return;
            }
            if rule.allows_else_if {
                while let StmtKind::If { yes, no, .. } = else_node.kind() {
                    let Some(no) = no.filter(|_| always_returns(yes)) else {
                        return;
                    };
                    (consequent, else_node) = (yes, no);
                }
            }
            // oxlint prints where the statement is that returns. Comments go by what is between the branches.
            let report = match returning_statement(consequent).filter(|_| cx.language().is_oxlint) {
                Some(returning) => cx
                    .report(returning, UNEXPECTED)
                    .comments_apply_at(Span::new(consequent.span().end, else_node.span().start)),
                None => cx.report(else_node, UNEXPECTED),
            };
            report.fix(|fixer| fix(fixer, else_node, consequent));
        });
    }
}
