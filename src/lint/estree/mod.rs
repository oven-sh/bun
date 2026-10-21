//! An ESTree view of the AST, for features that are defined in terms of ESTree, such as the selectors of
//! `no-restricted-syntax`. Rules written in Rust never use it.
//!
//! No tree is ever built. A [`VNode`] is a [`crate::ast`] node plus a tag that selects a part of it. It's `Copy`, and
//! its type, range, parent and fields are computed from the syntax on demand, without allocating. The layout of each
//! node type is defined once, in the table in `schema.rs`. That table generates [`NodeType`], each type's
//! [`FieldEntry`]s with the function that computes the field, the visitor keys, and the kinds of [`crate::ast`] nodes
//! that a type is made from.
//!
//! The nodes match the output of the parser that ESLint would use for the file. See [`Dialect`].

mod field;
mod parent;
mod schema;
mod value;
mod views;
mod vnode;

pub(crate) use field::Field;
pub(crate) use schema::{FieldEntry, NodeType};
pub(crate) use value::Sink;
pub(crate) use value::{Nodes, Object, Value};
pub(crate) use vnode::VNode;

use crate::ast::File;

/// Selects the parser whose ESTree is produced.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Dialect {
    /// `@typescript-eslint/parser`
    TypeScript,
    /// ESLint's own parser. Its nodes lack the TypeScript-only fields.
    Espree,
}

impl Dialect {
    /// Returns the dialect of the parser that ESLint would use for the file: espree's for JavaScript, if
    /// `languageOptions.parser` is espree. espree can't parse anything else. oxlint's nodes have the TypeScript fields
    /// in every file.
    #[inline]
    pub(crate) fn of(file: &File) -> Dialect {
        let language = file.language();
        match language.parser {
            crate::language::Parser::Espree if file.is_javascript() && !language.is_oxlint => {
                Dialect::Espree
            }
            _ => Dialect::TypeScript,
        }
    }
}

impl FieldEntry {
    /// True if `dialect`'s nodes have the field.
    #[inline]
    pub(crate) fn is_in(&self, dialect: Dialect) -> bool {
        match dialect {
            Dialect::TypeScript => !self.is_espree_only,
            Dialect::Espree => !self.is_typescript_only,
        }
    }
}

impl NodeType {
    /// Returns the entry for `field`, if nodes of this type have that field.
    pub(crate) fn field(self, field: Field) -> Option<&'static FieldEntry> {
        self.fields().iter().find(|it| it.field == field)
    }
}

impl<'a> VNode<'a> {
    /// Returns the value of `field`, or [`Value::Undefined`] if the node has no such field.
    pub(crate) fn field(self, field: Field) -> Value<'a> {
        match self.node_type().field(field) {
            Some(entry) if entry.is_in(self.dialect()) => (entry.get)(self),
            _ => Value::Undefined,
        }
    }
}
