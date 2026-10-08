//! `getFunctionHeadLoc.ts`, `getMemberHeadLoc.ts`, `getForStatementHeadLoc.ts`.

use crate::ast::{
    Expr, Flags, Func, KeyKind, List, Member, MemberKind, Modifier, Node, Param, PropKind, Stmt,
    StmtKind,
};
use crate::span::Span;
use crate::tokens::{skip_trivia, skip_trivia_back};
use crate::utils::estree_compat::estree_span;

/// The start of the first token after the last decorator among `modifiers`, or `start` if there is
/// no decorator.
fn start_after_decorators<'a>(modifiers: List<'a, Modifier<'a>>, text: &[u8], start: u32) -> u32 {
    match modifiers.iter().rfind(|it| it.decorator().is_some()) {
        Some(last) => skip_trivia(text, last.span().end),
        None => start,
    }
}

/// A `MethodDefinition` or a `PropertyDefinition`: not abstract, not an `accessor` property.
fn is_method_or_property_definition(member: Member<'_>) -> bool {
    let flags = member.flags();
    !flags.contains(Flags::ABSTRACT)
        && matches!(member.parent(), Node::Class(_))
        && match member.kind() {
            MemberKind::Property => !flags.contains(Flags::ACCESSOR),
            MemberKind::Method
            | MemberKind::Getter
            | MemberKind::Setter
            | MemberKind::Constructor => true,
            _ => false,
        }
}

/// Whether `e` is the initializer or the computed key of `member`, as opposed to a decorator.
fn is_value_or_key<'a>(member: Member<'a>, e: Expr<'a>) -> bool {
    member.init() == Some(e)
        || matches!(member.key().map(|key| key.kind()), Some(KeyKind::Computed(key)) if key == e)
}

/// Upstream's `getOpeningParenOfParams`: where the `(` of the parameters starts. For an arrow
/// function with one parameter and no parentheses, where that parameter starts.
fn opening_paren_of_params(func: Func<'_>) -> u32 {
    let file = func.file();
    let text = file.text();
    if func.is_arrow()
        && func.params().len() == 1
        && let Some(param) = func.params().first()
    {
        let start = estree_span(Node::Param(param)).start;
        let before = skip_trivia_back(text, start);
        return match before.checked_sub(1) {
            Some(paren) if text.get(paren as usize) == Some(&b'(') => paren,
            _ => start,
        };
    }
    if func.type_params().is_empty()
        && let Some(paren) = func.open_paren()
    {
        return paren;
    }
    // Upstream takes the first `(` after the name, which can be one in the type parameters.
    let from = match func.name() {
        Some(name) => name.span().end,
        None => estree_span(Node::Func(func)).start,
    };
    file.tokens_in(Span::new(from, func.span().end))
        .find(|token| token.is_punctuator("("))
        .map_or(from, |token| token.start())
}

/// typescript-eslint's `getFunctionHeadLoc`, which is ESLint's except that it leaves out the
/// decorators of a class member. What to report a function at:
///
/// - the `=>` of an arrow function,
/// - a method, an accessor, or a function or an arrow function that is the value of a property of
///   a class or of an object literal: from the start of the member or the property to the `(`,
/// - any other function: from its start to the `(`.
pub fn get_function_head_loc(func: Func<'_>) -> Span {
    let text = func.file().text();
    let owner = func.owner();
    let member_or_property_start = match owner {
        Node::Member(member) if is_method_or_property_definition(member) => {
            Some(start_after_decorators(member.modifiers(), text, member.span().start))
        }
        Node::Expr(e) => match e.parent() {
            Node::Member(member)
                if is_method_or_property_definition(member) && is_value_or_key(member, e) =>
            {
                Some(start_after_decorators(member.modifiers(), text, member.span().start))
            }
            Node::Prop(prop) if prop.kind() != PropKind::Spread && !prop.is_jsx_attribute() => {
                Some(prop.span().start)
            }
            _ => None,
        },
        _ => None,
    };
    match (member_or_property_start, func.arrow_span()) {
        (Some(start), _) => Span::new(start, opening_paren_of_params(func)),
        (None, Some(arrow)) => arrow,
        (None, None) => {
            Span::new(estree_span(Node::Func(func)).start, opening_paren_of_params(func))
        }
    }
}

/// typescript-eslint's `getMemberHeadLoc`: a member of a class from its first modifier, without
/// its decorators, to the end of its name.
pub fn get_member_head_loc(member: Member<'_>) -> Span {
    let file = member.file();
    let text = file.text();
    let start = start_after_decorators(member.modifiers(), text, member.span().start);
    let end = match (member.key(), member.func().and_then(Func::open_paren)) {
        (Some(key), _) => key.span(file).end,
        // A constructor.
        (None, Some(paren)) => skip_trivia_back(text, paren),
        (None, None) => member.span().end,
    };
    Span::new(start, end)
}

/// typescript-eslint's `getParameterPropertyHeadLoc`: a parameter property from its first
/// modifier, without its decorators, to the end of its name, which is `node_name`.
pub fn get_parameter_property_head_loc(param: Param<'_>, node_name: &[u8]) -> Span {
    let text = param.file().text();
    let start = start_after_decorators(param.modifiers(), text, param.span().start);
    Span::new(start, param.pat().span().start + node_name.len() as u32)
}

/// typescript-eslint's `getForStatementHeadLoc`: a `for`, a `for`-`in` or a `for`-`of` statement
/// from its start to the `)` before its body.
pub fn get_for_statement_head_loc(statement: Stmt<'_>) -> Span {
    let whole = statement.span();
    match statement.kind() {
        StmtKind::For { body, .. } | StmtKind::ForIn { body, .. } | StmtKind::ForOf { body, .. } => {
            let text = statement.file().text();
            Span::new(whole.start, skip_trivia_back(text, body.span().start))
        }
        _ => whole,
    }
}
