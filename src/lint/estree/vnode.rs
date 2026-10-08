//! A node of the virtual ESTree: what it is, and where it is.

use super::{Dialect, NodeType};
use crate::ast::{
    EntityName, Expr, ExprKind, ExprTag, File, Flags, FnKind, Func, Ident, ImportEqualsTarget, Key,
    KeyKind, Keyword, Member, MemberKind, Modifier, Module, ModuleName, Node, Param, Pat, PatElem,
    PatKind, Prop, PropKind, Stmt, StmtKind, TupleElem, TypeKind, TypeNode, UnOp,
};
use crate::span::Span;
use crate::tokens::{skip_trivia, skip_trivia_back};
use bun_sema::hir::{ModifierId, PropId};

/// A node of the ESTree that ESLint's parser would make of the file.
///
/// There is no such tree. A `VNode` is a node of [`crate::ast`] and which [`Part`] of it is meant,
/// and everything about it is computed from that when it is asked for. Two are equal if they are
/// the same node of the ESTree.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct VNode<'a> {
    pub(super) base: Node<'a>,
    pub(super) part: Part,
}

/// Which of the ESTree nodes that are made of one node of [`crate::ast`].
///
/// Each ESTree node has exactly one `(Node, Part)`. The functions of [`VNode`] that make one from a
/// handle see to that: a function expression is `(Func, Main)`, never `(Expr, Main)`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum Part {
    /// The node that is the closest to what the handle stands for.
    Main,
    /// `Stmt`: the `ExportNamedDeclaration` or `ExportDefaultDeclaration` around a declaration.
    Export,
    /// `Expr`: the `ChainExpression` around it.
    Chain,
    /// `Expr`: the `JSXExpressionContainer` or `JSXSpreadChild` around it.
    Container,
    /// `TypeNode`: the `TSTypeAnnotation` around it.
    Annotation,
    /// `TypeNode`: a `TSClassImplements` or a `TSInterfaceHeritage`.
    Heritage,
    /// The name of a declaration, a label, the parameter of a type predicate.
    Name,
    /// The name of a member or a property that is not an expression.
    Key,
    /// The `TemplateElement` of `` [`a`] ``.
    KeyQuasi,
    /// `Prop`: the `a` and the `b` of the attribute name `a:b`.
    KeyNamespace,
    KeyName,
    /// `Expr`: the `b` of `a.b`, of `import.meta`, of the tag name `a:b`.
    Property,
    /// `Expr`: the `import` of `import.meta`, the `a` of the tag name `a:b`.
    Meta,
    /// `Func`: the `BlockStatement`. `Class`: the `ClassBody`. `Stmt`: the `TSInterfaceBody`,
    /// `TSEnumBody` or `TSModuleBlock`.
    Body,
    /// `Stmt`: the `CatchClause`.
    Catch,
    TypeParams,
    TypeArgs,
    /// The module specifier.
    Source,
    /// `Stmt`: the `TSExternalModuleReference`.
    Reference,
    DefaultSpecifier,
    DefaultLocal,
    NamespaceSpecifier,
    NamespaceLocal,
    /// `ImportSpec`, `ExportSpec`
    Imported,
    Local,
    Exported,
    /// `Param`: the `RestElement` or the `AssignmentPattern`.
    Inner,
    /// `PatProp`: the `AssignmentPattern`.
    Value,
    /// `TupleElem`
    Rest,
    Named,
    Optional,
    /// `TypeNode`: what is in a `TSLiteralType`, and what is after its `-`.
    Literal,
    LiteralArgument,
    /// `TypeNode`: the `symbol` of `unique symbol`.
    Operand,
    /// `TypeNode`: the `TSImportType` in the `TSTypeQuery` of `typeof import("m")`.
    ImportType,
    /// `TypeNode`: the `{ with: { .. } }` of an import type, its one property, the `with` and the
    /// inner braces.
    Options,
    OptionsProperty,
    OptionsKey,
    OptionsValue,
    /// `Expr`: the `TSTypeReference` and the `Identifier` of `as const`.
    ConstType,
    ConstName,
    /// `Expr`: of a JSX element or fragment.
    Opening,
    Closing,
    /// `Expr`: the `JSXText` that starts here and has no expression of its own.
    Whitespace(u32),
    /// The `TemplateElement` at this index.
    Quasi(u32),
    /// The `Decorator` that is this modifier.
    Decorator(u32),
    /// `Stmt`: the `ImportAttribute` that is this `Prop`, and its key. `TypeNode`: the same as a
    /// `Property`.
    Attribute(u32),
    AttributeKey(u32),
    /// The `TSQualifiedName` from the first name to the one at this index.
    Qualified(u32),
    /// The same as a `MemberExpression`, in a heritage clause.
    MemberName(u32),
    /// The `Identifier` at this index of a qualified name.
    NamePart(u32),
}

/// A node without children that is made of a token.
#[derive(Copy, Clone)]
pub(super) enum Leaf<'a> {
    Identifier(&'a [u8]),
    /// With the `#`.
    Private(&'a [u8]),
    JsxIdentifier,
    String(&'a [u8]),
    Number(f64),
    /// In decimal.
    BigInt(&'a [u8]),
    Bool(bool),
    Null,
    Regex {
        pattern: &'a [u8],
        flags: &'a [u8],
    },
    /// A template without substitutions. It has one child.
    Template,
}

impl<'a> Leaf<'a> {
    fn ident(ident: Ident<'a>) -> (Leaf<'a>, Span) {
        let leaf = match ident.bytes() {
            value if ident.is_string() => Leaf::String(value),
            name if name.starts_with(b"#") => Leaf::Private(name),
            name => Leaf::Identifier(name),
        };
        (leaf, ident.span())
    }

    fn key(file: &'a File<'a>, key: Key<'a>) -> Option<(Leaf<'a>, Span)> {
        let span = key.inner_span(file);
        let leaf = match key.kind() {
            KeyKind::Ident(_) if key.is_jsx() => Leaf::JsxIdentifier,
            KeyKind::Ident(name) => Leaf::Identifier(name.bytes()),
            KeyKind::Private(name) => Leaf::Private(name.bytes()),
            KeyKind::ComputedString(_) if file.slice(span).starts_with(b"`") => Leaf::Template,
            KeyKind::String(value) | KeyKind::ComputedString(value) => Leaf::String(value.bytes()),
            KeyKind::Number(value) | KeyKind::ComputedNumber(value) => match file.slice(span).ends_with(b"n") {
                true => Leaf::BigInt(value.bytes()),
                false => Leaf::Number(std::str::from_utf8(value.bytes()).ok()?.parse().ok()?),
            },
            KeyKind::Computed(_) => return None,
        };
        Some((leaf, span))
    }

    fn node_type(self) -> NodeType {
        match self {
            Leaf::Identifier(_) => NodeType::Identifier,
            Leaf::Private(_) => NodeType::PrivateIdentifier,
            Leaf::JsxIdentifier => NodeType::JSXIdentifier,
            Leaf::Template => NodeType::TemplateLiteral,
            _ => NodeType::Literal,
        }
    }
}

// ───────────────────────────── from handles ─────────────────────────────

impl<'a> VNode<'a> {
    #[inline]
    pub(super) fn new(base: impl Into<Node<'a>>, part: Part) -> VNode<'a> {
        VNode {
            base: base.into(),
            part,
        }
    }

    /// The same node of [`crate::ast`], another part.
    #[inline]
    pub(super) fn with(self, part: Part) -> VNode<'a> {
        VNode { part, ..self }
    }

    /// The root.
    #[inline]
    pub fn program(file: &'a File<'a>) -> VNode<'a> {
        VNode::new(file, Part::Main)
    }

    /// The node of [`crate::ast`] that it is made of: itself, or what it is a part of.
    #[inline]
    pub fn base(self) -> Node<'a> {
        self.base
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.base.file()
    }

    #[inline]
    pub fn dialect(self) -> Dialect {
        Dialect::of(self.file())
    }

    /// What is where `e` is written, with all that ESTree has around it. `None` for a hole.
    pub(super) fn of_expr(e: Expr<'a>) -> Option<VNode<'a>> {
        match e.jsx_container_span() {
            Some(_) => Some(VNode::new(e, Part::Container)),
            None => VNode::in_container(e),
        }
    }

    /// `e` without the braces of JSX.
    pub(super) fn in_container(e: Expr<'a>) -> Option<VNode<'a>> {
        match e.tag() {
            ExprTag::Missing => None,
            ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull if e.is_chain_root() => {
                Some(VNode::new(e, Part::Chain))
            }
            _ => Some(VNode::main_of_expr(e)),
        }
    }

    pub(super) fn main_of_expr(e: Expr<'a>) -> VNode<'a> {
        match e.kind() {
            ExprKind::Fn(func) => VNode::new(func, Part::Main),
            ExprKind::Class(class) => VNode::new(class, Part::Main),
            _ => VNode::new(e, Part::Main),
        }
    }

    /// Whether `statement` is a declaration after `export`.
    pub(super) fn is_exported_declaration(statement: Stmt<'a>) -> bool {
        matches!(
            statement.kind(),
            StmtKind::Fn(_)
                | StmtKind::Var(_)
                | StmtKind::Class(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Interface(_)
                | StmtKind::Enum(_)
                | StmtKind::Module(_)
                | StmtKind::ImportEquals(_)
        ) && (statement.modifiers().iter().map(Modifier::flag).find(|it| !it.is_empty())) == Some(Flags::EXPORT)
    }

    pub(super) fn of_stmt(statement: Stmt<'a>) -> VNode<'a> {
        match VNode::is_exported_declaration(statement) {
            true => VNode::new(statement, Part::Export),
            false => VNode::main_of_stmt(statement),
        }
    }

    pub(super) fn main_of_stmt(statement: Stmt<'a>) -> VNode<'a> {
        match statement.kind() {
            StmtKind::Fn(func) => VNode::new(func, Part::Main),
            StmtKind::Class(class) => VNode::new(class, Part::Main),
            _ => VNode::new(statement, Part::Main),
        }
    }

    /// What is in the head of a `for`.
    pub(super) fn of_for_head(head: Stmt<'a>) -> Option<VNode<'a>> {
        match head.kind() {
            StmtKind::Expr(e) => VNode::of_expr(e),
            _ => Some(VNode::new(head, Part::Main)),
        }
    }

    #[inline]
    pub(super) fn of_type(ty: TypeNode<'a>) -> VNode<'a> {
        VNode::new(ty, Part::Main)
    }

    #[inline]
    pub(super) fn annotation(ty: TypeNode<'a>) -> VNode<'a> {
        VNode::new(ty, Part::Annotation)
    }

    pub(super) fn of_pat(pat: Pat<'a>) -> Option<VNode<'a>> {
        (!matches!(pat.kind(), PatKind::Missing)).then(|| VNode::new(pat, Part::Main))
    }

    pub(super) fn has_keywords(param: Param<'a>) -> bool {
        param.modifiers().iter().any(|it| it.decorator().is_none())
    }

    pub(super) fn of_param(param: Param<'a>) -> VNode<'a> {
        match VNode::has_keywords(param) {
            true => VNode::new(param, Part::Main),
            false => VNode::inner_of_param(param),
        }
    }

    pub(super) fn inner_of_param(param: Param<'a>) -> VNode<'a> {
        match param.is_rest() || param.default().is_some() {
            true => VNode::new(param, Part::Inner),
            false => VNode::new(param.pat(), Part::Main),
        }
    }

    pub(super) fn of_pat_elem(element: PatElem<'a>) -> Option<VNode<'a>> {
        let pat = element.pat()?;
        Some(match element.is_rest() || element.default().is_some() {
            true => VNode::new(element, Part::Main),
            false => VNode::new(pat, Part::Main),
        })
    }

    pub(super) fn of_tuple_elem(element: TupleElem<'a>) -> VNode<'a> {
        match element.is_rest() {
            true => VNode::new(element, Part::Rest),
            false => VNode::in_rest(element),
        }
    }

    /// `element` without its `...`.
    pub(super) fn in_rest(element: TupleElem<'a>) -> VNode<'a> {
        if element.name().is_some() {
            VNode::new(element, Part::Named)
        } else if element.is_optional() {
            VNode::new(element, Part::Optional)
        } else {
            VNode::of_type(element.ty())
        }
    }

    /// The `key` of `owner`.
    pub(super) fn of_key(owner: impl Into<Node<'a>>, key: Key<'a>) -> Option<VNode<'a>> {
        match key.kind() {
            KeyKind::Computed(e) => VNode::of_expr(e),
            _ => Some(VNode::new(owner, Part::Key)),
        }
    }

    /// `A.B.C` in `owner`, which has `len` names: the whole of it.
    pub(super) fn of_entity_name(owner: impl Into<Node<'a>>, len: usize, is_member: bool) -> Option<VNode<'a>> {
        let last = len.checked_sub(1)? as u32;
        Some(VNode::new(
            owner,
            match (last, is_member) {
                (0, _) => Part::NamePart(0),
                (_, true) => Part::MemberName(last),
                (_, false) => Part::Qualified(last),
            },
        ))
    }
}

// ───────────────────────────── to handles ─────────────────────────────

impl<'a> VNode<'a> {
    #[inline]
    pub(super) fn expr(self) -> Option<Expr<'a>> {
        self.base.as_expr()
    }

    #[inline]
    pub(super) fn stmt(self) -> Option<Stmt<'a>> {
        self.base.as_stmt()
    }

    #[inline]
    pub(super) fn ty(self) -> Option<TypeNode<'a>> {
        self.base.as_type()
    }

    #[inline]
    pub(super) fn func(self) -> Option<Func<'a>> {
        self.base.as_func()
    }

    pub(super) fn modifier(self) -> Option<Modifier<'a>> {
        match self.part {
            Part::Decorator(id) => Modifier::some(self.file(), ModifierId(id)),
            _ => None,
        }
    }

    pub(super) fn attribute(self) -> Option<Prop<'a>> {
        match self.part {
            Part::Attribute(id) | Part::AttributeKey(id) => Prop::some(self.file(), PropId(id)),
            _ => None,
        }
    }

    /// The `n`th of the namespaces of `namespace A.B.C`, counted from 0.
    pub(super) fn nested_module(module: Module<'a>, n: u32) -> Option<Module<'a>> {
        (0..n).try_fold(module, |at, _| at.nested())
    }

    /// The qualified name that the parts `NamePart`, `Qualified` and `MemberName` of it are of.
    pub(super) fn entity_name(self) -> Option<EntityName<'a>> {
        match self.base {
            Node::Type(ty) => match ty.kind() {
                TypeKind::Ref { name, .. } | TypeKind::Import { name, .. } => Some(name),
                _ => None,
            },
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::ImportEquals(import) => match import.target() {
                    ImportEqualsTarget::Entity(name) => Some(name),
                    ImportEqualsTarget::Require(_) => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    /// The span of the name at `i` of the qualified name in it.
    fn name_part_span(self, i: u32) -> Option<Span> {
        match self.base.as_stmt().map(Stmt::kind) {
            Some(StmtKind::Module(module)) => Some(VNode::nested_module(module, i)?.name_span()),
            _ => Some(self.entity_name()?.get(i as usize)?.span()),
        }
    }

    /// Whether `ty` is an element of the `extends` of an interface or the `implements` of a class.
    pub(super) fn is_heritage(ty: TypeNode<'a>) -> bool {
        if !matches!(ty.kind(), TypeKind::Ref { .. } | TypeKind::Heritage { .. }) {
            return false;
        }
        match ty.parent() {
            Node::Stmt(statement) => matches!(statement.kind(), StmtKind::Interface(_)),
            Node::Class(class) => {
                class.implements().first().is_some_and(|first| first.span().start <= ty.span().start)
            }
            _ => false,
        }
    }

    /// Whether the type `ty` is where ESTree has a `TSTypeAnnotation` around it.
    pub(super) fn is_annotated(ty: TypeNode<'a>) -> bool {
        match ty.parent() {
            Node::Param(_) | Node::VarDecl(_) | Node::Member(_) | Node::Func(_) => true,
            Node::Type(parent) => matches!(parent.kind(), TypeKind::Predicate { .. }),
            _ => false,
        }
    }

    /// The token that it is, if it is one.
    pub(super) fn leaf(self) -> Option<(Leaf<'a>, Span)> {
        let file = self.file();
        let string = |value: Option<&'a [u8]>, span: Option<Span>| Some((Leaf::String(value?), span?));
        let word = |span: Span| Some((Leaf::Identifier(file.slice(span)), span));
        let ident = |ident: Option<Ident<'a>>| ident.map(Leaf::ident);
        match (self.base, self.part) {
            (Node::Expr(e), Part::Main) => {
                let leaf = match e.kind() {
                    ExprKind::Ident(_) | ExprKind::This if e.is_jsx_tag_name() => Leaf::JsxIdentifier,
                    ExprKind::Ident(name) => Leaf::Identifier(name.bytes()),
                    ExprKind::PrivateIdentifier(name) => Leaf::Private(name.bytes()),
                    ExprKind::Null => Leaf::Null,
                    ExprKind::True => Leaf::Bool(true),
                    ExprKind::False => Leaf::Bool(false),
                    ExprKind::Number(value) => Leaf::Number(value),
                    ExprKind::BigInt(digits) => Leaf::BigInt(digits.bytes()),
                    ExprKind::Regex(regex) => Leaf::Regex {
                        pattern: regex.pattern(),
                        flags: regex.flags(),
                    },
                    ExprKind::String(_) if e.is_jsx_text() => return None,
                    ExprKind::String(_) if e.is_jsx_tag_name() => {
                        if bun_core::strings::contains_char(e.text(), b':') {
                            return None;
                        }
                        Leaf::JsxIdentifier
                    }
                    ExprKind::String(value) => Leaf::String(value.bytes()),
                    _ => return None,
                };
                Some((leaf, e.span()))
            }
            (Node::Expr(e), Part::Property | Part::Meta) => {
                let is_property = self.part == Part::Property;
                match e.kind() {
                    ExprKind::Dot { name, .. } if e.is_jsx_tag_name() => Some((Leaf::JsxIdentifier, name.span())),
                    ExprKind::Dot { name, .. } => Some(Leaf::ident(name)),
                    ExprKind::ImportMeta | ExprKind::NewTarget => {
                        let (meta, property) = e.meta_property_spans()?;
                        word(if is_property { property } else { meta })
                    }
                    // `a:b`
                    ExprKind::String(_) => {
                        let (namespace, name) = jsx_namespaced(file, e.span())?;
                        Some((Leaf::JsxIdentifier, if is_property { name } else { namespace }))
                    }
                    _ => None,
                }
            }
            (Node::Expr(e), Part::ConstName) => word(e.const_keyword_span()?),
            (Node::Prop(prop), Part::KeyNamespace | Part::KeyName) => {
                let (namespace, name) = jsx_namespaced(file, prop.key()?.span(file))?;
                Some((Leaf::JsxIdentifier, if self.part == Part::KeyName { name } else { namespace }))
            }
            (Node::Prop(prop), Part::Key) => {
                let found = Leaf::key(file, prop.key()?)?;
                let is_namespaced = matches!(found.0, Leaf::JsxIdentifier)
                    && bun_core::strings::contains_char(file.slice(found.1), b':');
                (!is_namespaced).then_some(found)
            }
            (_, Part::AttributeKey(_)) => Leaf::key(file, self.attribute()?.key()?),
            (Node::PatProp(prop), Part::Key) => Leaf::key(file, prop.key()?),
            (Node::EnumMember(member), Part::Key) => Leaf::key(file, member.key()?),
            (Node::Member(member), Part::Key) => match member.constructor_keyword() {
                Some(keyword) if keyword.is_string() => Some((Leaf::String(b"constructor"), keyword.span())),
                Some(keyword) => Some((Leaf::Identifier(b"constructor"), keyword.span())),
                None => Leaf::key(file, member.key()?),
            },
            (Node::Func(func), Part::Name) => ident(func.name()),
            (Node::Class(class), Part::Name) => ident(class.name()),
            (Node::TypeParam(param), Part::Name) => ident(Some(param.name())),
            (Node::TupleElem(element), Part::Name) => ident(element.name()),
            (Node::ImportSpec(it), Part::Imported) => ident(Some(it.imported())),
            (Node::ImportSpec(it), Part::Local) => ident(Some(it.local())),
            (Node::ExportSpec(it), Part::Local) => ident(Some(it.local())),
            (Node::ExportSpec(it), Part::Exported) => ident(Some(it.exported())),
            (Node::Stmt(statement), Part::Name) => ident(match statement.kind() {
                StmtKind::Labeled { .. } | StmtKind::Break(_) | StmtKind::Continue(_) => statement.label(),
                StmtKind::Interface(it) => Some(it.name()),
                StmtKind::TypeAlias(it) => Some(it.name()),
                StmtKind::Enum(it) => Some(it.name()),
                StmtKind::ImportEquals(it) => Some(it.name()),
                StmtKind::ExportAsNamespace(_) => statement.namespace_export_name(),
                StmtKind::ExportStar { alias, .. } => alias,
                _ => None,
            }),
            (Node::Stmt(statement), Part::NamePart(i)) => match statement.kind() {
                StmtKind::Module(module) => {
                    let module = VNode::nested_module(module, i)?;
                    match module.name() {
                        ModuleName::Ident(name) | ModuleName::String(name) => Some(Leaf::ident(name)),
                        ModuleName::Global => Some((Leaf::Identifier(b"global"), module.name_span())),
                    }
                }
                _ => ident(self.entity_name()?.get(i as usize)),
            },
            (Node::Stmt(statement), Part::Source) => {
                let spec = match statement.kind() {
                    StmtKind::Import(import) => Some(import.spec()),
                    StmtKind::ExportNamed(export) => export.spec(),
                    StmtKind::ExportStar { spec, .. } => spec,
                    StmtKind::ImportEquals(import) => match import.target() {
                        ImportEqualsTarget::Require(spec) => spec,
                        ImportEqualsTarget::Entity(_) => None,
                    },
                    _ => None,
                };
                string(spec.map(|it| it.bytes()), statement.module_specifier_span())
            }
            (Node::Stmt(statement), Part::DefaultLocal | Part::NamespaceLocal) => match statement.kind() {
                StmtKind::Import(import) if self.part == Part::DefaultLocal => ident(import.default()),
                StmtKind::Import(import) => ident(import.namespace()),
                _ => None,
            },
            (Node::Type(ty), Part::Name) => ident(ty.predicate_param().filter(|it| !it.name().is("this"))),
            (Node::Type(_), Part::NamePart(i)) => ident(self.entity_name()?.get(i as usize)),
            (Node::Type(ty), Part::Source) => match ty.kind() {
                TypeKind::Import { spec, .. } => string(spec.map(|it| it.bytes()), ty.import_source_span()),
                _ => None,
            },
            (Node::Type(ty), Part::OptionsKey) => word(ty.import_attributes()?.keyword_span()),
            (Node::Type(ty), Part::Literal | Part::LiteralArgument) => {
                let mut span = ty.span();
                let is_negative = file.slice(span).starts_with(b"-");
                if is_negative {
                    if self.part == Part::Literal {
                        return None;
                    }
                    span.start = skip_trivia(file.text(), span.start + 1);
                }
                let leaf = match ty.kind() {
                    TypeKind::StringLit(_) if file.slice(span).starts_with(b"`") => Leaf::Template,
                    TypeKind::StringLit(value) => Leaf::String(value.bytes()),
                    TypeKind::NumberLit(value) => Leaf::Number(value.abs()),
                    TypeKind::BigIntLit { text, .. } => Leaf::BigInt(text.bytes()),
                    TypeKind::BoolLit(value) => Leaf::Bool(value),
                    _ => return None,
                };
                Some((leaf, span))
            }
            _ => None,
        }
    }
}

/// The spans of the `a` and the `b` of the JSX name `a:b` at `span`.
fn jsx_namespaced(file: &File, span: Span) -> Option<(Span, Span)> {
    let colon = span.start + bun_core::strings::index_of_char_usize(file.slice(span), b':')? as u32;
    let text = file.text();
    Some((
        Span::new(span.start, skip_trivia_back(text, colon)),
        Span::new(skip_trivia(text, colon + 1), span.end),
    ))
}

// ───────────────────────────── what it is ─────────────────────────────

impl<'a> VNode<'a> {
    /// ESTree's `type`.
    pub fn node_type(self) -> NodeType {
        use NodeType::*;
        if let Some((leaf, _)) = self.leaf() {
            return leaf.node_type();
        }
        match (self.base, self.part) {
            (Node::File(_), _) => Program,
            (Node::Type(_), Part::Name) => TSThisType,
            (Node::Prop(_), Part::Key) => JSXNamespacedName,
            // These are tokens. Where the token is missing, the file has errors.
            (
                _,
                Part::Name
                | Part::Key
                | Part::KeyNamespace
                | Part::KeyName
                | Part::Property
                | Part::Meta
                | Part::Source
                | Part::DefaultLocal
                | Part::NamespaceLocal
                | Part::Imported
                | Part::Local
                | Part::Exported
                | Part::LiteralArgument
                | Part::OptionsKey
                | Part::ConstName
                | Part::AttributeKey(_)
                | Part::NamePart(_),
            ) => Identifier,
            (_, Part::Decorator(_)) => Decorator,
            (_, Part::Quasi(_) | Part::KeyQuasi) => TemplateElement,
            (_, Part::TypeParams) => TSTypeParameterDeclaration,
            (_, Part::TypeArgs) => TSTypeParameterInstantiation,
            (_, Part::Qualified(_)) => TSQualifiedName,
            (_, Part::MemberName(_)) => MemberExpression,
            (Node::Stmt(_), Part::Attribute(_)) => ImportAttribute,
            (_, Part::Attribute(_)) => Property,
            (Node::Expr(e), part) => expr_type(e, part),
            (Node::Stmt(statement), part) => stmt_type(statement, part),
            (Node::Type(ty), part) => type_type(ty, part),
            (Node::Func(_), Part::Body) => BlockStatement,
            (Node::Func(func), _) => match func.kind() {
                FnKind::Arrow => ArrowFunctionExpression,
                FnKind::Decl if func.has_body() => FunctionDeclaration,
                FnKind::Decl => TSDeclareFunction,
                _ if func.has_body() => FunctionExpression,
                _ => TSEmptyBodyFunctionExpression,
            },
            (Node::Class(_), Part::Body) => ClassBody,
            (Node::Class(class), _) => match class.owner() {
                Node::Stmt(_) => ClassDeclaration,
                _ => ClassExpression,
            },
            (Node::Member(member), _) => member_type(member),
            (Node::Prop(prop), _) => match prop.kind() {
                PropKind::Spread if prop.is_jsx_attribute() => JSXSpreadAttribute,
                PropKind::Spread => match prop.parent() {
                    Node::Expr(object) if object.is_assignment_target() => RestElement,
                    _ => SpreadElement,
                },
                _ if prop.is_jsx_attribute() => JSXAttribute,
                _ => Property,
            },
            (Node::Pat(pat), _) => match pat.kind() {
                PatKind::Object(_) => ObjectPattern,
                PatKind::Array(_) => ArrayPattern,
                PatKind::Ident(_) | PatKind::Missing => Identifier,
            },
            (Node::PatProp(_), Part::Value) => AssignmentPattern,
            (Node::PatProp(prop), _) => match prop.is_rest() {
                true => RestElement,
                false => Property,
            },
            (Node::PatElem(element), _) => match element.default() {
                Some(_) => AssignmentPattern,
                None => RestElement,
            },
            (Node::Param(_), Part::Main) => TSParameterProperty,
            (Node::Param(param), _) => match param.is_rest() {
                true => RestElement,
                false => AssignmentPattern,
            },
            (Node::TypeParam(_), _) => TSTypeParameter,
            (Node::VarDecl(_), _) => VariableDeclarator,
            (Node::Case(_), _) => SwitchCase,
            (Node::EnumMember(_), _) => TSEnumMember,
            (Node::ImportSpec(_), _) => ImportSpecifier,
            (Node::ExportSpec(_), _) => ExportSpecifier,
            (Node::TupleElem(_), Part::Rest) => TSRestType,
            (Node::TupleElem(_), Part::Optional) => TSOptionalType,
            (Node::TupleElem(_), _) => TSNamedTupleMember,
        }
    }
}

fn expr_type(e: Expr, part: Part) -> NodeType {
    use NodeType::*;
    match part {
        Part::Chain => return ChainExpression,
        Part::Container => {
            return match e.tag() {
                ExprTag::Spread => JSXSpreadChild,
                _ => JSXExpressionContainer,
            };
        }
        Part::ConstType => return TSTypeReference,
        Part::Whitespace(_) => return JSXText,
        Part::Opening | Part::Closing => {
            let is_fragment = matches!(e.kind(), ExprKind::Jsx(jsx) if jsx.is_fragment());
            return match (part, is_fragment) {
                (Part::Opening, false) => JSXOpeningElement,
                (Part::Opening, true) => JSXOpeningFragment,
                (_, false) => JSXClosingElement,
                (_, true) => JSXClosingFragment,
            };
        }
        _ => {}
    }
    match e.kind() {
        ExprKind::Missing => JSXEmptyExpression,
        ExprKind::This => ThisExpression,
        ExprKind::Super => Super,
        // The others are leaves.
        ExprKind::String(_) if e.is_jsx_text() => JSXText,
        ExprKind::String(_) => JSXNamespacedName,
        ExprKind::Ident(_) => Identifier,
        ExprKind::PrivateIdentifier(_) => PrivateIdentifier,
        ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_) => Literal,
        ExprKind::Template(_) => TemplateLiteral,
        ExprKind::TaggedTemplate(_) => TaggedTemplateExpression,
        ExprKind::Array(_) if e.is_assignment_target() => ArrayPattern,
        ExprKind::Array(_) => ArrayExpression,
        ExprKind::Object(_) if e.is_assignment_target() => ObjectPattern,
        ExprKind::Object(_) => ObjectExpression,
        ExprKind::Fn(func) if func.is_arrow() => ArrowFunctionExpression,
        ExprKind::Fn(_) => FunctionExpression,
        ExprKind::Class(_) => ClassExpression,
        ExprKind::Dot { .. } if e.is_jsx_tag_name() => JSXMemberExpression,
        ExprKind::Dot { .. } if e.is_in_type_query() => TSQualifiedName,
        ExprKind::Dot { .. } | ExprKind::Index { .. } => MemberExpression,
        ExprKind::Call(_) => CallExpression,
        ExprKind::New(_) => NewExpression,
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            ..
        } => UpdateExpression,
        ExprKind::Unary { .. } => UnaryExpression,
        ExprKind::Binary { op, .. } => match op {
            crate::ast::BinOp::Comma => SequenceExpression,
            crate::ast::BinOp::And | crate::ast::BinOp::Or | crate::ast::BinOp::Nullish => LogicalExpression,
            _ => BinaryExpression,
        },
        ExprKind::Assign { .. } if is_assignment_pattern(e) => AssignmentPattern,
        ExprKind::Assign { .. } => AssignmentExpression,
        ExprKind::Cond { .. } => ConditionalExpression,
        ExprKind::Spread(_) if e.is_assignment_target() => RestElement,
        ExprKind::Spread(_) => SpreadElement,
        ExprKind::Await(_) => AwaitExpression,
        ExprKind::Yield { .. } => YieldExpression,
        ExprKind::Satisfies { .. } => TSSatisfiesExpression,
        ExprKind::As { .. } | ExprKind::AsConst(_) => match e.is_angle_bracket_assertion() {
            true => TSTypeAssertion,
            false => TSAsExpression,
        },
        ExprKind::NonNull(_) => TSNonNullExpression,
        ExprKind::Instantiation { .. } => TSInstantiationExpression,
        ExprKind::Jsx(jsx) if jsx.is_fragment() => JSXFragment,
        ExprKind::Jsx(_) => JSXElement,
        ExprKind::ImportCall { .. } => ImportExpression,
        ExprKind::ImportMeta | ExprKind::NewTarget => MetaProperty,
    }
}

/// Whether the `Assign` `e` is a default: in what is assigned to, or in `{ a = 1 }`.
pub(super) fn is_assignment_pattern(e: Expr) -> bool {
    matches!(e.parent(), Node::Prop(prop) if prop.kind() == PropKind::Shorthand) || e.is_assignment_target()
}

fn stmt_type(statement: Stmt, part: Part) -> NodeType {
    use NodeType::*;
    let kind = statement.kind();
    match part {
        Part::Export => {
            return match statement.is_default_export() {
                true => ExportDefaultDeclaration,
                false => ExportNamedDeclaration,
            };
        }
        Part::Catch => return CatchClause,
        Part::Reference => return TSExternalModuleReference,
        Part::DefaultSpecifier => return ImportDefaultSpecifier,
        Part::NamespaceSpecifier => return ImportNamespaceSpecifier,
        Part::Body => {
            return match kind {
                StmtKind::Interface(_) => TSInterfaceBody,
                StmtKind::Enum(_) => TSEnumBody,
                _ => TSModuleBlock,
            };
        }
        _ => {}
    }
    match kind {
        StmtKind::Empty => EmptyStatement,
        StmtKind::Debugger => DebuggerStatement,
        StmtKind::Expr(_) => ExpressionStatement,
        StmtKind::Var(_) => VariableDeclaration,
        StmtKind::Fn(func) if func.has_body() => FunctionDeclaration,
        StmtKind::Fn(_) => TSDeclareFunction,
        StmtKind::Class(_) => ClassDeclaration,
        StmtKind::Interface(_) => TSInterfaceDeclaration,
        StmtKind::TypeAlias(_) => TSTypeAliasDeclaration,
        StmtKind::Enum(_) => TSEnumDeclaration,
        StmtKind::Module(_) => TSModuleDeclaration,
        StmtKind::Return(_) => ReturnStatement,
        StmtKind::If { .. } => IfStatement,
        StmtKind::For { .. } => ForStatement,
        StmtKind::ForIn { .. } => ForInStatement,
        StmtKind::ForOf { .. } => ForOfStatement,
        StmtKind::While { .. } => WhileStatement,
        StmtKind::DoWhile { .. } => DoWhileStatement,
        StmtKind::Block(_) => BlockStatement,
        StmtKind::With { .. } => WithStatement,
        StmtKind::Switch { .. } => SwitchStatement,
        StmtKind::Try { .. } => TryStatement,
        StmtKind::Throw(_) => ThrowStatement,
        StmtKind::Break(_) => BreakStatement,
        StmtKind::Continue(_) => ContinueStatement,
        StmtKind::Labeled { .. } => LabeledStatement,
        StmtKind::Import(_) => ImportDeclaration,
        StmtKind::ImportEquals(_) => TSImportEqualsDeclaration,
        StmtKind::ExportNamed(_) => ExportNamedDeclaration,
        StmtKind::ExportStar { .. } => ExportAllDeclaration,
        StmtKind::ExportDefault(_) => ExportDefaultDeclaration,
        StmtKind::ExportAssign(_) => TSExportAssignment,
        StmtKind::ExportAsNamespace(_) => TSNamespaceExportDeclaration,
    }
}

fn type_type(ty: TypeNode, part: Part) -> NodeType {
    use NodeType::*;
    match part {
        Part::Annotation => return TSTypeAnnotation,
        Part::Heritage => {
            return match ty.parent() {
                Node::Class(_) => TSClassImplements,
                _ => TSInterfaceHeritage,
            };
        }
        // The others are leaves.
        Part::Literal => return UnaryExpression,
        Part::Operand => return TSSymbolKeyword,
        Part::ImportType => return TSImportType,
        Part::Options | Part::OptionsValue => return ObjectExpression,
        Part::OptionsProperty => return Property,
        _ => {}
    }
    match ty.kind() {
        // There is no such node. A file with one of these has errors.
        TypeKind::Error | TypeKind::Heritage { .. } => TSAnyKeyword,
        TypeKind::Keyword(keyword) => match keyword {
            Keyword::Any => TSAnyKeyword,
            Keyword::Unknown => TSUnknownKeyword,
            Keyword::Never => TSNeverKeyword,
            Keyword::Void => TSVoidKeyword,
            Keyword::Undefined => TSUndefinedKeyword,
            Keyword::Null => TSNullKeyword,
            Keyword::String => TSStringKeyword,
            Keyword::Number => TSNumberKeyword,
            Keyword::Boolean => TSBooleanKeyword,
            Keyword::BigInt => TSBigIntKeyword,
            Keyword::Symbol => TSSymbolKeyword,
            Keyword::Object => TSObjectKeyword,
            Keyword::This => TSThisType,
            Keyword::Intrinsic => TSIntrinsicKeyword,
        },
        TypeKind::Ref { .. } => TSTypeReference,
        TypeKind::StringLit(_) | TypeKind::NumberLit(_) | TypeKind::BigIntLit { .. } | TypeKind::BoolLit(_) => {
            TSLiteralType
        }
        TypeKind::Template(_) => TSTemplateLiteralType,
        TypeKind::Array(_) => TSArrayType,
        TypeKind::Tuple(_) => TSTupleType,
        TypeKind::Union(_) => TSUnionType,
        TypeKind::Intersection(_) => TSIntersectionType,
        TypeKind::Fn(func) if func.kind() == FnKind::ConstructorType => TSConstructorType,
        TypeKind::Fn(_) => TSFunctionType,
        TypeKind::Object(_) => TSTypeLiteral,
        TypeKind::Cond { .. } => TSConditionalType,
        TypeKind::Infer(_) => TSInferType,
        TypeKind::Mapped(_) => TSMappedType,
        TypeKind::IndexedAccess { .. } => TSIndexedAccessType,
        TypeKind::Keyof(_) | TypeKind::Readonly(_) | TypeKind::UniqueSymbol => TSTypeOperator,
        TypeKind::Typeof { .. } | TypeKind::Import { is_typeof: true, .. } => TSTypeQuery,
        TypeKind::Import { .. } => TSImportType,
        TypeKind::Predicate { .. } => TSTypePredicate,
    }
}

fn member_type(member: Member) -> NodeType {
    use NodeType::*;
    let keywords = member.modifiers().iter().fold(Flags::empty(), |all, it| all | it.flag());
    let is_abstract = keywords.contains(Flags::ABSTRACT);
    match member.kind() {
        MemberKind::CallSignature => TSCallSignatureDeclaration,
        MemberKind::ConstructSignature => TSConstructSignatureDeclaration,
        MemberKind::IndexSignature => TSIndexSignature,
        MemberKind::StaticBlock => StaticBlock,
        MemberKind::Property if member.is_signature() => TSPropertySignature,
        _ if member.is_signature() => TSMethodSignature,
        MemberKind::Property => match (keywords.contains(Flags::ACCESSOR), is_abstract) {
            (true, true) => TSAbstractAccessorProperty,
            (true, false) => AccessorProperty,
            (false, true) => TSAbstractPropertyDefinition,
            (false, false) => PropertyDefinition,
        },
        _ if is_abstract => TSAbstractMethodDefinition,
        _ => MethodDefinition,
    }
}

// ───────────────────────────── where it is ─────────────────────────────

impl<'a> VNode<'a> {
    /// ESTree's `range`, in bytes.
    pub fn span(self) -> Span {
        if let Some((_, span)) = self.leaf() {
            return span;
        }
        self.span_of_part().unwrap_or_else(|| self.base.span())
    }

    /// `None`: that of the node of [`crate::ast`].
    fn span_of_part(self) -> Option<Span> {
        let file = self.file();
        let through = |i: u32| Some(self.name_part_span(0)?.to(self.name_part_span(i)?));
        match (self.base, self.part) {
            (Node::File(file), _) => Some(match Dialect::of(file) {
                Dialect::TypeScript => file.program_span(),
                Dialect::Espree => espree_program_span(file),
            }),
            (_, Part::Decorator(_)) => Some(self.modifier()?.span()),
            (_, Part::Attribute(_)) => Some(self.attribute()?.span()),
            (_, Part::Qualified(i) | Part::MemberName(i)) => through(i),
            (_, Part::KeyQuasi) => Some(self.with(Part::Key).span()),
            (Node::Expr(e), part) => match part {
                Part::Container => e.jsx_container_span(),
                Part::Main if e.is_missing() => Some(e.jsx_container_span()?.shrink(1, 1)),
                Part::ConstType => e.const_keyword_span(),
                Part::Whitespace(start) => {
                    let rest = file.text().get(start as usize..)?;
                    let len = bun_core::strings::index_of_any(rest, b"<{").unwrap_or(rest.len());
                    Some(Span::new(start, start + len as u32))
                }
                Part::Quasi(i) => match e.kind() {
                    ExprKind::Template(template) => Some(template.quasi_span(i as usize)),
                    _ => None,
                },
                Part::TypeArgs => match e.kind() {
                    ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                        call.type_args().angle_brackets_span()
                    }
                    ExprKind::Instantiation { type_args, .. } => type_args.angle_brackets_span(),
                    ExprKind::Jsx(jsx) => jsx.type_args().angle_brackets_span(),
                    _ => None,
                },
                Part::Opening | Part::Closing => match e.kind() {
                    ExprKind::Jsx(jsx) if part == Part::Opening => Some(jsx.opening_span()),
                    ExprKind::Jsx(jsx) => jsx.closing_span(),
                    _ => None,
                },
                _ => None,
            },
            (Node::Stmt(statement), part) => match part {
                Part::Export => statement.export_span(),
                Part::Main if VNode::is_exported_declaration(statement) => Some(statement.span_without_export()),
                Part::Catch => statement.catch_clause_span(),
                Part::Reference => match statement.kind() {
                    StmtKind::ImportEquals(import) => import.require_span(),
                    _ => None,
                },
                Part::DefaultSpecifier => Some(self.with(Part::DefaultLocal).span()),
                Part::NamespaceSpecifier => match statement.kind() {
                    StmtKind::Import(import) => import.namespace_span(),
                    _ => None,
                },
                Part::Body => match statement.kind() {
                    StmtKind::Interface(it) => Some(it.body_span()),
                    StmtKind::Enum(it) => Some(it.body_span()),
                    StmtKind::Module(it) => it.innermost().body_span(),
                    _ => None,
                },
                Part::TypeParams => match statement.kind() {
                    StmtKind::Interface(it) => it.type_params().angle_brackets_span(),
                    StmtKind::TypeAlias(it) => it.type_params().angle_brackets_span(),
                    _ => None,
                },
                _ => None,
            },
            (Node::Func(func), part) => match part {
                Part::Body => func.body_span(),
                Part::TypeParams => func.type_params().angle_brackets_span(),
                _ => Some(func.estree_span()),
            },
            (Node::Class(class), part) => match part {
                Part::Body => Some(class.body_span()),
                Part::TypeParams => class.type_params().angle_brackets_span(),
                Part::TypeArgs => class.extends_args().angle_brackets_span(),
                _ => Some(class.estree_span()),
            },
            (Node::Prop(prop), Part::Key) => Some(prop.key()?.span(file)),
            (Node::Pat(pat), _) => Some(match pat.parent() {
                Node::Param(param) if !param.is_rest() => param.binding_span(),
                Node::VarDecl(declaration) => declaration.binding_span(),
                _ => pat.span(),
            }),
            (Node::PatProp(prop), Part::Value) => {
                Some(Span::new(prop.value().span().start, prop.default()?.outer_span().end))
            }
            (Node::Param(param), Part::Inner) if !param.is_rest() => {
                Some(Span::new(param.pat().span().start, param.default()?.outer_span().end))
            }
            (Node::TupleElem(element), Part::Named) => {
                Some(Span::new(element.name()?.span().start, element.span().end))
            }
            (Node::Type(ty), part) => match part {
                Part::Annotation => Some(match ty.parent() {
                    Node::Type(_) => ty.span(),
                    _ => ty.annotation_span(),
                }),
                Part::Name => Some(ty.predicate_param()?.span()),
                Part::Operand => ty.unique_symbol_keyword_span(),
                Part::ImportType => ty.import_span(),
                Part::Options => Some(ty.import_attributes()?.options_span()),
                Part::OptionsValue => Some(ty.import_attributes()?.braces_span()),
                Part::OptionsProperty => {
                    let attributes = ty.import_attributes()?;
                    Some(attributes.keyword_span().to(attributes.braces_span()))
                }
                Part::Quasi(i) => match ty.as_template() {
                    Some(template) => Some(template.quasi_span(i as usize)),
                    None => Some(ty.span()),
                },
                Part::TypeArgs => match ty.kind() {
                    TypeKind::Ref { args, .. }
                    | TypeKind::Heritage { args, .. }
                    | TypeKind::Typeof { args, .. }
                    | TypeKind::Import { args, .. } => args.angle_brackets_span(),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }
}

/// From the first statement to the end of the last token.
fn espree_program_span(file: &File) -> Span {
    let text = file.text();
    let end = skip_trivia_back(text, text.len() as u32);
    let start = skip_trivia(text, 0).min(end);
    Span::new(start, end)
}
