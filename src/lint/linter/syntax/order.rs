//! Which of several errors typescript-estree comes to first.
//!
//! `Converter` checks a node, then converts its children in the order in which the code names them, which mostly is the
//! alphabetical order of the properties of the ESTree node: the `body` of a function before its `params`, the `alternate` of an
//! `if` before its `test`. Only a file with more than one error is looked at here.

use crate::ast::{ExprKind, File, FnKind, Func, KeyKind, Node, StmtKind, TypeKind};
use crate::span::Span;

/// When a check happens, apart from the node that it is about.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum When {
    /// Before anything of the node is converted.
    First,
    /// Where `convertTypeArguments` is called for the node that has the list.
    TypeArguments,
    /// The same for `convertTypeParameters`.
    TypeParameters,
    /// Before anything of the `CatchClause` is converted, which here is a part of the `try`.
    CatchClause,
}

pub(super) struct Candidate {
    /// The node that is checked. For a list of types, the place of its `<`.
    pub(super) node: Span,
    pub(super) when: When,
    /// Orders the checks of one node.
    pub(super) step: u32,
}

fn outer_span(node: Node) -> Span {
    match node {
        Node::Expr(it) => it.outer_span(),
        Node::Type(it) => it.outer_span(),
        _ => node.span(),
    }
}

fn contains(outer: Span, inner: Span) -> bool {
    match inner.is_empty() {
        true => outer.start <= inner.start && inner.start < outer.end,
        false => outer.start <= inner.start && inner.end <= outer.end,
    }
}

/// `MethodDeclaration`, `GetAccessor`, `SetAccessor` that are not signatures.
fn is_method(func: Func) -> bool {
    matches!(
        func.kind(),
        FnKind::Method | FnKind::Getter | FnKind::Setter
    ) && !matches!(func.owner(), Node::Member(member) if member.is_signature())
}

/// The ranks of the body, the parameters, the return type and the type parameters of a function.
fn ranks_in_function(func: Func) -> [u16; 4] {
    match func.kind() {
        _ if is_method(func) => [1, 4, 2, 3],
        FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Constructor | FnKind::StaticBlock => {
            [1, 2, 3, 4]
        }
        _ => [4, 1, 2, 3],
    }
}

/// When `child` is converted, among the children of `parent`. From 1: the checks of `parent` itself come first.
fn rank<'a>(parent: Node<'a>, child: Node<'a>) -> u16 {
    let is = |it: Node<'a>| it == child;
    let is_some = |it: Option<Node<'a>>| it == Some(child);
    match parent {
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::If { yes, no, .. } => {
                if is_some(no.map(Node::Stmt)) {
                    1
                } else if is(Node::Stmt(yes)) {
                    2
                } else {
                    3
                }
            }
            StmtKind::For {
                body, init, test, ..
            } => {
                if is(Node::Stmt(body)) {
                    1
                } else if is_some(test.map(Node::Expr)) {
                    3
                } else if init.is_some_and(|it| contains(it.span(), outer_span(child))) {
                    2
                } else {
                    4
                }
            }
            StmtKind::ForIn { body, expr, .. } | StmtKind::ForOf { body, expr, .. } => {
                if is(Node::Stmt(body)) {
                    1
                } else if is(Node::Expr(expr)) {
                    3
                } else {
                    2
                }
            }
            StmtKind::While { body, .. } | StmtKind::With { body, .. } => {
                2 - u16::from(is(Node::Stmt(body)))
            }
            StmtKind::Switch { expr, .. } => 1 + u16::from(is(Node::Expr(expr))),
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                if is(Node::Stmt(block)) {
                    1
                } else if is_some(finalizer.map(Node::Stmt)) {
                    2
                } else if is_some(handler.map(Node::Stmt)) {
                    4
                } else {
                    5
                }
            }
            StmtKind::Interface(_) => match child {
                Node::Type(_) => 1,
                Node::Member(_) => 2,
                _ => 3,
            },
            StmtKind::TypeAlias(_) => 1 + u16::from(matches!(child, Node::TypeParam(_))),
            _ => 1,
        },
        Node::Case(case) => 1 + u16::from(is_some(case.test().map(Node::Expr))),
        Node::Func(func) => {
            let [body, params, return_type, type_params] = ranks_in_function(func);
            match child {
                Node::TypeParam(_) => type_params,
                Node::Param(_) => params,
                Node::Type(_) => return_type,
                _ => body,
            }
        }
        Node::Class(class) => match child {
            Node::Member(_) => 1,
            Node::Expr(it) if class.extends() == Some(it) => 4,
            Node::Expr(_) => 2,
            Node::Type(it) if class.implements().iter().any(|element| element == it) => 3,
            Node::TypeParam(_) => 5,
            _ => 6,
        },
        Node::Member(member) => {
            let is_key = matches!(member.key().map(|it| it.kind()), Some(KeyKind::Computed(key)) if is(Node::Expr(key)));
            let is_method = member.func().is_some_and(is_method);
            match child {
                Node::Func(_) if is_method => 1,
                Node::Func(_) => 3,
                Node::Type(_) => 4,
                Node::Expr(it) if member.init() == Some(it) => 5,
                // Of a method the decorators come first, of a property the key.
                Node::Expr(_) if is_key == is_method => 3,
                _ => 2,
            }
        }
        Node::Prop(prop) => match prop.func().is_some() {
            true => 2 - u16::from(is_some(prop.value().map(Node::Expr))),
            false => 1 + u16::from(is_some(prop.value().map(Node::Expr))),
        },
        Node::Param(param) => match child {
            Node::Pat(_) => 1,
            Node::Expr(it) if param.default() == Some(it) => 2,
            Node::Type(_) => 3,
            _ => 4,
        },
        Node::VarDecl(_) => match child {
            Node::Expr(_) => 1,
            Node::Pat(_) => 2,
            _ => 3,
        },
        Node::Expr(expr) => match expr.kind() {
            ExprKind::Cond { yes, no, .. } => {
                if is(Node::Expr(no)) {
                    1
                } else if is(Node::Expr(yes)) {
                    2
                } else {
                    3
                }
            }
            ExprKind::Call(call) => match child {
                Node::Type(_) => 3,
                _ => 2 - u16::from(is(Node::Expr(call.callee()))),
            },
            ExprKind::New(call) => match child {
                Node::Type(_) => 1,
                _ => 2 + u16::from(is(Node::Expr(call.callee()))),
            },
            ExprKind::TaggedTemplate(call) => match child {
                Node::Type(_) => 3,
                _ => 1 + u16::from(is(Node::Expr(call.callee()))),
            },
            ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::Instantiation { .. } => {
                1 + u16::from(matches!(child, Node::Type(_)))
            }
            ExprKind::Jsx(jsx) => match child {
                Node::Prop(_) => 3,
                Node::Type(_) => 5,
                Node::Expr(it) if jsx.tag() == Some(it) => 4,
                Node::Expr(it) if jsx.close_tag() == Some(it) => 2,
                _ => 1,
            },
            _ => 1,
        },
        Node::Type(ty) => match ty.kind() {
            TypeKind::Cond {
                check, extends, no, ..
            } => {
                if is(Node::Type(check)) {
                    1
                } else if is(Node::Type(extends)) {
                    2
                } else if is(Node::Type(no)) {
                    3
                } else {
                    4
                }
            }
            TypeKind::IndexedAccess { index, .. } => 2 - u16::from(is(Node::Type(index))),
            TypeKind::Typeof { .. } | TypeKind::Heritage { .. } => {
                1 + u16::from(matches!(child, Node::Type(_)))
            }
            _ => 1,
        },
        _ => 1,
    }
}

/// When a check of `node` happens that is not the first thing.
fn rank_of_check(node: Node, when: When) -> u16 {
    match (when, node) {
        (When::First, _) => 0,
        (When::CatchClause, _) => 3,
        (When::TypeParameters, Node::Func(func)) => ranks_in_function(func)[3],
        (When::TypeParameters, Node::Class(_)) => 5,
        (When::TypeParameters, Node::Stmt(it)) => match it.kind() {
            StmtKind::Interface(_) => 3,
            _ => 2,
        },
        (When::TypeArguments, Node::Class(_)) => 6,
        (When::TypeArguments, Node::Expr(it)) => match it.kind() {
            ExprKind::New(_) => 1,
            ExprKind::Jsx(_) => 5,
            ExprKind::Instantiation { .. } => 2,
            _ => 3,
        },
        (When::TypeArguments, Node::Type(it)) => match it.kind() {
            TypeKind::Typeof { .. } | TypeKind::Heritage { .. } => 2,
            _ => 1,
        },
        _ => 1,
    }
}

/// The index of the candidate whose check comes first.
pub(super) fn first<'a>(file: &'a File<'a>, candidates: &[Candidate]) -> Option<usize> {
    let mut inside: Vec<usize> = (0..candidates.len()).collect();
    let mut at = Node::File(file);
    let mut children: Vec<(Span, Node<'a>)> = Vec::new();
    loop {
        children.clear();
        at.for_each_child(|child| children.push((outer_span(child), child)));
        // Many children are the elements of a list: in order, and apart from each other.
        let are_many = children.len() > 16;
        let child_with = |node: Span| -> Option<usize> {
            if are_many {
                let after = children.partition_point(|it| it.0.start <= node.start);
                return after
                    .checked_sub(1)
                    .filter(|&i| contains(children[i].0, node));
            }
            // A method has the span of the member, with its decorators and its key.
            (0..children.len())
                .filter(|&i| contains(children[i].0, node))
                .min_by_key(|&i| children[i].0.len())
        };
        // By when it happens: the rank, the place in a list, the step. A child, or a check of `at`.
        let mut best: Option<((u16, u32, u32), Option<usize>, usize)> = None;
        for &i in &inside {
            let it = &candidates[i];
            let child = child_with(it.node);
            let order = match child {
                Some(child) => (rank(at, children[child].1), children[child].0.start, 0),
                None => (rank_of_check(at, it.when), it.node.start, it.step),
            };
            if best.is_none_or(|it| order < it.0) {
                best = Some((order, child, i));
            }
        }
        let (_, child, candidate) = best?;
        let Some(child) = child else {
            return Some(candidate);
        };
        inside.retain(|&i| child_with(candidates[i].node) == Some(child));
        at = children[child].1;
    }
}
