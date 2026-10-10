#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/ast.js` of eslint-plugin-react.
//!
//! | upstream | here |
//! |---|---|
//! | `isParenthesized(context, node)` | `ast_utils::is_parenthesised(node)` |
//! | `isCallExpression(node)` | `e.tag() == ExprTag::Call` |
//! | `isFunctionLikeExpression`, `isFunction`, `isFunctionLike` | `func.kind()` |
//! | `isClass(node)` | `Node::Class` |
//! | `isTSAsExpression(node)` | [`unwrap_ts_as_expression`] returns something else |
//! | the other `isTS*` | `ty.kind()` |
//!
//! The whole of an optional chain is taken for the `MemberExpression`, not for the
//! `ChainExpression` around it: who gets to it from above asks `is_chain_root()` first.

use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::estree_compat::{get_node_by_range_index, normalize};
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;
use std::ops::ControlFlow;

/// What the `enter` of a visitor does: nothing, `this.skip()`, `this.break()`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Enter {
    Children,
    Skip,
    Break,
}

/// The nodes that are still to be entered. The next one is the last.
type Worklist<'a> = SmallVec<[Node<'a>; 8]>;

/// `traverse`, for a visitor with an `enter`. Only what a visitor of the plugin goes into has
/// children: the statements below, a `SwitchCase`, a `ConditionalExpression`.
pub(crate) fn traverse<'a>(node: Node<'a>, enter: &mut dyn FnMut(Node<'a>) -> Enter) {
    traverse_all(smallvec![node], enter);
}

fn traverse_all<'a>(mut worklist: Worklist<'a>, enter: &mut dyn FnMut(Node<'a>) -> Enter) {
    while let Some(node) = worklist.pop() {
        match enter(node) {
            Enter::Children => {}
            Enter::Skip => continue,
            Enter::Break => return,
        }
        let first = worklist.len();
        match node {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Block(body) => worklist.extend(body.iter().map(Node::Stmt)),
                StmtKind::If { test, yes, no } => {
                    worklist.extend([Node::Expr(test), Node::Stmt(yes)]);
                    worklist.extend(no.map(Node::Stmt));
                }
                StmtKind::For {
                    init,
                    test,
                    update,
                    body,
                } => {
                    worklist.extend(init.map(|it| match it.kind() {
                        StmtKind::Expr(e) => Node::Expr(e),
                        _ => Node::Stmt(it),
                    }));
                    worklist.extend(test.into_iter().chain(update).map(Node::Expr));
                    worklist.push(Node::Stmt(body));
                }
                StmtKind::While { test, body } => {
                    worklist.extend([Node::Expr(test), Node::Stmt(body)]);
                }
                StmtKind::Switch { expr, cases } => {
                    worklist.push(Node::Expr(expr));
                    worklist.extend(cases.iter().map(Node::Case));
                }
                _ => {}
            },
            Node::Case(case) => {
                worklist.extend(case.test().map(Node::Expr));
                worklist.extend(case.body().iter().map(Node::Stmt));
            }
            Node::Expr(e) => {
                if let ExprKind::Cond { test, yes, no } = e.kind() {
                    worklist.extend([test, yes, no].map(Node::Expr));
                }
            }
            _ => {}
        }
        if let Some(children) = worklist.get_mut(first..) {
            children.reverse();
        }
    }
}

/// `loopNodes`
fn loop_nodes<'a>(mut nodes: List<'a, Stmt<'a>>) -> Option<Stmt<'a>> {
    'nodes: loop {
        for node in nodes.iter().rev() {
            match node.kind() {
                StmtKind::Return(_) => return Some(node),
                StmtKind::Switch { cases, .. } => {
                    if let Some(last) = cases.last() {
                        nodes = last.body();
                        continue 'nodes;
                    }
                }
                _ => {}
            }
        }
        return None;
    }
}

/// `findReturnStatement`, for a function, a `Member` or a `Prop`: the last `return` directly in the
/// body, or what this finds in the last case of a `switch` that comes after it.
pub(crate) fn find_return_statement(node: Node<'_>) -> Option<Stmt<'_>> {
    let func = match normalize(node) {
        Node::Func(func) => Some(func).filter(|it| ast_utils::is_function_with_body(*it)),
        Node::Member(member) => Property::Member(member).func(),
        Node::Prop(prop) => Property::Prop(prop).func(),
        _ => None,
    };
    loop_nodes(func?.body_statements()?)
}

/// `traverseReturns`, for a `return` statement or a function. It looks into blocks, `if`, `for`,
/// `while` and `switch` only. A `MethodDefinition` has no `body`: nothing is called for a `Member`.
pub(crate) fn traverse_returns<'a>(
    node: Node<'a>,
    on_return: &mut dyn FnMut(Option<Expr<'a>>) -> ControlFlow<()>,
) {
    let body = match normalize(node) {
        Node::Stmt(statement) => {
            if let StmtKind::Return(argument) = statement.kind() {
                let _ = on_return(argument);
            }
            return;
        }
        Node::Func(func) if ast_utils::is_function_with_body(func) => func.body(),
        _ => return,
    };
    let statements = match body {
        FnBody::Expr(e) => {
            let _ = on_return(Some(e));
            return;
        }
        FnBody::Block(statements) => statements,
        FnBody::None => return,
    };
    let worklist = statements.iter().rev().map(Node::Stmt).collect();
    traverse_all(worklist, &mut |node| match node {
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Return(argument) => match on_return(argument) {
                ControlFlow::Continue(()) => Enter::Skip,
                ControlFlow::Break(()) => Enter::Break,
            },
            StmtKind::Block(_)
            | StmtKind::If { .. }
            | StmtKind::For { .. }
            | StmtKind::While { .. }
            | StmtKind::Switch { .. } => Enter::Children,
            _ => Enter::Skip,
        },
        Node::Case(_) => Enter::Children,
        _ => Enter::Skip,
    });
}

/// `name` without the `#` of a private name, which is not in the `name` of a `PrivateIdentifier`.
fn without_hash(name: &[u8]) -> &[u8] {
    name.strip_prefix(b"#").unwrap_or(name)
}

/// `key.name`: of an `Identifier`, in brackets or not, and of a `PrivateIdentifier`.
pub(crate) fn name_of_key(key: Key<'_>) -> Option<&[u8]> {
    match key.kind() {
        KeyKind::Ident(name) => Some(name.bytes()),
        KeyKind::Private(name) => Some(without_hash(name.bytes())),
        KeyKind::Computed(e) => e.as_ident().map(Name::bytes),
        _ => None,
    }
}

/// What `getPropertyNameNode` returns, and the `key` of `getKeyValue`.
#[derive(Copy, Clone)]
enum NameNode<'a> {
    Key(Key<'a>),
    /// The `constructor` of a constructor, the `b` of `a.b`.
    Ident(Ident<'a>),
    /// The `b` of `a[b]`, the `a` of `...a`.
    Expr(Expr<'a>),
}

impl<'a> NameNode<'a> {
    /// `node.key`
    fn key_of(node: Node<'a>) -> Option<NameNode<'a>> {
        match node {
            Node::Member(member) => match member.constructor_keyword() {
                Some(keyword) => Some(NameNode::Ident(keyword)),
                None => member.key().map(NameNode::Key),
            },
            Node::Prop(prop) if !prop.is_jsx_attribute() => prop.key().map(NameNode::Key),
            Node::PatProp(prop) => prop.key().map(NameNode::Key),
            _ => None,
        }
    }

    /// `getPropertyNameNode(node)`
    fn of(node: Node<'a>) -> Option<NameNode<'a>> {
        match node {
            Node::Expr(e) if ast_utils::is_member_expression(e) => match e.kind() {
                ExprKind::Dot { name, .. } => Some(NameNode::Ident(name)),
                ExprKind::Index { index, .. } => Some(NameNode::Expr(index)),
                _ => None,
            },
            _ => NameNode::key_of(node),
        }
    }

    fn span(self, file: &'a File<'a>) -> Span {
        match self {
            NameNode::Key(key) => key.inner_span(file),
            NameNode::Ident(name) => name.span(),
            NameNode::Expr(e) => e.span(),
        }
    }

    /// `nameNode.name`
    fn name(self) -> Option<&'a [u8]> {
        match self {
            NameNode::Key(key) => name_of_key(key),
            NameNode::Ident(name) => (!name.is_string()).then(|| without_hash(name.bytes())),
            NameNode::Expr(e) => e.as_ident().map(Name::bytes),
        }
    }

    /// `key.type === "Identifier" ? key.name : key.value`, the latter as `String(value)`.
    fn name_or_value(self, file: &'a File<'a>) -> Option<Cow<'a, [u8]>> {
        let e = match self {
            NameNode::Key(key) => match key.kind() {
                KeyKind::Ident(name)
                | KeyKind::String(name)
                | KeyKind::Number(name)
                | KeyKind::ComputedNumber(name) => return Some(Cow::Borrowed(name.bytes())),
                // A `TemplateLiteral` has no `value`.
                KeyKind::ComputedString(name) => {
                    let is_template = file.slice(key.inner_span(file)).starts_with(b"`");
                    return (!is_template).then(|| Cow::Borrowed(name.bytes()));
                }
                KeyKind::Private(_) => return None,
                KeyKind::Computed(e) => e,
            },
            NameNode::Ident(name) => return Some(Cow::Borrowed(name.bytes())),
            NameNode::Expr(e) => e,
        };
        match e.kind() {
            ExprKind::Ident(name) => Some(Cow::Borrowed(name.bytes())),
            ExprKind::Template(_) => None,
            _ => ast_utils::get_static_string_value(e),
        }
    }
}

/// `getPropertyNameNode`, for a `Member`, a `Prop`, a `PatProp`, a `Dot` or an `Index`: its range.
pub(crate) fn get_property_name_node(node: Node<'_>) -> Option<Span> {
    Some(NameNode::of(node)?.span(node.file()))
}

/// `getPropertyName`. `None` where upstream has `""` or `undefined`.
pub(crate) fn get_property_name(node: Node<'_>) -> Option<&[u8]> {
    NameNode::of(node)?.name()
}

/// An element of what `getComponentProperties` returns.
#[derive(Copy, Clone)]
pub(crate) enum Property<'a> {
    Member(Member<'a>),
    Prop(Prop<'a>),
}

impl<'a> Property<'a> {
    pub(crate) fn node(self) -> Node<'a> {
        match self {
            Property::Member(it) => Node::Member(it),
            Property::Prop(it) => Node::Prop(it),
        }
    }

    /// `None` also for a constructor: see [`Member::constructor_keyword`].
    pub(crate) fn key(self) -> Option<Key<'a>> {
        match self {
            Property::Member(it) => it.key(),
            Property::Prop(it) => it.key(),
        }
    }

    /// `getPropertyName(property)`
    pub(crate) fn name(self) -> Option<&'a [u8]> {
        get_property_name(self.node())
    }

    /// `property.value`. That of a method of a class is no expression: it has only [`Self::func`].
    pub(crate) fn value(self) -> Option<Expr<'a>> {
        match self {
            Property::Member(it) => it.init(),
            Property::Prop(it) if it.kind() == PropKind::Spread || it.is_jsx_attribute() => None,
            Property::Prop(it) => it.value(),
        }
    }

    /// `property.value`, if that is a `FunctionExpression` or an `ArrowFunctionExpression`.
    pub(crate) fn func(self) -> Option<Func<'a>> {
        let func = match self {
            Property::Member(it) => match it.kind() {
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => it.func(),
                _ => it.init().and_then(Expr::as_fn),
            },
            Property::Prop(_) => self.value().and_then(Expr::as_fn),
        };
        func.filter(|it| ast_utils::is_function_with_body(*it))
    }

    /// `property.static`
    pub(crate) fn is_static(self) -> bool {
        match self {
            Property::Member(it) => it.kind() != MemberKind::StaticBlock && it.is_static(),
            Property::Prop(_) => false,
        }
    }
}

/// `getComponentProperties`, for a class or an object literal. Empty for anything else.
pub(crate) fn get_component_properties(node: Node<'_>) -> SmallVec<[Property<'_>; 8]> {
    match normalize(node) {
        Node::Class(class) => class.members().iter().map(Property::Member).collect(),
        Node::Expr(e) => match e.kind() {
            ExprKind::Object(properties) if !e.is_assignment_target() => {
                properties.iter().map(Property::Prop).collect()
            }
            _ => SmallVec::new(),
        },
        _ => SmallVec::new(),
    }
}

/// `token.value` of a `JSXText`. espree has what `&nbsp;` and the like stand for in the text
/// between tags, typescript-estree has it as it is written.
fn value_of_jsx_text<'a>(file: &'a File<'a>, token: Token<'a>) -> Cow<'a, [u8]> {
    let is_decoded = strings::contains_char(token.text(), b'&')
        && file.is_javascript()
        && !file.uses_typescript_parser();
    let decoded = match is_decoded.then(|| get_node_by_range_index(file, token.start())) {
        Some(Node::Expr(e)) => e.jsx_text_value(),
        _ => None,
    };
    decoded.unwrap_or_else(|| Cow::Borrowed(token.text()))
}

/// `getFirstNodeInLine`: the token before `node` and before the text of JSX whose last line is
/// blank. `None` where upstream throws: there is none.
pub(crate) fn get_first_node_in_line<'a>(file: &'a File<'a>, node: Span) -> Option<Token<'a>> {
    file.tokens_before(node).find(|token| {
        if token.kind() != TokenKind::JsxText {
            return true;
        }
        let value = value_of_jsx_text(file, *token);
        let last_line = strings::last_index_of_char(&value, b'\n').map_or(0, |at| at + 1);
        !strings::is_all_js_whitespace(value.get(last_line..).unwrap_or_default())
    })
}

/// `isNodeFirstInLine`
pub(crate) fn is_node_first_in_line<'a>(file: &'a File<'a>, node: Span) -> bool {
    get_first_node_in_line(file, node)
        .is_none_or(|token| file.line_of(node.start) != file.line_of(token.end()))
}

/// `inConstructor`
pub(crate) fn in_constructor(node: Node<'_>) -> bool {
    node.scope().chain().any(|scope| match scope.node() {
        Node::Func(func) => matches!(func.owner(), Node::Member(it) if it.is_constructor()),
        _ => false,
    })
}

/// `getKeyValue`, for a `Member`, a `Prop` or a `PatProp`. What is no string comes as
/// `String(value)`: upstream's callers take the keys `0` and `0n` for none.
pub(crate) fn get_key_value(node: Node<'_>) -> Option<Cow<'_, [u8]>> {
    let argument = || match node {
        Node::Prop(prop) if prop.kind() == PropKind::Spread => prop.value(),
        _ => None,
    };
    if let Node::PatProp(prop) = node
        && prop.is_rest()
    {
        return Some(Cow::Borrowed(prop.value().as_ident()?.bytes()));
    }
    NameNode::key_of(node)
        .or_else(|| argument().map(NameNode::Expr))?
        .name_or_value(node.file())
}

/// `isAssignmentLHS`
pub(crate) fn is_assignment_lhs(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Assign
        && parent.left() == Some(e)
        && !parent.is_assignment_target())
}

/// `unwrapTSAsExpression`: one `as`, not a `<T>e`.
pub(crate) fn unwrap_ts_as_expression(e: Expr<'_>) -> Expr<'_> {
    match e.kind() {
        ExprKind::As { expr, .. } | ExprKind::AsConst(expr) if !e.is_angle_bracket_assertion() => {
            expr
        }
        _ => e,
    }
}
