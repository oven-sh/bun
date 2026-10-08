//! The small files of `util/`, one function each.

use super::estree::{is_chain_expression, is_pattern};
use crate::ast::{
    BinOp, Expr, ExprKind, File, Flags, Func, Ident, Node, PropKind, Stmt, StmtKind, UnOp,
};
use crate::context::Report;
use crate::fix::{Fixer, IntoFix};
use crate::rule::Message;
use crate::semantic::Declaration;
use crate::span::{Span, Spanned};
use crate::utils::ast_utils::as_function;
use crate::utils::estree_compat::is_sequence_root;
use crate::utils::string_utils::graphemes;
use smallvec::SmallVec;

/// typescript-eslint's `getThisExpression`: the `this` that a chain of member accesses and calls
/// starts with, as in `this.a[b]().c`.
pub fn get_this_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    let mut at = e;
    loop {
        at = match at.kind() {
            ExprKind::Call(call) => call.callee(),
            ExprKind::This => return Some(at),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            _ => return None,
        };
    }
}

/// typescript-eslint's `getStringLength`: the number of characters as a reader counts them, which
/// is that of the grapheme clusters.
pub fn get_string_length(value: &[u8]) -> usize {
    match value.iter().all(|c| matches!(c, 0x20..=0x7F)) {
        true => value.len(),
        false => graphemes(value).count(),
    }
}

/// typescript-eslint's `isUndefinedIdentifier`.
#[inline]
pub fn is_undefined_identifier(e: Expr<'_>) -> bool {
    e.is_ident("undefined")
}

/// typescript-eslint's `isNodeEqual`: both are `this`, the same identifier, literals with the same
/// value, or member accesses whose objects and properties are equal in this sense.
///
/// As upstream: `a.b` equals `a[b]`, `a.b` equals `a?.b` where neither is all of its chain, two
/// regular expressions are never equal, nor are two `a.#b`, nor two `ChainExpression`s, which is
/// what all of an optional chain is.
pub fn is_node_equal<'a>(a: Expr<'a>, b: Expr<'a>) -> bool {
    let (mut a, mut b) = (a, b);
    loop {
        if is_chain_expression(a) || is_chain_expression(b) {
            return false;
        }
        let is_private = |name: Ident<'a>| name.bytes().starts_with(b"#");
        (a, b) = match (a.kind(), b.kind()) {
            (ExprKind::This, ExprKind::This)
            | (ExprKind::Null, ExprKind::Null)
            | (ExprKind::True, ExprKind::True)
            | (ExprKind::False, ExprKind::False) => return true,
            (ExprKind::Ident(a), ExprKind::Ident(b))
            | (ExprKind::String(a), ExprKind::String(b))
            | (ExprKind::BigInt(a), ExprKind::BigInt(b)) => return a == b,
            (ExprKind::Number(a), ExprKind::Number(b)) => return a == b,
            (ExprKind::Dot { obj: a, name, .. }, ExprKind::Dot { obj: b, name: other, .. }) => {
                if is_private(name) || is_private(other) || name.name() != other.name() {
                    return false;
                }
                (a, b)
            }
            (ExprKind::Index { obj: a, index, .. }, ExprKind::Index { obj: b, index: other, .. }) => {
                if !is_node_equal(index, other) {
                    return false;
                }
                (a, b)
            }
            (ExprKind::Dot { obj: a, name, .. }, ExprKind::Index { obj: b, index, .. })
            | (ExprKind::Index { obj: a, index, .. }, ExprKind::Dot { obj: b, name, .. }) => {
                if index.as_ident() != Some(name.name()) {
                    return false;
                }
                (a, b)
            }
            _ => return false,
        };
    }
}

/// typescript-eslint's `isTypeImport`: whether the declaration is `import type { A }`,
/// `import type A`, `import type * as A`, `import { type A }` or `import type A = require()`.
pub fn is_type_import(declaration: Declaration<'_>) -> bool {
    match declaration {
        Declaration::ImportDefault(import) | Declaration::ImportNamespace(import) => {
            import.is_type_only()
        }
        Declaration::ImportSpec(specifier) => {
            specifier.is_type_only() || specifier.import().is_type_only()
        }
        Declaration::ImportEquals(import) => import.flags().contains(Flags::TYPE_ONLY),
        _ => false,
    }
}

/// typescript-eslint's `isAssignee`: whether `e` is written to or deleted. It is the left of an
/// assignment, the operand of `delete`, `++` or `--`, an element or the rest of an array pattern,
/// or inside `!`, `as`, `<T>` or `satisfies` in one of these places.
///
/// As upstream: a value in an object pattern is not an assignee, except in `({ a: e }) = b`, where
/// the parentheses make it an `ObjectExpression`. Nor is the left of a default in a pattern, nor
/// the left of a `for`-`in` or a `for`-`of`. Upstream is given a `MemberExpression`: for all of an
/// optional chain, whose parent is the `ChainExpression`, the answer is `false`.
pub fn is_assignee(e: Expr<'_>) -> bool {
    let mut node = e;
    loop {
        if is_chain_expression(node) {
            return false;
        }
        node = match node.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, .. } => return target == node && !is_pattern(parent),
                ExprKind::Unary { op, .. } => {
                    return matches!(
                        op,
                        UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                    );
                }
                ExprKind::Array(_) | ExprKind::Spread(_) => return is_pattern(parent),
                ExprKind::NonNull(_)
                | ExprKind::As { .. }
                | ExprKind::AsConst(_)
                | ExprKind::Satisfies { .. } => parent,
                _ => return false,
            },
            Node::Prop(prop) => {
                let Node::Expr(object) = prop.parent() else {
                    return false;
                };
                if prop.is_jsx_attribute() || prop.value() != Some(node) {
                    return false;
                }
                match (prop.kind() == PropKind::Spread, is_pattern(object)) {
                    // A `RestElement` or a `SpreadElement`.
                    (true, is_rest) => return is_rest,
                    // A `Property` of an `ObjectPattern`.
                    (false, true) => return false,
                    (false, false) => object,
                }
            }
            _ => return false,
        };
    }
}

/// typescript-eslint's `isConditionalTest`: whether the value of `e` only matters as true or false.
/// It is the test of an `if`, a loop or a conditional expression, possibly through `&&`, `||`,
/// `??`, `!`, a branch of a conditional expression or the last operand of a comma.
pub fn is_conditional_test(e: Expr<'_>) -> bool {
    let mut node = e;
    loop {
        node = match node.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. }
                | ExprKind::Unary { op: UnOp::Not, .. } => parent,
                ExprKind::Cond { test, .. } if test == node => return true,
                ExprKind::Cond { .. } => parent,
                ExprKind::Binary { op: BinOp::Comma, right, .. }
                    if right == node && is_sequence_root(parent) =>
                {
                    parent
                }
                _ => return false,
            },
            Node::Stmt(parent) => {
                return match parent.kind() {
                    StmtKind::DoWhile { test, .. }
                    | StmtKind::If { test, .. }
                    | StmtKind::While { test, .. } => test == node,
                    StmtKind::For { test, .. } => test == Some(node),
                    _ => false,
                };
            }
            _ => return false,
        };
    }
}

/// typescript-eslint's `getParentFunctionNode`: the innermost function around the node, not the
/// node itself. Static blocks, signatures and function types do not count.
pub fn get_parent_function_node<'a>(node: impl Into<Node<'a>>) -> Option<Func<'a>> {
    node.into().ancestors().find_map(|it| it.as_func().and_then(|func| as_function(func)))
}

/// typescript-eslint's `getTextWithParentheses`: the text of `e` with the innermost pair of
/// parentheses around it, if there is one.
pub fn get_text_with_parentheses(e: Expr<'_>) -> &[u8] {
    e.file().slice(e.parens().next().unwrap_or_else(|| e.span()))
}

/// typescript-eslint's `getAwaitTokenRemovalRange`: from the start of the `await` token to the
/// start of the token or the comment after it.
pub fn get_await_token_removal_range<'a>(file: &'a File<'a>, await_token: impl Spanned) -> Span {
    let token = await_token.span();
    let next = file.tokens_after(token).with_comments().next();
    Span::new(token.start, next.map_or(token.end, |it| it.start()))
}

/// The `fixOrSuggest` of typescript-eslint's `getFixOrSuggest`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FixOrSuggest {
    Fix,
    None,
    Suggest,
}

/// typescript-eslint's `getFixOrSuggest`: adds `fix` to `report` as its fix, as a suggestion with
/// the message `message`, or not at all.
///
/// ```ignore
/// let report = cx.report(node, PREFER_RECORD);
/// get_fix_or_suggest(report, FixOrSuggest::Suggest, PREFER_RECORD_SUGGESTION, |fixer| ..);
/// ```
pub fn get_fix_or_suggest<'a, F: IntoFix>(
    report: Report<'a>,
    fix_or_suggest: FixOrSuggest,
    message: Message,
    fix: impl FnOnce(Fixer<'a>) -> F,
) -> Report<'a> {
    get_fix_or_suggest_with(report, fix_or_suggest, message, &[], fix)
}

/// typescript-eslint's `getFixOrSuggest`, for a suggestion whose message has `{{placeholders}}`.
pub fn get_fix_or_suggest_with<'a, F: IntoFix>(
    report: Report<'a>,
    fix_or_suggest: FixOrSuggest,
    message: Message,
    data: &[(&'static str, &[u8])],
    fix: impl FnOnce(Fixer<'a>) -> F,
) -> Report<'a> {
    match fix_or_suggest {
        FixOrSuggest::Fix => report.fix(fix),
        FixOrSuggest::None => report,
        FixOrSuggest::Suggest => report.suggest_with(message, data, fix),
    }
}

/// typescript-eslint's `walkStatements`: the statements of `body` and of the blocks, branches, loop
/// bodies, `switch` cases, labeled statements and `try` statements in it, in source order. Those
/// containers are not yielded themselves, and nothing inside an expression or a nested function is
/// visited.
pub fn walk_statements<'a>(body: impl IntoIterator<Item = Stmt<'a>>) -> WalkStatements<'a> {
    let mut stack: SmallVec<[Stmt<'a>; 16]> = body.into_iter().collect();
    stack.reverse();
    WalkStatements { stack }
}

/// What [`walk_statements`] returns.
pub struct WalkStatements<'a> {
    /// What is left, the next on top.
    stack: SmallVec<[Stmt<'a>; 16]>,
}

impl<'a> Iterator for WalkStatements<'a> {
    type Item = Stmt<'a>;

    fn next(&mut self) -> Option<Stmt<'a>> {
        loop {
            let statement = self.stack.pop()?;
            let first = self.stack.len();
            match statement.kind() {
                StmtKind::Block(statements) => self.stack.extend(statements),
                StmtKind::Switch { cases, .. } => {
                    cases.iter().for_each(|case| self.stack.extend(case.body()));
                }
                StmtKind::If { yes, no, .. } => {
                    self.stack.push(yes);
                    self.stack.extend(no);
                }
                StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                | StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::With { body, .. }
                | StmtKind::Labeled { body, .. } => self.stack.push(body),
                StmtKind::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => {
                    self.stack.push(block);
                    self.stack.extend(handler);
                    self.stack.extend(finalizer);
                }
                _ => return Some(statement),
            }
            self.stack[first..].reverse();
        }
    }
}

/// typescript-eslint's `forEachReturnStatement`: calls `visitor` with the `return` statements of
/// `func`, not those of nested functions, until it returns `Some`, which is the result.
pub fn for_each_return_statement<'a, T>(
    func: Func<'a>,
    visitor: impl FnMut(Stmt<'a>) -> Option<T>,
) -> Option<T> {
    func.returns().find_map(visitor)
}

/// typescript-eslint's `forEachChildESTree`: calls `callback` with the node and then with
/// everything in it, in source order, until it returns `Some`, which is the result.
///
/// The nodes are those of this AST. What ESTree has one node for can be two here: an `Expr` or a
/// `Stmt` and the `Func` or the `Class` in it.
pub fn for_each_child_estree<'a, T>(
    node: impl Into<Node<'a>>,
    mut callback: impl FnMut(Node<'a>) -> Option<T>,
) -> Option<T> {
    let mut stack: SmallVec<[Node<'a>; 16]> = SmallVec::new();
    stack.push(node.into());
    while let Some(current) = stack.pop() {
        if let Some(result) = callback(current) {
            return Some(result);
        }
        let first = stack.len();
        current.for_each_child(|child| stack.push(child));
        stack[first..].reverse();
    }
    None
}
