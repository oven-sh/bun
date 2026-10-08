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

mod convert;
mod field;
mod json;
mod parent;
mod schema;
mod value;
mod views;
mod vnode;

pub use convert::convert;
pub use field::Field;
pub use json::{JsonSink, write_json};
pub use schema::{FieldEntry, NodeType};
pub use value::{Nodes, Object, Value};
pub use vnode::VNode;

use crate::ast::File;
use crate::span::Span;

/// Receives a tree of ESTree nodes, in the order of a depth-first walk.
///
/// A value is a node, a list, a plain object or a primitive. After [`Sink::start_node`] and
/// [`Sink::start_object`] come pairs of a [`Sink::field`] and a value, after [`Sink::start_list`]
/// come values.
pub trait Sink {
    /// `span` is in bytes.
    fn start_node(&mut self, node_type: NodeType, span: Span);
    fn end_node(&mut self);
    /// An object that is not a node: the `value` of a `TemplateElement`, the `regex` of a
    /// `Literal`.
    fn start_object(&mut self);
    fn end_object(&mut self);
    fn start_list(&mut self);
    fn end_list(&mut self);
    /// The name of the field that the next value is for.
    fn field(&mut self, name: &'static str);
    fn null(&mut self);
    fn boolean(&mut self, value: bool);
    fn number(&mut self, value: f64);
    /// `value` is WTF-8: UTF-8 in which a lone surrogate is encoded like any other code point.
    fn string(&mut self, value: &[u8]);
}

/// Which parser's ESTree.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Dialect {
    /// `@typescript-eslint/parser`
    TypeScript,
    /// ESLint's own. Its nodes lack the fields that only TypeScript has a use for, and its `Program`
    /// ends with the last token.
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
            Some(entry) if !entry.is_typescript_only || self.dialect() == Dialect::TypeScript => (entry.get)(self),
            _ => Value::Undefined,
        }
    }

    /// Its fields that are not `undefined`, except `type`, `range`, `loc` and `parent`.
    pub fn fields(self) -> impl Iterator<Item = (Field, Value<'a>)> {
        let is_typescript = self.dialect() == Dialect::TypeScript;
        let entries = self.node_type().fields().iter().filter(move |it| is_typescript || !it.is_typescript_only);
        entries.map(move |it| (it.field, (it.get)(self))).filter(|it| !matches!(it.1, Value::Undefined))
    }
}
