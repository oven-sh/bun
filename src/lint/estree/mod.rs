//! ESTree, for what is defined in terms of it: the selectors of `no-restricted-syntax`, and which node Prettier attaches a
//! comment to, which is what `bun_format` has it for. Rules written in Rust never use it.
//!
//! No tree is ever built. A [`VNode`] is a node of [`crate::ast`] and which part of it is meant. It
//! is `Copy`, and its type, its range, its parent and its fields are computed from the syntax when
//! they are asked for, without allocating. What each type of node consists of is written down once,
//! in the table of `schema.rs`, from which come [`NodeType`], the [`FieldEntry`]s of each type with
//! the function that computes the field, the visitor keys, and the kinds of nodes of [`crate::ast`]
//! that a type is made of.
//!
//! The nodes are those that the parser which ESLint would use for the file makes: see [`Dialect`].

mod field;
mod parent;
mod schema;
mod value;
mod views;
mod vnode;

pub use field::Field;
pub(crate) use schema::FieldEntry;
pub use schema::NodeType;
pub use value::Nodes;
pub(crate) use value::Sink;
pub(crate) use value::{Object, Value};
pub use vnode::{PackedVNode, VNode};

use crate::ast::File;

/// Which parser's ESTree.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Dialect {
    /// `@typescript-eslint/parser`
    TypeScript,
    /// ESLint's own. Its nodes lack the fields that only TypeScript has a use for.
    Espree,
}

impl Dialect {
    /// That of the parser that ESLint would read the file with: espree's for JavaScript if that is what
    /// `languageOptions.parser` says. espree cannot read anything else. oxlint's nodes have the fields of TypeScript in every file.
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
    /// Whether the nodes of `dialect` have the field.
    #[inline]
    pub(crate) fn is_in(&self, dialect: Dialect) -> bool {
        match dialect {
            Dialect::TypeScript => !self.is_espree_only,
            Dialect::Espree => !self.is_typescript_only,
        }
    }
}

impl NodeType {
    /// The entry of `field`, if a node of this type has such a field.
    pub(crate) fn field(self, field: Field) -> Option<&'static FieldEntry> {
        self.fields().iter().find(|it| it.field == field)
    }
}

impl<'a> VNode<'a> {
    /// The value of `field`. [`Value::Undefined`] if it has no such field.
    pub(crate) fn field(self, field: Field) -> Value<'a> {
        match self.node_type().field(field) {
            Some(entry) if entry.is_in(self.dialect()) => (entry.get)(self),
            _ => Value::Undefined,
        }
    }
}

/// For the formatter. Prettier's trees have the nodes of TypeScript, of Flow and decorators in a file of JavaScript too, so these
/// see every field that typescript-estree has, whatever [`Dialect`] the file is of. `ty` is [`VNode::node_type`], which the
/// caller has.
impl<'a> VNode<'a> {
    #[inline]
    fn value_of(self, ty: NodeType, field: Field) -> Value<'a> {
        match ty.field(field) {
            Some(entry) if !entry.is_espree_only => (entry.get)(self),
            _ => Value::Undefined,
        }
    }

    /// The node in `field`.
    pub fn child(self, ty: NodeType, field: Field) -> Option<VNode<'a>> {
        match self.value_of(ty, field) {
            Value::Node(node) => Some(node),
            _ => None,
        }
    }

    /// The nodes in `field`, which is a list.
    pub fn children(self, ty: NodeType, field: Field) -> Nodes<'a> {
        match self.value_of(ty, field) {
            Value::Nodes(nodes) => nodes,
            _ => Nodes::EMPTY,
        }
    }

    /// Whether `field` is `true`.
    pub fn is_true(self, ty: NodeType, field: Field) -> bool {
        matches!(self.value_of(ty, field), Value::Bool(true))
    }

    /// The string in `field`.
    pub fn string(self, ty: NodeType, field: Field) -> Option<&'a [u8]> {
        match self.value_of(ty, field) {
            Value::Str(value) => Some(value),
            _ => None,
        }
    }

    /// Calls `one` with each child that is in a field of its own and `list` with each list of children, in the order of the
    /// visitor keys.
    pub fn for_each_field_of_children(
        self,
        ty: NodeType,
        mut visit: impl FnMut(Result<VNode<'a>, Nodes<'a>>),
    ) {
        for entry in ty.fields() {
            if !entry.is_child {
                break;
            }
            if entry.is_espree_only {
                continue;
            }
            match (entry.get)(self) {
                Value::Node(child) => visit(Ok(child)),
                Value::Nodes(children) => visit(Err(children)),
                _ => {}
            }
        }
    }

    /// A node below this one that `span` is in, as far down as the nodes of [`crate::ast`] alone can tell. For whoever looks
    /// for the innermost node around `span`, it saves the levels in between.
    pub fn descendant_around(self, span: crate::span::Span) -> Option<VNode<'a>> {
        use crate::ast::{ExprKind, FnBody, Node, StmtKind};
        use vnode::Part;
        let (mut node, mut found) = (self.base, None);
        loop {
            let mut inner = None;
            node.for_each_child_near(span.start, |child| {
                if inner.is_none() && child.span().contains(span) {
                    inner = Some(child);
                }
            });
            let Some(child) = inner else {
                break;
            };
            node = child;
            // Only where there is no doubt about which node is the outermost that is made of `child`.
            let is_simple = match child {
                Node::Stmt(_)
                | Node::Class(_)
                | Node::Member(_)
                | Node::Prop(_)
                | Node::Case(_) => true,
                Node::Func(func) => matches!(func.body(), FnBody::Block(_)),
                Node::Expr(e) => matches!(
                    e.kind(),
                    ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Call(_)
                ),
                _ => false,
            };
            if is_simple {
                found = Some(child);
            }
        }
        let is_in = |body: Option<crate::span::Span>| body.is_some_and(|it| it.contains(span));
        let part = |is_in_body: bool| if is_in_body { Part::Body } else { Part::Main };
        Some(match found? {
            Node::Func(func) => VNode::new(func, part(is_in(func.body_span()))),
            Node::Class(class) => VNode::new(class, part(is_in(Some(class.body_span())))),
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Interface(it) if is_in(Some(it.body_span())) => {
                    VNode::new(statement, Part::Body)
                }
                StmtKind::Enum(it) if is_in(Some(it.body_span())) => {
                    VNode::new(statement, Part::Body)
                }
                _ => VNode::of_stmt(statement),
            },
            Node::Expr(e) => VNode::of_expr(e)?,
            other => VNode::new(other, Part::Main),
        })
    }
}
