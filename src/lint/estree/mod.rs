//! ESTree, for what is defined in terms of it: the selectors of `no-restricted-syntax`. Rules
//! written in Rust never use it.
//!
//! No tree is ever built. A [`VNode`] is a node of [`crate::ast`] and which part of it is meant. It
//! is `Copy`, and its type, its range, its parent and its fields are computed from the syntax when
//! they are asked for, without allocating. What each type of node consists of is written down once,
//! in the table of `schema.rs`, from which come [`NodeType`], the [`FieldEntry`]s of each type with
//! the function that computes the field, the visitor keys, and the kinds of nodes of [`crate::ast`]
//! that a type is made of.
//!
//! The nodes are those that the parser which ESLint would use for the file makes: see [`Dialect`].
//!
//! `bun-lint ast estree` writes a file as JSON by going through the table, and
//! test/cli/lint/oracle/ast compares that with what typescript-estree and espree make of the same
//! code.

mod field;
mod parent;
mod schema;
mod value;
mod views;
mod vnode;

pub use field::Field;
pub use schema::{FieldEntry, NodeType};
pub use value::{Nodes, Object, Value};
pub use vnode::VNode;

use crate::ast::File;

/// Which parser's ESTree.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Dialect {
    /// `@typescript-eslint/parser`
    TypeScript,
    /// ESLint's own. Its nodes lack the fields that only TypeScript has a use for.
    Espree,
}

impl Dialect {
    /// That of the parser that `languageOptions.parser` says.
    #[inline]
    pub fn of(file: &File) -> Dialect {
        match file.language().parser {
            crate::language::Parser::Espree => Dialect::Espree,
            _ => Dialect::TypeScript,
        }
    }
}

impl FieldEntry {
    /// Whether the nodes of `dialect` have the field.
    #[inline]
    pub fn is_in(&self, dialect: Dialect) -> bool {
        match dialect {
            Dialect::TypeScript => !self.is_espree_only,
            Dialect::Espree => !self.is_typescript_only,
        }
    }
}

impl NodeType {
    /// The type that is called `name`.
    pub fn from_name(name: &[u8]) -> Option<NodeType> {
        NodeType::ALL.iter().copied().find(|it| it.name().as_bytes() == name)
    }

    /// The entry of `field`, if a node of this type has such a field.
    pub fn field(self, field: Field) -> Option<&'static FieldEntry> {
        self.fields().iter().find(|it| it.field == field)
    }

    /// The fields that a traversal goes into, in that order.
    pub fn visitor_keys(self) -> impl Iterator<Item = Field> {
        self.fields().iter().take_while(|it| it.is_child).map(|it| it.field)
    }
}

impl<'a> VNode<'a> {
    /// The value of `field`. [`Value::Undefined`] if it has no such field.
    pub fn field(self, field: Field) -> Value<'a> {
        match self.node_type().field(field) {
            Some(entry) if entry.is_in(self.dialect()) => (entry.get)(self),
            _ => Value::Undefined,
        }
    }

    /// Its enumerable fields that are not `undefined`, except `type`, `range`, `loc` and `parent`.
    pub fn fields(self) -> impl Iterator<Item = (Field, Value<'a>)> {
        let dialect = self.dialect();
        let entries = self.node_type().fields().iter().filter(move |it| it.is_in(dialect) && !it.is_hidden);
        entries.map(move |it| (it.field, (it.get)(self))).filter(|it| !matches!(it.1, Value::Undefined))
    }
}
