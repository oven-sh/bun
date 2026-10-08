//! The scopes, variables and references of a file as arrays of numbers: what [`crate::semantic`]
//! knows, with the nodes of the ESTree by their numbers. `worker/scope.js` makes the objects of
//! `eslint-scope` and `@typescript-eslint/scope-manager` of it.
//!
//! The message: [`HEADER`] words with how many there are of each, then
//! - for each scope 5 words: its [`ScopeKind`] and in bit 8 whether it is strict, its block,
//!   the scope around it, its variable scope, the index of its first variable
//! - for each variable, scope by scope, 2 words: the index of its first definition, flags
//! - for each definition 2 words: the node that is the name, its [`DeclarationKind`]
//! - for each reference, in the order of [`File::references_as_visited`], 5 words: the identifier,
//!   flags, what is written, the variable, the scope that it is in
//! - for each global variable that something refers to and the file does not declare, 2
//!   words: the index of a reference to it, flags
//! - for each variable that a `/* global */` comment names: where the name is in the text, from and
//!   to, its setting, how many comments name it, and where each of these starts
//!
//! After the last scope and the last variable there is one more, for where the lists of the last end.

use super::ast::NodeIds;
use super::offsets::Offsets;
use super::wire;
use crate::ast::{ExprKind, File, Node};
use crate::estree::{Field, NodeType, VNode, Value};
use crate::language::Global;
use crate::semantic::{Declaration, Reference, Scope, ScopeKind};
use crate::span::Span;
use rustc_hash::FxHashSet;

const HEADER: usize = 6;
const NONE: u32 = u32::MAX;

/// In the flags of a variable.
const IS_TYPE: u32 = 1 << 0;
const IS_VALUE: u32 = 1 << 1;
const IS_USED: u32 = 1 << 2;
const IS_EXPORTED: u32 = 1 << 3;
const IS_ARGUMENTS: u32 = 1 << 4;
/// In those of a global variable.
const IS_WRITABLE: u32 = 1 << 5;
const IS_IN_LIB: u32 = 1 << 6;
/// Something other than a library of TypeScript defines it.
const IS_CONFIGURED: u32 = 1 << 7;

/// In the flags of a reference, above its [`ReferenceFlags`](crate::semantic::ReferenceFlags): it
/// resolves to a global variable.
const TO_GLOBAL: u32 = 1 << 8;

/// The first of the ESTree nodes made of `base` that `is_it` accepts.
fn find<'a>(base: Node<'a>, mut is_it: impl FnMut(VNode<'a>, NodeType) -> bool) -> Option<VNode<'a>> {
    let mut found = None;
    VNode::for_each_with_type_at(base, &mut |node, node_type| {
        if found.is_none() && is_it(node, node_type) {
            found = Some(node);
        }
    });
    found
}

/// The name that starts at `start` among the ESTree nodes made of `base`.
fn name_at(base: Node<'_>, start: u32) -> Option<VNode<'_>> {
    find(base, |node, node_type| {
        matches!(node_type, NodeType::Identifier | NodeType::JSXIdentifier | NodeType::Literal | NodeType::ThisExpression)
            && node.span().start == start
    })
}

/// What the ESTree has where the expression `e` is.
fn expression<'a>(e: crate::ast::Expr<'a>) -> Option<VNode<'a>> {
    let base = match e.kind() {
        ExprKind::Fn(func) => Node::Func(func),
        ExprKind::Class(class) => Node::Class(class),
        _ => Node::Expr(e),
    };
    find(base, |_, _| true)
}

/// ESLint's `scope.block`.
fn block<'a>(scope: Scope<'a>) -> Option<VNode<'a>> {
    let span = scope.span();
    let with_span = |base: Node<'a>| find(base, |node, _| node.span() == span);
    match scope.node() {
        Node::File(file) => Some(VNode::program(file)),
        Node::Expr(e) => expression(e),
        Node::Func(func) => with_span(Node::Func(func)).or_else(|| with_span(func.owner())),
        Node::Stmt(_) if scope.kind() == ScopeKind::Catch => find(scope.node(), |_, it| it == NodeType::CatchClause),
        node => with_span(node).or_else(|| find(node, |_, _| true)),
    }
}

/// ESLint's `def.name`.
fn name_of<'a>(declaration: Declaration<'a>) -> Option<VNode<'a>> {
    let start = declaration.name_span()?.start;
    match declaration {
        Declaration::Var(pat) | Declaration::Param(pat) => name_at(Node::Pat(pat), start),
        Declaration::ImportSpec(it) => match find(Node::ImportSpec(it), |_, _| true)?.field(Field::Local) {
            Value::Node(local) => Some(local),
            _ => None,
        },
        _ => name_at(declaration.node()?, start),
    }
}

/// ESLint's `reference.identifier`.
fn identifier<'a>(reference: Reference<'a>) -> Option<VNode<'a>> {
    match reference.is_jsx_pragma() {
        true => name_of(reference.symbol()?.declarations().next()?),
        false => name_at(reference.node(), reference.span().start),
    }
}

pub(super) fn write<'a>(file: &'a File<'a>, offsets: &Offsets, ids: &NodeIds<'a>, out: &mut Vec<u8>) {
    let id = |node: Option<VNode<'a>>| node.and_then(|it| ids.get(&it)).copied().unwrap_or(NONE);
    let header = out.len();
    out.resize(header + HEADER * 4, 0);

    // By `Symbol::key`: the index of the variable.
    let mut index_of = vec![NONE; file.symbol_key_limit()];
    let (mut variables, mut definitions) = (Vec::new(), Vec::new());
    let scopes = file.scopes();
    let scope_count = scopes.len();
    for scope in scopes {
        wire::words(
            out,
            &[
                scope.kind() as u32 | u32::from(scope.is_strict()) << 8,
                id(block(scope)),
                scope.parent().map_or(NONE, |it| it.id().0),
                scope.variable_scope().id().0,
                (variables.len() / 2) as u32,
            ],
        );
        for symbol in scope.symbols() {
            if let Some(index) = index_of.get_mut(symbol.key()) {
                *index = (variables.len() / 2) as u32;
            }
            let flags = (u32::from(symbol.is_type_variable()) * IS_TYPE)
                | (u32::from(symbol.is_value_variable()) * IS_VALUE)
                | (u32::from(symbol.is_marked_used()) * IS_USED)
                | (u32::from(symbol.is_marked_exported()) * IS_EXPORTED)
                | (u32::from(symbol.is_implicit_arguments()) * IS_ARGUMENTS);
            variables.extend_from_slice(&[(definitions.len() / 2) as u32, flags]);
            for declaration in symbol.declarations() {
                if let Some(kind) = declaration.kind() {
                    definitions.extend_from_slice(&[id(name_of(declaration)), kind as u32]);
                }
            }
        }
    }
    wire::words(out, &[0, NONE, NONE, NONE, (variables.len() / 2) as u32]);
    variables.extend_from_slice(&[(definitions.len() / 2) as u32, 0]);
    wire::words(out, &variables);
    wire::words(out, &definitions);

    let mut globals = Vec::new();
    let mut seen = FxHashSet::default();
    let mut reference_count = 0;
    for reference in file.references_as_visited() {
        // What is not in the tree is not there for a rule either.
        let identifier = id(identifier(reference));
        if identifier == NONE {
            continue;
        }
        let index = reference_count;
        reference_count += 1;
        let symbol = reference.symbol();
        let global = reference.global();
        if let Some(global) = global
            && seen.insert(reference.name().atom())
        {
            let flags = (u32::from(global.is_type) * IS_TYPE)
                | (u32::from(global.is_value) * IS_VALUE)
                | (u32::from(global.is_exported) * (IS_USED | IS_EXPORTED))
                | (u32::from(global.is_writable) * IS_WRITABLE)
                | (u32::from(global.is_in_lib) * IS_IN_LIB)
                | (u32::from(!global.is_only_in_lib) * IS_CONFIGURED);
            globals.extend_from_slice(&[index, flags]);
        }
        wire::words(
            out,
            &[
                identifier,
                u32::from(reference.flags().bits()) | (u32::from(global.is_some()) * TO_GLOBAL),
                id(reference.write_expr().and_then(expression)),
                symbol.and_then(|it| index_of.get(it.key())).copied().unwrap_or(NONE),
                reference.scope().id().0,
            ],
        );
    }
    wire::words(out, &globals);

    let in_comments = file.globals_in_comments();
    for global in in_comments {
        let name = global.comments.first().map_or(Span::new(0, 0), |it| file.name_in_global_comment(*it, &global.name));
        let setting = match global.setting {
            Global::Readonly => 0,
            Global::Writable => 1,
            Global::Off => 2,
        };
        wire::words(
            out,
            &[offsets.to_utf16(name.start), offsets.to_utf16(name.end), setting, global.comments.len() as u32],
        );
        for comment in &global.comments {
            wire::words(out, &[offsets.to_utf16(comment.start)]);
        }
    }

    let counts: [u32; HEADER] = [
        scope_count as u32,
        (variables.len() / 2 - 1) as u32,
        (definitions.len() / 2) as u32,
        reference_count,
        (globals.len() / 2) as u32,
        in_comments.len() as u32,
    ];
    for (i, count) in counts.iter().enumerate() {
        out[header + i * 4..header + i * 4 + 4].copy_from_slice(&count.to_le_bytes());
    }
}

/// Sets ESLint's `variable.eslintUsed` for the variables at `indices`, which are sorted.
pub(super) fn mark_used<'a>(file: &'a File<'a>, indices: impl Iterator<Item = u32>) {
    let mut indices = indices.peekable();
    if indices.peek().is_none() {
        return;
    }
    for (index, symbol) in file.scopes().flat_map(Scope::symbols).enumerate() {
        if indices.next_if_eq(&(index as u32)).is_some() {
            symbol.mark_used();
        }
    }
}
