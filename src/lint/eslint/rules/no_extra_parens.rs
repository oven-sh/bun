use bun_lint::prelude::*;
use bun_lint::tokens::token_len;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ast_utils::{
    can_tokens_be_adjacent, get_precedence, get_static_property_name, is_decimal_integer,
    is_mixed_logical_and_coalesce_expressions, is_top_level_expression_statement,
};
use bun_lint::utils::estree_compat::{is_assignment_target, is_chain_root};
use rustc_hash::FxHashSet;

/// Disallow unnecessary parentheses.
pub struct NoExtraParens {
    all_nodes: bool,
    except_cond_assign: bool,
    except_cond_ternary: bool,
    nested_binary: bool,
    except_return_assign: bool,
    ignore_jsx: IgnoreJsx,
    ignore_arrow_conditionals: bool,
    ignore_sequence_expressions: bool,
    ignore_new_in_member_expr: bool,
    ignore_function_prototype_methods: bool,
    allow_parens_after_comment_pattern: Option<Regex>,
}

#[derive(Copy, Clone, PartialEq)]
enum IgnoreJsx {
    Never,
    All,
    SingleLine,
    MultiLine,
}

const UNEXPECTED: Message =
    Message::new("unexpected", "Unnecessary parentheses around expression.");

const PRECEDENCE_OF_SEQUENCE_EXPR: i32 = 0;
const PRECEDENCE_OF_ASSIGNMENT_EXPR: i32 = 1;
const PRECEDENCE_OF_LOGICAL_OR_EXPR: i32 = 4;
const PRECEDENCE_OF_UNARY_EXPR: i32 = 16;
const PRECEDENCE_OF_UPDATE_EXPR: i32 = 17;
const PRECEDENCE_OF_CALL_EXPR: i32 = 18;
const PRECEDENCE_OF_NEW_EXPR: i32 = 19;
const PRECEDENCE_OF_MEMBER_EXPR: i32 = 20;

/// The parentheses of the call `import.defer(e)`, if `e` is all that is in them. Upstream takes the
/// second token of an `ImportExpression` for its `(`. Here that is the `.`, so that these count as
/// parentheses around `e`.
fn deferred_import_parens(e: Expr<'_>) -> Option<Span> {
    let Node::Expr(parent) = e.parent() else {
        return None;
    };
    if parent.tag() != ExprTag::ImportCall || !parent.is_deferred_import_call() {
        return None;
    }
    let (file, outer) = (e.file(), e.outer_span());
    let close = parent.span().end.saturating_sub(1);
    (skip_trivia(file.text(), outer.end) == close)
        .then(|| Span::new(file.end_of_token_before(outer.start).saturating_sub(1), close + 1))
}

/// How many parentheses upstream sees around `e`.
fn paren_count(e: Expr<'_>) -> usize {
    e.parens().len() + usize::from(deferred_import_parens(e).is_some())
}

/// The expression in the head of a `for`, if that is not a declaration.
fn head_expression(head: Stmt<'_>) -> Option<Expr<'_>> {
    match head.kind() {
        StmtKind::Expr(e) => Some(e),
        _ => None,
    }
}

fn is_assignment(e: Expr<'_>) -> bool {
    e.tag() == ExprTag::Assign
}

fn is_regex(e: Expr<'_>) -> bool {
    e.tag() == ExprTag::Regex
}

/// `BinaryExpression` or `LogicalExpression`
fn is_binary_or_logical(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Binary { op, .. } if op != BinOp::Comma)
}

/// `FunctionExpression`
fn is_function_expression(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Fn(func) if !func.is_arrow())
}

/// `MemberExpression`, as opposed to a `ChainExpression` around one.
fn is_member_expression(e: Expr<'_>) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index) && !is_chain_root(e)
}

fn can_be_assignment_target(e: Expr<'_>) -> bool {
    e.tag() == ExprTag::Ident || is_member_expression(e)
}

/// `function(){}.call()`, `function(){}.apply()`
fn is_immediate_function_prototype_method_call(e: Expr<'_>) -> bool {
    let ExprKind::Call(call) = e.kind() else {
        return false;
    };
    let callee = call.callee();
    let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
        return false;
    };
    is_function_expression(obj)
        && get_static_property_name(callee)
            .is_some_and(|name| matches!(&*name, b"call" | b"apply"))
}

/// What has been found out about a file.
#[derive(Default)]
pub struct State<'a> {
    /// What is to be reported in the initializer of a `for`.
    reports: Vec<Found<'a>>,
    is_in_return_statement: AncestorMemo<'a, bool>,
    is_in_initializer: AncestorMemo<'a, bool>,
}

impl<'a> State<'a> {
    fn is_in_return_statement(&mut self, e: Expr<'a>) -> bool {
        let found = self.is_in_return_statement.find(Node::Expr(e), |_, ancestor| match ancestor {
            Node::Stmt(statement) => (statement.tag() == StmtTag::Return).then_some(true),
            Node::Func(func) => matches!(func.body(), FnBody::Expr(_)).then_some(true),
            _ => None,
        });
        found.is_some()
    }

    /// Whether `e` is in the initializer of a `for` statement.
    fn is_in_initializer(&mut self, e: Expr<'a>) -> bool {
        let found = self.is_in_initializer.find(Node::Expr(e), |child, ancestor| match ancestor {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::For { init: Some(init), .. } => init.span().contains(child.span()).then_some(true),
                _ => None,
            },
            _ => None,
        });
        found.is_some()
    }
}

fn contains_assignment(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Assign { .. } => true,
        ExprKind::Cond { yes, no, .. } => is_assignment(yes) || is_assignment(no),
        ExprKind::Binary { op, left, right } if op != BinOp::Comma => {
            is_assignment(left) || is_assignment(right)
        }
        _ => false,
    }
}

fn does_member_expression_contain_call_expression(member: Expr<'_>) -> bool {
    let mut at = member;
    while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = at.kind()
        && (at == member || !is_chain_root(at))
    {
        at = obj;
    }
    at.tag() == ExprTag::Call && !is_chain_root(at)
}

/// Whether `member` is what a `new` constructs, or the object of such a member access.
fn is_member_expression_in_new_callee(member: Expr<'_>) -> bool {
    let mut at = member;
    loop {
        if is_chain_root(at) {
            return false;
        }
        let Node::Expr(parent) = at.parent() else {
            return false;
        };
        match parent.kind() {
            ExprKind::New(call) => return call.callee() == at,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == at => at = parent,
            _ => return false,
        }
    }
}

/// `a = function () {}` names the function `a`, `(a) = function () {}` does not.
fn is_anonymous_function_assignment_exception(
    left: Expr<'_>,
    op: Option<BinOp>,
    right: Expr<'_>,
) -> bool {
    left.tag() == ExprTag::Ident
        && matches!(op, None | Some(BinOp::And | BinOp::Or | BinOp::Nullish))
        && match right.kind() {
            ExprKind::Fn(func) => func.is_arrow() || func.name().is_none(),
            ExprKind::Class(class) => class.name().is_none(),
            _ => false,
        }
}

/// The token that starts at `at`.
fn token_text(text: &[u8], at: u32) -> &[u8] {
    let rest = text.get(at as usize..).unwrap_or_default();
    rest.get(..token_len(rest)).unwrap_or_default()
}

/// From the token at `at`, the first that is not a `(`.
fn skip_opening_parens(text: &[u8], mut at: u32) -> u32 {
    while text.get(at as usize) == Some(&b'(') {
        at = skip_trivia(text, at + 1);
    }
    at
}

/// From the end of a token at `at`, the first token that is not a `)`.
fn skip_closing_parens(text: &[u8], at: u32) -> u32 {
    let mut at = skip_trivia(text, at);
    while text.get(at as usize) == Some(&b')') {
        at = skip_trivia(text, at + 1);
    }
    at
}

/// An expression in parentheses.
#[derive(Copy, Clone)]
pub struct Found<'a> {
    node: Expr<'a>,
    /// How many parentheses are around it.
    count: usize,
    /// The innermost of them.
    parens: Span,
}

impl<'a> Found<'a> {
    fn new(node: Expr<'a>) -> Option<Self> {
        let (mut own, of_import) = (node.parens(), deferred_import_parens(node));
        Some(Found {
            node,
            count: own.len() + usize::from(of_import.is_some()),
            parens: own.next().or(of_import)?,
        })
    }

    /// Whether without the parentheses its first token would start a statement, the body of an
    /// arrow function or the head of a `for` with another meaning: ESLint's `tokensToIgnore`.
    fn is_first_token_ignored(self) -> bool {
        let file = self.node.file();
        let (text, start) = (file.text(), self.node.span().start);
        let token = token_text(text, start);
        if !matches!(token, b"{" | b"function" | b"class" | b"let" | b"async") {
            return false;
        }
        // Up, as long as nothing but `(` is before the token.
        let mut child = self.node;
        let statement = loop {
            match child.parent() {
                Node::Expr(parent) if skip_opening_parens(text, parent.span().start) == start => {
                    child = parent;
                }
                Node::Func(func) => {
                    return token == b"{" && matches!(func.body(), FnBody::Expr(body) if body == child);
                }
                Node::Stmt(statement) => break statement,
                _ => return false,
            }
        };
        let after = skip_closing_parens(text, start + token.len() as u32);
        let is_before_bracket = text.get(after as usize) == Some(&b'[');
        match statement.kind() {
            StmtKind::Expr(_) | StmtKind::ExportDefault(_) => match token {
                // Not for every parser, and not in every version of the language.
                b"let" => {
                    file.token_at(start).is_some_and(|it| it.kind() == TokenKind::Keyword)
                        && (is_before_bracket
                            || file.token_at(after).is_some_and(|it| it.kind() == TokenKind::Identifier))
                }
                b"async" => token_text(text, skip_trivia(text, start + 5)) == b"function",
                _ => true,
            },
            StmtKind::For {
                init: Some(head), ..
            }
            | StmtKind::ForIn { left: head, .. }
                if head_expression(head) == Some(child) =>
            {
                token == b"let" && is_before_bracket
            }
            StmtKind::ForOf { left, .. } if head_expression(left) == Some(child) => token == b"let",
            _ => false,
        }
    }
}

/// Whether the syntax of `node`, which has the child `child`, keeps an `in` inside of `child` from
/// being taken for the `in` of a `for`-`in` loop.
fn is_safely_enclosing_in_expression<'a>(node: Node<'a>, child: Node<'a>) -> bool {
    match node {
        Node::Expr(e) => match e.kind() {
            ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Template(_) => true,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                matches!(child, Node::Expr(child) if child != call.callee())
            }
            ExprKind::Index { index, .. } => child == Node::Expr(index),
            ExprKind::Cond { yes, .. } => child == Node::Expr(yes),
            _ => false,
        },
        Node::Func(func) => match child {
            Node::Param(_) => true,
            // The braces of its body.
            Node::Stmt(_) => func.kind() != FnKind::StaticBlock,
            _ => false,
        },
        Node::Stmt(statement) => matches!(statement.kind(), StmtKind::Block(_)),
        Node::Pat(_) => true,
        _ => false,
    }
}

/// `for (let a = (b in c);;);` must not become `for (let a = b in c;;);`. Takes out of `reported` those whose parentheses have to
/// stay for an `in` in `initializer`. It goes down from the initializer, not into what cannot have such an `in`.
fn keep_parens_around_in_expressions<'a>(initializer: Stmt<'a>, reported: &mut FxHashSet<Expr<'a>>) {
    let root = match initializer.kind() {
        StmtKind::Expr(e) => Node::Expr(e),
        _ => Node::Stmt(initializer),
    };
    // Each with the outermost of `reported` around it. Only that has to stay.
    let mut pending: Vec<(Node<'a>, Option<Expr<'a>>)> = vec![(root, None)];
    while let Some((node, mut excluded)) = pending.pop() {
        if let Node::Expr(e) = node {
            match paren_count(e) {
                0 => {}
                1 if reported.contains(&e) => excluded = excluded.or(Some(e)),
                // These stay, or one pair of them does.
                _ => continue,
            }
            if let (ExprKind::Binary { op: BinOp::In, .. }, Some(excluded)) = (e.kind(), excluded) {
                reported.remove(&excluded);
            }
        }
        node.for_each_child(|child| {
            if !is_safely_enclosing_in_expression(node, child) {
                pending.push((child, excluded));
            }
        });
    }
}

fn requires_leading_space<'a>(file: &'a File<'a>, left_paren: Span) -> bool {
    let before = file.tokens_before(left_paren).with_comments().next();
    let after = file.tokens_after(left_paren).with_comments().next();
    let (Some(before), Some(after)) = (before, after) else {
        return false;
    };
    before.end() == left_paren.start
        && left_paren.end == after.start()
        && !can_tokens_be_adjacent(before, after)
}

fn requires_trailing_space<'a>(file: &'a File<'a>, node: Expr<'a>, right_paren: Span) -> bool {
    let (Some(last), Some(after)) = (file.last_token(node), file.token_after(right_paren)) else {
        return false;
    };
    !file.is_space_between(right_paren, after) && !can_tokens_be_adjacent(last, after)
}

fn finish_report<'a>(found: Found<'a>, cx: &Cx<'a, NoExtraParens>) {
    let Found { node, count, parens } = found;
    let left_paren = Span::new(parens.start, parens.start + 1);
    let report = cx.report(left_paren, UNEXPECTED);
    // Without its parentheses, a string that is a statement can become a directive.
    if node.tag() == ExprTag::String
        && count < 2
        && matches!(node.parent(), Node::Stmt(it) if is_top_level_expression_statement(it))
    {
        return;
    }
    report.fix(|fixer| {
        let file = fixer.file();
        let right_paren = Span::new(parens.end - 1, parens.end);
        let mut text = Vec::with_capacity(parens.len() as usize);
        if requires_leading_space(file, left_paren) {
            text.push(b' ');
        }
        text.extend_from_slice(file.slice(left_paren.between(right_paren)));
        if requires_trailing_space(file, node, right_paren) {
            text.push(b' ');
        }
        fixer.replace(parens, text)
    });
}

impl NoExtraParens {
    fn rule_applies(&self, node: Expr<'_>) -> bool {
        match node.kind() {
            ExprKind::Jsx(_) if self.ignore_jsx != IgnoreJsx::Never => {
                let span = node.span();
                let is_single_line = node.file().is_on_same_line(span.start, span.end);
                match self.ignore_jsx {
                    IgnoreJsx::MultiLine => is_single_line,
                    IgnoreJsx::SingleLine => !is_single_line,
                    IgnoreJsx::All | IgnoreJsx::Never => false,
                }
            }
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } if self.ignore_sequence_expressions => false,
            ExprKind::Call(_)
                if self.ignore_function_prototype_methods
                    && is_immediate_function_prototype_method_call(node) =>
            {
                false
            }
            ExprKind::Fn(_) => true,
            _ => self.all_nodes,
        }
    }

    /// For the callee `node` of `call`.
    fn has_excess_parens_as_callee<'a>(call: Call<'a>, is_new: bool, node: Expr<'a>) -> bool {
        let limit = match is_new {
            true => PRECEDENCE_OF_NEW_EXPR,
            false => PRECEDENCE_OF_CALL_EXPR,
        };
        if get_precedence(node) < limit {
            return false;
        }
        match node.kind() {
            // (a?.b)(); (a?.())();
            _ if is_chain_root(node) => call.is_optional(),
            // (function () {})();
            ExprKind::Fn(func) => is_new || func.is_arrow(),
            // (new A)(); new (new A)();
            ExprKind::New(callee) => {
                callee.close_paren().is_some() || (is_new && call.close_paren().is_none())
            }
            // new (a().b)(); new (a.b().c);
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                !(is_new && does_member_expression_contain_call_expression(node))
            }
            _ => true,
        }
    }

    /// For the object `node` of `member`.
    fn has_excess_parens_as_object<'a>(
        &self,
        member: Expr<'a>,
        node: Expr<'a>,
        is_twice: bool,
    ) -> bool {
        if is_member_expression_in_new_callee(member)
            && does_member_expression_contain_call_expression(member)
        {
            if !is_twice {
                return false;
            }
        } else if self.ignore_function_prototype_methods
            && let Node::Expr(parent) = member.parent()
            && let ExprKind::Call(call) = parent.kind()
            && call.callee() == member
            && is_immediate_function_prototype_method_call(parent)
        {
            return false;
        }
        let is_computed = member.tag() == ExprTag::Index;
        match node.kind() {
            _ if is_chain_root(node) => member.is_optional(),
            ExprKind::Call(_) => true,
            ExprKind::New(call) => !self.ignore_new_in_member_expr && call.close_paren().is_some(),
            ExprKind::Number(_) if !is_computed && is_decimal_integer(node) => false,
            ExprKind::Regex(_) if !is_computed => false,
            _ => get_precedence(node) >= PRECEDENCE_OF_MEMBER_EXPR,
        }
    }

    /// For the operand `node` of `parent`, a `BinaryExpression` or a `LogicalExpression`.
    fn has_excess_parens_as_operand<'a>(
        &self,
        parent: Expr<'a>,
        is_left: bool,
        node: Expr<'a>,
        is_twice: bool,
    ) -> bool {
        if self.nested_binary && is_binary_or_logical(node) {
            return false;
        }
        if is_twice {
            return true;
        }
        let is_exponentiation = matches!(parent.kind(), ExprKind::Binary { op: BinOp::Pow, .. });
        let is_unary = get_precedence(node) == PRECEDENCE_OF_UNARY_EXPR;
        if is_mixed_logical_and_coalesce_expressions(node, parent)
            || (is_left && is_exponentiation && is_unary)
        {
            return false;
        }
        match get_precedence(node).cmp(&get_precedence(parent)) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Equal => is_left != is_exponentiation,
            std::cmp::Ordering::Less => false,
        }
    }

    /// What the listener of ESLint's rule for the parent decides about the parentheses.
    fn has_excess_parens<'a>(&self, found: Found<'a>, state: &mut State<'a>) -> bool {
        let Found { node, count, .. } = found;
        let file = node.file();
        let is_twice = count >= 2;
        let has_precedence = |limit: i32| is_twice || get_precedence(node) >= limit;
        // After a keyword that no line break may follow.
        let is_on_line_of = |keyword: u32| is_twice || file.is_on_same_line(keyword, node.span().start);
        let is_cond_assign_exception = self.except_cond_assign && is_assignment(node);
        match node.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Array(_) => match is_assignment_target(parent) {
                    true => can_be_assignment_target(node),
                    false => has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR),
                },
                ExprKind::Spread(_) => match parent.parent() {
                    Node::Expr(owner) if owner.tag() == ExprTag::Jsx => false,
                    _ if is_assignment_target(parent) => can_be_assignment_target(node),
                    _ => has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR),
                },
                ExprKind::Index { index, .. } if index == node => true,
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    self.has_excess_parens_as_object(parent, node, is_twice)
                }
                ExprKind::Call(call) | ExprKind::New(call) if call.callee() == node => {
                    is_twice
                        || Self::has_excess_parens_as_callee(call, parent.tag() == ExprTag::New, node)
                }
                ExprKind::Call(_) | ExprKind::New(_) => has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR),
                ExprKind::TaggedTemplate(call) => call.callee() != node,
                ExprKind::Template(_) => true,
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    ..
                } => {
                    let operator = parent.span().end.saturating_sub(2);
                    is_twice
                        || (file.is_on_same_line(node.span().end, operator)
                            && get_precedence(node) >= PRECEDENCE_OF_UPDATE_EXPR)
                }
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec,
                    ..
                } => has_precedence(PRECEDENCE_OF_UPDATE_EXPR),
                ExprKind::Unary { .. } | ExprKind::Await(_) => has_precedence(PRECEDENCE_OF_UNARY_EXPR),
                ExprKind::Binary {
                    op: BinOp::Comma, ..
                } => has_precedence(PRECEDENCE_OF_SEQUENCE_EXPR),
                ExprKind::Binary { left, .. } => {
                    self.has_excess_parens_as_operand(parent, left == node, node, is_twice)
                }
                ExprKind::Assign { op, target, value } => {
                    let is_pattern = op.is_none() && is_assignment_target(parent);
                    if target == node {
                        can_be_assignment_target(node)
                            && (is_pattern
                                || is_twice
                                || !is_anonymous_function_assignment_exception(node, op, value))
                    } else {
                        (is_pattern || !self.except_return_assign || !state.is_in_return_statement(parent))
                            && has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR)
                    }
                }
                ExprKind::Cond { test, .. } => {
                    if (self.except_return_assign
                        && contains_assignment(parent)
                        && state.is_in_return_statement(parent))
                        || (self.except_cond_ternary && is_binary_or_logical(node))
                    {
                        return false;
                    }
                    match test == node {
                        true => {
                            !is_cond_assign_exception && has_precedence(PRECEDENCE_OF_LOGICAL_OR_EXPR)
                        }
                        false => has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR),
                    }
                }
                ExprKind::Yield { .. } => {
                    is_twice
                        || (get_precedence(node) >= PRECEDENCE_OF_ASSIGNMENT_EXPR
                            && is_on_line_of(parent.span().start))
                }
                ExprKind::ImportCall { args } => {
                    args.first() == Some(node)
                        && (is_twice || get_precedence(node) != PRECEDENCE_OF_SEQUENCE_EXPR)
                }
                _ => false,
            },
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Expr(_)
                | StmtKind::ForIn { .. }
                | StmtKind::Switch { .. }
                | StmtKind::With { .. } => true,
                StmtKind::ExportDefault(_) => has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR),
                StmtKind::If { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } => {
                    !is_cond_assign_exception
                }
                StmtKind::For { test, .. } => test != Some(node) || !is_cond_assign_exception,
                StmtKind::ForOf { expr, .. } => {
                    expr != node || has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR)
                }
                StmtKind::Return(_) => {
                    !(self.except_return_assign && contains_assignment(node))
                        && is_on_line_of(statement.span().start)
                        && !is_regex(node)
                }
                StmtKind::Throw(_) => is_on_line_of(statement.span().start),
                _ => false,
            },
            Node::Func(func) => {
                matches!(func.body(), FnBody::Expr(body) if body == node)
                    && !(self.except_return_assign && contains_assignment(node))
                    && !(self.ignore_arrow_conditionals && node.tag() == ExprTag::Cond)
                    && has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR)
            }
            Node::Prop(prop) if prop.is_jsx_attribute() => false,
            Node::Prop(prop) => {
                let is_in_pattern = prop.value() == Some(node)
                    && matches!(prop.parent(), Node::Expr(object) if is_assignment_target(object));
                match is_in_pattern {
                    true => can_be_assignment_target(node),
                    false => has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR),
                }
            }
            Node::Member(member) => {
                let is_key = matches!(
                    member.key().map(Key::kind),
                    Some(KeyKind::Computed(key)) if key == node
                );
                (is_key || member.init() == Some(node))
                    && matches!(member.parent(), Node::Class(_))
                    && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
                    && has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR)
            }
            Node::Class(class) => {
                class.extends() == Some(node)
                    && (is_twice || get_precedence(node) > PRECEDENCE_OF_UPDATE_EXPR)
            }
            Node::Param(param) => {
                param.default() == Some(node) && has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR)
            }
            Node::PatProp(_) | Node::PatElem(_) => has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR),
            Node::VarDecl(_) => has_precedence(PRECEDENCE_OF_ASSIGNMENT_EXPR) && !is_regex(node),
            Node::Case(_) => true,
            _ => false,
        }
    }

    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !self.rule_applies(e) {
            return;
        }
        let Some(found) = Found::new(e).filter(|found| self.has_excess_parens(*found, &mut cx.state)) else {
            return;
        };
        if found.count < 2 {
            if found.is_first_token_ignored() {
                return;
            }
            // (function () {}())
            if let ExprKind::Call(call) = found.node.kind()
                && is_function_expression(call.callee())
                && (is_chain_root(found.node) || !call.callee().is_parenthesized())
            {
                return;
            }
            if let Some(pattern) = &self.allow_parens_after_comment_pattern
                && let Some(comment) = cx.file().comments_before(found.parens).next_back()
                && pattern.test(comment.comment_value())
            {
                return;
            }
        }
        match cx.file().has_stmts([StmtTag::For]) && cx.state.is_in_initializer(found.node) {
            true => cx.state.reports.push(found),
            false => finish_report(found, cx),
        }
    }

    /// Reports what is in the initializer of a `for`, except where the parentheses keep an `in`
    /// from ending the initializer.
    fn check_initializers<'a>(&self, cx: &mut Cx<'a, Self>) {
        let reports = std::mem::take(&mut cx.state.reports);
        if reports.is_empty() {
            return;
        }
        let mut reported: FxHashSet<Expr<'a>> = reports.iter().map(|it| it.node).collect();
        let mut starts: Vec<u32> = reports.iter().map(|it| it.node.span().start).collect();
        starts.sort_unstable();
        let for_statements = cx.file().stmts_of_kind(StmtTag::For);
        let mut initializers: Vec<Stmt<'a>> = for_statements
            .filter_map(|it| match it.kind() {
                StmtKind::For { init, .. } => init,
                _ => None,
            })
            .filter(|init| {
                let first = starts.partition_point(|start| *start < init.span().start);
                starts.get(first).is_some_and(|start| *start < init.span().end)
            })
            .collect();
        // A loop in the initializer of another comes first.
        utils::sort::sort_by_key(&mut initializers, |init| init.span().end);
        for initializer in initializers {
            keep_parens_around_in_expressions(initializer, &mut reported);
        }
        for found in reports.into_iter().filter(|it| reported.contains(&it.node)) {
            finish_report(found, cx);
        }
    }
}

impl Rule for NoExtraParens {
    const META: Meta = Meta::eslint("no-extra-parens", Kind::Layout)
        .fixable(Fixable::Code)
        .deprecated();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let all_nodes = options.str(0) != Some("functions");
        let object = match all_nodes {
            true => options.object(1),
            false => Object::default(),
        };
        let is_off = |key: &str| object.bool(key) == Some(false);
        NoExtraParens {
            all_nodes,
            except_cond_assign: is_off("conditionalAssign"),
            except_cond_ternary: is_off("ternaryOperandBinaryExpressions"),
            nested_binary: is_off("nestedBinaryExpressions"),
            except_return_assign: is_off("returnAssign"),
            ignore_jsx: match object.str("ignoreJSX") {
                Some("all") => IgnoreJsx::All,
                Some("single-line") => IgnoreJsx::SingleLine,
                Some("multi-line") => IgnoreJsx::MultiLine,
                _ => IgnoreJsx::Never,
            },
            ignore_arrow_conditionals: is_off("enforceForArrowConditionals"),
            ignore_sequence_expressions: is_off("enforceForSequenceExpressions"),
            ignore_new_in_member_expr: is_off("enforceForNewInMemberExpressions"),
            ignore_function_prototype_methods: is_off("enforceForFunctionPrototypeMethods"),
            allow_parens_after_comment_pattern: object
                .str("allowParensAfterCommentPattern")
                .filter(|pattern| !pattern.is_empty())
                .and_then(|pattern| Regex::new(pattern, "u").ok()),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.exprs([ExprTag::ImportCall], |rule, e, cx| {
            if let ExprKind::ImportCall { args } = e.kind()
                && let Some(source) = args.first()
                && !source.is_parenthesized()
            {
                rule.check(source, cx);
            }
        });
        on.finish(|rule, cx| {
            let file = cx.file();
            file.parenthesized().for_each(|e| rule.check(e, cx));
            rule.check_initializers(cx);
        });
        State::default()
    }
}
