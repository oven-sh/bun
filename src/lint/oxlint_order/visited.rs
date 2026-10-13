//! With which node oxlint calls a rule for what the rule reports.
//!
//! Nothing records that while the rules here run: a file about which nothing is reported is not to pay for it. So the node is
//! found again from what is reported and from the kinds of node that oxlint calls the rule with. Most rules report the node
//! that they are called with, or something in it. The rest of what is tried here is what the other rules do.

use super::{kind_named, name_of_kind};
use crate::ast::{ExprKind, ExprTag, File, Node, PropKind, StmtKind};
use crate::semantic::Declaration;
use crate::span::Span;
use crate::utils::estree_compat::{
    estree_parent, estree_span, estree_type_name, get_node_by_range_index, is_assignment_target,
    is_chain_root, normalize,
};
use smallvec::SmallVec;
use std::cmp::Reverse;

/// Where a node is among the nodes of oxc, which are in the order in which a walk enters them: less for an earlier one. The
/// start, the end, and how deep it is, which tells apart what is written from the same place to the same place.
pub(crate) type Place = (u32, Reverse<u32>, u32);

/// A node here stands for four of oxc at most.
const LEVELS: u32 = 4;

fn literal(text: &[u8]) -> &'static str {
    match text {
        [b'"' | b'\'', ..] => "StringLiteral",
        [b'/', ..] => "RegExpLiteral",
        b"null" => "NullLiteral",
        b"true" | b"false" => "BooleanLiteral",
        [b'0', b'x' | b'X', ..] => "NumericLiteral",
        [.., b'n'] => "BigIntLiteral",
        _ => "NumericLiteral",
    }
}

/// What oxc calls the node that [`estree_type_name`] names. Empty: it has a kind of node for it that no rule is called with.
fn name_in_oxc(node: Node) -> &'static str {
    let text = node.file().text();
    match (estree_type_name(node), node) {
        (_, Node::Param(_)) => "FormalParameter",
        // The parameter of a `catch`.
        (name, Node::VarDecl(_)) if name != "VariableDeclarator" => "CatchParameter",
        ("Identifier", Node::Expr(_)) => "IdentifierReference",
        ("Identifier", _) => "BindingIdentifier",
        ("Literal", _) => literal(node.file().slice(node.span())),
        ("MemberExpression", Node::Expr(e)) => match e.member_name_start() {
            None => "ComputedMemberExpression",
            Some(name) if text.get(name as usize) == Some(&b'#') => "PrivateFieldExpression",
            Some(_) => "StaticMemberExpression",
        },
        (
            "FunctionDeclaration"
            | "FunctionExpression"
            | "TSDeclareFunction"
            | "TSEmptyBodyFunctionExpression",
            _,
        ) => "Function",
        ("ClassDeclaration" | "ClassExpression", _) => "Class",
        ("Property", Node::PatProp(_)) => "BindingProperty",
        ("Property", Node::Prop(prop)) => match prop.parent() {
            Node::Expr(owner) if is_assignment_target(owner) => match prop.kind() {
                PropKind::Shorthand => "AssignmentTargetPropertyIdentifier",
                _ => "AssignmentTargetPropertyProperty",
            },
            _ => "ObjectProperty",
        },
        ("ObjectPattern", Node::Expr(_)) => "ObjectAssignmentTarget",
        ("ArrayPattern", Node::Expr(_)) => "ArrayAssignmentTarget",
        ("RestElement" | "AssignmentPattern", Node::Expr(_) | Node::Prop(_)) => "",
        ("RestElement", _) => "BindingRestElement",
        ("ExportNamedDeclaration", Node::Stmt(it)) => match it.kind() {
            StmtKind::ExportNamed(export) if export.has_from() => "ExportFromDeclaration",
            _ => "ExportNamedDeclaration",
        },
        ("TSModuleDeclaration", _) => "TSNamespaceDeclaration",
        ("MetaProperty", Node::Expr(e)) if e.tag() == ExprTag::ImportMeta => "ImportMeta",
        ("TSAbstractMethodDefinition", _) => "MethodDefinition",
        ("TSAbstractPropertyDefinition", _) => "PropertyDefinition",
        ("TSAbstractAccessorProperty", _) => "AccessorProperty",
        ("ExpressionStatement", Node::Stmt(it)) if it.directive().is_some() => "Directive",
        (name, _) => name,
    }
}

/// Calls `found` with the nodes of oxc that `node` stands for, from the outside in: what oxc calls each, and from where to where it
/// is written.
fn each_in_oxc(node: Node, mut found: impl FnMut(&'static str, Span)) {
    let statement = match node {
        Node::Stmt(it) => Some(it),
        Node::Func(it) => it.owner().as_stmt(),
        Node::Class(it) => it.owner().as_stmt(),
        _ => None,
    };
    if let Some(statement) = statement
        && let Some(whole) = statement.export_span()
    {
        found(
            match statement.is_default_export() {
                true => "ExportDefaultDeclaration",
                false => "ExportDeclaration",
            },
            whole,
        );
    }
    let span = estree_span(node);
    if matches!(node, Node::Expr(e) if is_chain_root(e)) {
        found("ChainExpression", span);
    }
    found(name_in_oxc(node), span);
    match node {
        Node::Func(it) => {
            if let Some(body) = it.body_span() {
                found("FunctionBody", body);
            }
        }
        Node::Class(it) => found("ClassBody", it.body_span()),
        Node::Stmt(it) => match it.kind() {
            StmtKind::Interface(it) => found("TSInterfaceBody", it.body_span()),
            StmtKind::Enum(it) => found("TSEnumBody", it.body_span()),
            _ => {}
        },
        Node::Expr(e) => {
            if let ExprKind::Jsx(jsx) = e.kind()
                && !jsx.is_fragment()
            {
                found("JSXOpeningElement", jsx.opening_span());
            }
        }
        _ => {}
    }
}

/// The innermost of the nodes of oxc that `node` stands for that is of one of `kinds` and that `fits`.
fn one_of(node: Node, kinds: &[u8], depth: u32, fits: impl Fn(Span) -> bool) -> Option<Place> {
    let (mut best, mut level) = (None, 0);
    each_in_oxc(node, |name, span| {
        if fits(span) && kind_named(name).is_some_and(|it| kinds.contains(&it)) {
            best = Some((span.start, Reverse(span.end), depth * LEVELS + level));
        }
        level += 1;
    });
    best
}

/// Where the variable is declared that the name at `label` refers to, if it is a variable or a parameter.
fn declared_at<'a>(file: &'a File<'a>, label: Span) -> Option<Span> {
    let reference = file
        .reference_at(label.start)
        .filter(|it| it.span() == label)?;
    match reference.symbol()?.declarations().next()? {
        Declaration::Var(pat) | Declaration::Param(pat) => {
            Some(pat.span()).filter(|it| *it != label)
        }
        _ => None,
    }
}

/// The value of what has a name or a key beside it.
fn value_of(node: Node) -> Option<Node> {
    let value = match node {
        Node::Member(it) => match it.func() {
            Some(func) => return Some(Node::Func(func)),
            None => it.init(),
        },
        Node::Prop(it) => it.value(),
        Node::VarDecl(it) => it.init(),
        _ => None,
    };
    Some(normalize(Node::Expr(value?)))
}

/// The nodes around `label`, from the innermost to the file.
fn around<'a>(file: &'a File<'a>, label: Span) -> SmallVec<[Node<'a>; 24]> {
    let mut all = SmallVec::new();
    let mut node = get_node_by_range_index(file, label.start);
    while !matches!(node, Node::File(_)) {
        if !all.is_empty() || estree_span(node).contains(label) || node.span().contains(label) {
            all.push(node);
        }
        node = estree_parent(node);
    }
    all.push(node);
    all
}

fn find<'a>(file: &'a File<'a>, kinds: &[u8], label: Span, follows_names: bool) -> Option<Place> {
    let of_declaration = || {
        let declared = declared_at(file, label).filter(|_| follows_names)?;
        find(file, kinds, declared, false)
    };
    // A rule that is called with declarations alone and reports a name elsewhere reports how the variable is used.
    let declares = |kind: &u8| {
        matches!(
            name_of_kind(*kind),
            b"VariableDeclaration" | b"VariableDeclarator" | b"FormalParameter" | b"CatchParameter"
        )
    };
    if kinds.iter().all(declares)
        && let Some(found) = of_declaration()
    {
        return Some(found);
    }
    let chain = around(file, label);
    let depth_of = |at: usize| (chain.len() - at) as u32;
    for (at, node) in chain.iter().enumerate() {
        if let Some(found) = one_of(*node, kinds, depth_of(at), |it| it.contains(label)) {
            return Some(found);
        }
        // What is reported is a name or a key, and the rule is called with the value: the function of a method.
        if at < 2
            && let Some(value) = value_of(*node)
            && let Some(found) = one_of(value, kinds, depth_of(at) + 1, |it| it.start >= label.end)
        {
            return Some(found);
        }
    }
    if let Some(found) = of_declaration() {
        return Some(found);
    }
    // What is reported is around the node: the `-1` around the `1`.
    let innermost = chain.first().filter(|it| !matches!(it, Node::File(_)))?;
    let mut rest = vec![(*innermost, depth_of(0))];
    while let Some((node, depth)) = rest.pop() {
        if let Some(found) = one_of(node, kinds, depth, |it| label.contains(it)) {
            return Some(found);
        }
        let first = rest.len();
        node.for_each_child(|child| rest.push((child, depth + 1)));
        rest.get_mut(first..)?.reverse();
    }
    None
}

/// The place of the node that oxlint calls a rule with when the rule reports `label`. `kinds`: [`Order::kinds`](super::Order::kinds)
/// of the rule. Where the node is not found, `label` stands in for it.
pub(crate) fn place<'a>(file: &'a File<'a>, kinds: &[u8], label: Span) -> Place {
    let found = (!kinds.is_empty()).then(|| find(file, kinds, label, true));
    (found.flatten()).unwrap_or((label.start, Reverse(label.end), u32::MAX))
}
