//! The syntax of a file as ESTree, the way typescript-estree produces it. Rules written in Rust
//! never use it. It is for what is defined in terms of ESTree: plugins written in JavaScript, and
//! the selectors of `no-restricted-syntax`.
//!
//! [`convert`] goes through a [`File`] once, by the public API of [`crate::ast`] only, and tells a
//! [`Sink`] what the tree looks like: no tree is built here. [`write_json`] is the sink that
//! writes JSON.
//!
//! What differs from `parse(code, { range: true })` of typescript-estree:
//! - A field whose value is `undefined` there is left out.
//! - The `value` of a regular expression or a `bigint` literal is `null`. `regex` and `bigint`
//!   say what it is.
//! - There are no `loc`, `tokens` and `comments`. A sink can compute `loc` from the span.

mod convert;
mod entities;
mod json;
mod node_type;

pub use convert::convert;
pub use json::{JsonSink, write_json};
pub use node_type::NodeType;

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
