//! What a field of a node holds.

use super::vnode::{Part, VNode};
use crate::ast::{
    Case, EnumMember, ExportSpec, Expr, ExprKind, ImportSpec, JsxChild, JsxChildren, List,
    ListIter, Member, Modifier, Node, Param, PatElem, PatProp, Prop, Stmt, StmtKind, TupleElem,
    TypeNode, TypeParam, VarDecl,
};

/// The value of a field.
#[derive(Copy, Clone)]
pub enum Value<'a> {
    /// The node has no such field, or it is `undefined`.
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    /// WTF-8: UTF-8 in which a lone surrogate is encoded like any other code point.
    Str(&'a [u8]),
    /// The `value` of a regular expression literal: a `RegExp`.
    Regex {
        pattern: &'a [u8],
        flags: &'a [u8],
    },
    /// The `value` of a `bigint` literal, in decimal.
    BigInt(&'a [u8]),
    /// An object that is not a node.
    Object(Object<'a>),
    Node(VNode<'a>),
    Nodes(Nodes<'a>),
}

/// Takes the fields of a node, one call for each: [`NodeType::emit_fields`](super::NodeType::emit_fields).
pub(crate) trait Sink<'a> {
    fn undefined(&mut self);
    fn null(&mut self);
    fn bool(&mut self, value: bool);
    fn number(&mut self, value: f64);
    fn str(&mut self, value: &'a [u8]);
    fn node(&mut self, node: VNode<'a>);
    fn nodes(&mut self, nodes: Nodes<'a>);
    /// A `RegExp`, a `bigint`, an [`Object`].
    fn other(&mut self, value: Value<'a>);
}

/// What converts to a [`Value`] goes to a [`Sink`] without one being made: which call it is, is known where the field is written
/// down.
pub(crate) trait Emit<'a> {
    fn emit(self, sink: &mut impl Sink<'a>);
}

impl<'a> Emit<'a> for bool {
    #[inline]
    fn emit(self, sink: &mut impl Sink<'a>) {
        sink.bool(self);
    }
}
impl<'a> Emit<'a> for f64 {
    #[inline]
    fn emit(self, sink: &mut impl Sink<'a>) {
        sink.number(self);
    }
}
impl<'a> Emit<'a> for &'a [u8] {
    #[inline]
    fn emit(self, sink: &mut impl Sink<'a>) {
        sink.str(self);
    }
}
impl<'a> Emit<'a> for &'a str {
    #[inline]
    fn emit(self, sink: &mut impl Sink<'a>) {
        sink.str(self.as_bytes());
    }
}
impl<'a> Emit<'a> for VNode<'a> {
    #[inline]
    fn emit(self, sink: &mut impl Sink<'a>) {
        sink.node(self);
    }
}
impl<'a> Emit<'a> for Nodes<'a> {
    #[inline]
    fn emit(self, sink: &mut impl Sink<'a>) {
        sink.nodes(self);
    }
}
/// `None` is `null`.
impl<'a, T: Emit<'a>> Emit<'a> for Option<T> {
    #[inline]
    fn emit(self, sink: &mut impl Sink<'a>) {
        match self {
            Some(value) => value.emit(sink),
            None => sink.null(),
        }
    }
}
impl<'a> Emit<'a> for Value<'a> {
    fn emit(self, sink: &mut impl Sink<'a>) {
        match self {
            Value::Undefined => sink.undefined(),
            Value::Null => sink.null(),
            Value::Bool(value) => sink.bool(value),
            Value::Number(value) => sink.number(value),
            Value::Str(value) => sink.str(value),
            Value::Node(node) => sink.node(node),
            Value::Nodes(nodes) => sink.nodes(nodes),
            Value::Regex { .. } | Value::BigInt(_) | Value::Object(_) => sink.other(self),
        }
    }
}

/// The objects in an ESTree that are not nodes.
#[derive(Copy, Clone)]
pub enum Object<'a> {
    /// The `value` of a `TemplateElement`
    Template {
        cooked: Option<&'a [u8]>,
        raw: &'a [u8],
    },
    /// The `regex` of a `Literal`
    Regex { pattern: &'a [u8], flags: &'a [u8] },
}

impl<'a> Object<'a> {
    /// Its properties.
    pub fn entries(self) -> [(&'static str, Value<'a>); 2] {
        match self {
            Object::Template { cooked, raw } => [
                ("cooked", cooked.map_or(Value::Null, Value::Str)),
                ("raw", Value::Str(raw)),
            ],
            Object::Regex { pattern, flags } => [
                ("flags", Value::Str(flags)),
                ("pattern", Value::Str(pattern)),
            ],
        }
    }
}

impl From<bool> for Value<'_> {
    #[inline]
    fn from(value: bool) -> Self {
        Value::Bool(value)
    }
}
impl From<f64> for Value<'_> {
    #[inline]
    fn from(value: f64) -> Self {
        Value::Number(value)
    }
}
impl<'a> From<&'a [u8]> for Value<'a> {
    #[inline]
    fn from(value: &'a [u8]) -> Self {
        Value::Str(value)
    }
}
impl<'a> From<&'a str> for Value<'a> {
    #[inline]
    fn from(value: &'a str) -> Self {
        Value::Str(value.as_bytes())
    }
}
impl<'a> From<VNode<'a>> for Value<'a> {
    #[inline]
    fn from(value: VNode<'a>) -> Self {
        Value::Node(value)
    }
}
impl<'a> From<Nodes<'a>> for Value<'a> {
    #[inline]
    fn from(value: Nodes<'a>) -> Self {
        Value::Nodes(value)
    }
}
/// `None` is `null`.
impl<'a, T: Into<Value<'a>>> From<Option<T>> for Value<'a> {
    #[inline]
    fn from(value: Option<T>) -> Self {
        value.map_or(Value::Null, T::into)
    }
}

/// A list of nodes, in which a hole is `None`. It is the iterator over itself, and starts over
/// from every copy.
#[derive(Copy, Clone)]
pub struct Nodes<'a>(Inner<'a>);

#[derive(Copy, Clone)]
enum Inner<'a> {
    Empty,
    One(VNode<'a>),
    Exprs(ListIter<'a, Expr<'a>>),
    Stmts(ListIter<'a, Stmt<'a>>),
    Types(ListIter<'a, TypeNode<'a>>),
    Heritage(ListIter<'a, TypeNode<'a>>),
    Props(ListIter<'a, Prop<'a>>),
    Members(ListIter<'a, Member<'a>>),
    Params(Option<Param<'a>>, ListIter<'a, Param<'a>>),
    TypeParams(ListIter<'a, TypeParam<'a>>),
    VarDecls(ListIter<'a, VarDecl<'a>>),
    Cases(ListIter<'a, Case<'a>>),
    EnumMembers(ListIter<'a, EnumMember<'a>>),
    ExportSpecs(ListIter<'a, ExportSpec<'a>>),
    TupleElems(ListIter<'a, TupleElem<'a>>),
    PatProps(ListIter<'a, PatProp<'a>>),
    PatElems(ListIter<'a, PatElem<'a>>),
    /// The default import, the namespace import, the named imports. The number says what is next.
    ImportSpecifiers(Stmt<'a>, u8, ListIter<'a, ImportSpec<'a>>),
    Decorators(Node<'a>, ListIter<'a, Modifier<'a>>),
    /// The entries of `with { .. }` in a statement or a type.
    Attributes(Node<'a>, ListIter<'a, Prop<'a>>),
    /// The `TemplateElement`s of a node from an index up to another.
    Quasis(Node<'a>, u32, u32),
    /// The operands of comma operators. First the left operand of the innermost, then the right
    /// operand of each from there up to the outermost.
    Sequence {
        innermost_left: Option<Expr<'a>>,
        at: Option<Expr<'a>>,
        outermost: Expr<'a>,
    },
    JsxChildren(Expr<'a>, JsxChildren<'a>),
}

macro_rules! lists {
    ($($name:ident $variant:ident $handle:ident,)*) => {$(
        #[inline]
        pub(super) fn $name(list: List<'a, $handle<'a>>) -> Nodes<'a> {
            Nodes(Inner::$variant(list.iter()))
        }
    )*};
}

impl<'a> Nodes<'a> {
    pub(super) const EMPTY: Nodes<'a> = Nodes(Inner::Empty);

    lists! {
        exprs Exprs Expr,
        stmts Stmts Stmt,
        types Types TypeNode,
        heritage Heritage TypeNode,
        props Props Prop,
        members Members Member,
        type_params TypeParams TypeParam,
        var_decls VarDecls VarDecl,
        cases Cases Case,
        enum_members EnumMembers EnumMember,
        export_specs ExportSpecs ExportSpec,
        tuple_elems TupleElems TupleElem,
        pat_props PatProps PatProp,
        pat_elems PatElems PatElem,
    }

    #[inline]
    pub(super) fn one(node: VNode<'a>) -> Nodes<'a> {
        Nodes(Inner::One(node))
    }

    pub(super) fn params(this: Option<Param<'a>>, params: List<'a, Param<'a>>) -> Nodes<'a> {
        Nodes(Inner::Params(this, params.iter()))
    }

    pub(super) fn import_specifiers(
        statement: Stmt<'a>,
        named: List<'a, ImportSpec<'a>>,
    ) -> Nodes<'a> {
        Nodes(Inner::ImportSpecifiers(statement, 0, named.iter()))
    }

    /// The decorators among `modifiers`, which are those of `owner`.
    pub(super) fn decorators(
        owner: impl Into<Node<'a>>,
        modifiers: List<'a, Modifier<'a>>,
    ) -> Nodes<'a> {
        Nodes(Inner::Decorators(owner.into(), modifiers.iter()))
    }

    pub(super) fn attributes(owner: impl Into<Node<'a>>, entries: List<'a, Prop<'a>>) -> Nodes<'a> {
        Nodes(Inner::Attributes(owner.into(), entries.iter()))
    }

    pub(super) fn quasis(owner: impl Into<Node<'a>>, count: usize) -> Nodes<'a> {
        Nodes(Inner::Quasis(owner.into(), 0, count as u32))
    }

    /// The operands of the comma operators of which `outermost` is the last.
    pub(super) fn sequence(outermost: Expr<'a>) -> Nodes<'a> {
        let mut innermost = outermost;
        let left = loop {
            match innermost.kind() {
                ExprKind::Binary {
                    op: crate::ast::BinOp::Comma,
                    left,
                    ..
                } => match left.kind() {
                    ExprKind::Binary {
                        op: crate::ast::BinOp::Comma,
                        ..
                    } if !left.is_parenthesized() => innermost = left,
                    _ => break left,
                },
                _ => return Nodes::EMPTY,
            }
        };
        Nodes(Inner::Sequence {
            innermost_left: Some(left),
            at: Some(innermost),
            outermost,
        })
    }

    pub(super) fn jsx_children(element: Expr<'a>, children: JsxChildren<'a>) -> Nodes<'a> {
        Nodes(Inner::JsxChildren(element, children))
    }

    /// `length`
    #[inline]
    pub fn len(self) -> usize {
        self.count()
    }

    /// The element at `i`. The outer `None`: there is none.
    #[inline]
    pub fn get(mut self, i: usize) -> Option<Option<VNode<'a>>> {
        self.nth(i)
    }

    /// `indexOf(node)`
    pub fn index_of(mut self, node: VNode<'a>) -> Option<usize> {
        self.position(|it| it == Some(node))
    }
}

impl<'a> Iterator for Nodes<'a> {
    type Item = Option<VNode<'a>>;

    fn next(&mut self) -> Option<Option<VNode<'a>>> {
        let main = |node: Node<'a>| Some(VNode::new(node, Part::Main));
        Some(match &mut self.0 {
            Inner::Empty => return None,
            Inner::One(node) => {
                let node = *node;
                self.0 = Inner::Empty;
                Some(node)
            }
            Inner::Exprs(list) => VNode::of_expr(list.next()?),
            Inner::Stmts(list) => Some(VNode::of_stmt(list.next()?)),
            Inner::Types(list) => Some(VNode::of_type(list.next()?)),
            Inner::Heritage(list) => Some(VNode::new(list.next()?, Part::Heritage)),
            Inner::Props(list) => main(list.next()?.into()),
            Inner::Members(list) => main(list.next()?.into()),
            Inner::Params(this, list) => match this.take() {
                Some(this) => Some(VNode::of_param(this)),
                None => Some(VNode::of_param(list.next()?)),
            },
            Inner::TypeParams(list) => main(list.next()?.into()),
            Inner::VarDecls(list) => main(list.next()?.into()),
            Inner::Cases(list) => main(list.next()?.into()),
            Inner::EnumMembers(list) => main(list.next()?.into()),
            Inner::ExportSpecs(list) => main(list.next()?.into()),
            Inner::TupleElems(list) => Some(VNode::of_tuple_elem(list.next()?)),
            Inner::PatProps(list) => main(list.next()?.into()),
            Inner::PatElems(list) => VNode::of_pat_elem(list.next()?),
            Inner::ImportSpecifiers(statement, stage, named) => loop {
                let StmtKind::Import(import) = statement.kind() else {
                    return None;
                };
                *stage += 1;
                match *stage {
                    1 if import.default().is_some() => {
                        break Some(VNode::new(*statement, Part::DefaultSpecifier));
                    }
                    2 if import.namespace().is_some() => {
                        break Some(VNode::new(*statement, Part::NamespaceSpecifier));
                    }
                    1 | 2 => {}
                    _ => {
                        *stage = 2;
                        break main(named.next()?.into());
                    }
                }
            },
            Inner::Decorators(owner, modifiers) => {
                let decorator = modifiers.find(|it| it.decorator().is_some())?;
                Some(VNode::new(*owner, Part::Decorator(decorator.id().0)))
            }
            Inner::Attributes(owner, entries) => {
                Some(VNode::new(*owner, Part::Attribute(entries.next()?.id().0)))
            }
            Inner::Quasis(owner, next, count) => {
                if next >= count {
                    return None;
                }
                *next += 1;
                Some(VNode::new(*owner, Part::Quasi(*next - 1)))
            }
            Inner::Sequence {
                innermost_left,
                at,
                outermost,
            } => {
                if let Some(left) = innermost_left.take() {
                    return Some(VNode::of_expr(left));
                }
                let operator = (*at)?;
                *at = match operator == *outermost {
                    true => None,
                    false => operator.parent().as_expr(),
                };
                match operator.kind() {
                    ExprKind::Binary { right, .. } => VNode::of_expr(right),
                    _ => return None,
                }
            }
            Inner::JsxChildren(element, children) => match children.next()? {
                JsxChild::Expr(child) => VNode::of_expr(child),
                JsxChild::Whitespace(span) => {
                    Some(VNode::new(*element, Part::Whitespace(span.start)))
                }
            },
        })
    }
}
