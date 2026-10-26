//! A program's names that ESLint's tree has as `Identifier`s, grouped by the program node each one belongs to: for a
//! rule that upstream writes as an `Identifier` listener, and for checks that depend on all names in a tree, like
//! svelte-eslint-parser's `hasRunesSymbol`.

use crate::ast::{
    ExprKind, ExprTag, Ident, ImportEqualsTarget, Key, KeyKind, ModuleName, Node, PatKind,
    StmtKind, StmtTag, TypeKind, TypeTag,
};
use crate::rule::NodeTags;
use crate::span::{Span, Spanned};

/// An `Identifier` in ESLint's tree that belongs to a program node.
#[derive(Copy, Clone, Debug)]
pub struct Identifier<'a> {
    /// The program node it belongs to.
    pub node: Node<'a>,
    /// With its escapes decoded.
    pub name: &'a [u8],
    /// Its range in ESLint's tree.
    pub span: Span,
    /// The number of `node`'s earlier identifiers with the same range: both names of `import { a }`.
    pub(crate) twin: u8,
}

impl Spanned for Identifier<'_> {
    #[inline]
    fn span(&self) -> Span {
        self.span
    }
}

/// The node kinds that [`identifiers_of`] can find an identifier in.
pub fn owners() -> NodeTags {
    NodeTags::MEMBER
        | NodeTags::PROP
        | NodeTags::PAT_PROP
        | NodeTags::ENUM_MEMBER
        | NodeTags::FUNC
        | NodeTags::CLASS
        | NodeTags::PAT
        | NodeTags::TYPE_PARAM
        | NodeTags::IMPORT_SPEC
        | NodeTags::EXPORT_SPEC
        | NodeTags::TUPLE_ELEM
        | [
            ExprTag::Ident,
            ExprTag::Dot,
            ExprTag::ImportMeta,
            ExprTag::NewTarget,
            ExprTag::AsConst,
        ]
        .into()
        | [
            StmtTag::Labeled,
            StmtTag::Break,
            StmtTag::Continue,
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::Import,
            StmtTag::ImportEquals,
            StmtTag::ExportNamed,
            StmtTag::ExportStar,
            StmtTag::ExportAsNamespace,
        ]
        .into()
        | [TypeTag::Ref, TypeTag::Import, TypeTag::Predicate].into()
}

/// Calls `visit` with each `Identifier` in ESLint's tree that belongs to `node` and not to a program node inside it.
/// Across all of a file's nodes of [`owners`], these are all the identifiers in its tree, except the ones a component
/// adds.
pub fn identifiers_of<'a>(node: Node<'a>, mut visit: impl FnMut(Identifier<'a>)) {
    let file = node.file();
    let mut found = Found {
        node,
        last: None,
        twin: 0,
        visit: &mut visit,
    };
    let word = |span: Span| (file.slice(span), span);
    match node {
        Node::Expr(e) => match e.kind() {
            ExprKind::Ident(name) if !e.is_jsx_tag_name() => found.name(name.bytes(), e.span()),
            ExprKind::Dot { name, .. } if !e.is_jsx_tag_name() => found.ident(name),
            ExprKind::ImportMeta | ExprKind::NewTarget => {
                if let Some((meta, property)) = e.meta_property_spans() {
                    found.word(word(meta));
                    found.word(word(property));
                }
            }
            ExprKind::AsConst(_) => {
                if let Some(span) = e.const_keyword_span() {
                    found.word(word(span));
                }
            }
            _ => {}
        },
        Node::Pat(pat) => {
            if let PatKind::Ident(name) = pat.kind() {
                let span = match pat.parent() {
                    Node::Param(param) if !param.is_rest() => param.binding_span(),
                    Node::VarDecl(declaration) => declaration.binding_span(),
                    _ => pat.span(),
                };
                found.name(name.bytes(), span);
            }
        }
        Node::Prop(prop) => found.key(prop.key()),
        Node::PatProp(prop) => found.key(prop.key()),
        Node::EnumMember(member) => found.key(member.key()),
        Node::Member(member) => match member.constructor_keyword() {
            Some(keyword) if !keyword.is_string() => found.name(b"constructor", keyword.span()),
            Some(_) => {}
            None => found.key(member.key()),
        },
        Node::Func(func) => found.ident_if_some(func.name()),
        Node::Class(class) => found.ident_if_some(class.name()),
        Node::TypeParam(param) => found.ident(param.name()),
        Node::TupleElem(element) => found.ident_if_some(element.name()),
        Node::ImportSpec(spec) => {
            found.ident(spec.imported());
            found.ident(spec.local());
        }
        Node::ExportSpec(spec) => {
            found.ident(spec.local());
            found.ident(spec.exported());
        }
        Node::Stmt(statement) => {
            match statement.kind() {
                StmtKind::Labeled { .. } | StmtKind::Break(_) | StmtKind::Continue(_) => {
                    found.ident_if_some(statement.label())
                }
                StmtKind::Interface(it) => found.ident(it.name()),
                StmtKind::TypeAlias(it) => found.ident(it.name()),
                StmtKind::Enum(it) => found.ident(it.name()),
                StmtKind::ImportEquals(it) => {
                    found.ident(it.name());
                    if let ImportEqualsTarget::Entity(name) = it.target() {
                        name.parts().for_each(|it| found.ident(it));
                    }
                }
                StmtKind::ExportAsNamespace(_) => {
                    found.ident_if_some(statement.namespace_export_name())
                }
                StmtKind::ExportStar { alias, .. } => found.ident_if_some(alias),
                StmtKind::Module(module) => {
                    let mut at = Some(module);
                    while let Some(module) = at {
                        match module.name() {
                            ModuleName::Ident(name) | ModuleName::String(name) => found.ident(name),
                            ModuleName::Global => found.name(b"global", module.name_span()),
                        }
                        at = module.nested();
                    }
                }
                StmtKind::Import(import) => {
                    found.ident_if_some(import.default());
                    found.ident_if_some(import.namespace());
                }
                _ => {}
            }
            if let Some(attributes) = statement.import_attributes() {
                attributes
                    .entries()
                    .iter()
                    .for_each(|it| found.key(it.key()));
            }
        }
        Node::Type(ty) => match ty.kind() {
            TypeKind::Ref { name, .. } => name.parts().for_each(|it| found.ident(it)),
            TypeKind::Import { name, .. } => {
                if let Some(attributes) = ty.import_attributes() {
                    found.word(word(attributes.keyword_span()));
                    attributes
                        .entries()
                        .iter()
                        .for_each(|it| found.key(it.key()));
                }
                name.parts().for_each(|it| found.ident(it));
            }
            TypeKind::Predicate { .. } => {
                found.ident_if_some(ty.predicate_param().filter(|it| !it.name().is("this")))
            }
            _ => {}
        },
        _ => {}
    }
}

struct Found<'v, 'a, V: FnMut(Identifier<'a>)> {
    node: Node<'a>,
    /// The range of the last one found, for [`Identifier::twin`].
    last: Option<Span>,
    twin: u8,
    visit: &'v mut V,
}

impl<'a, V: FnMut(Identifier<'a>)> Found<'_, 'a, V> {
    fn name(&mut self, name: &'a [u8], span: Span) {
        self.twin = match self.last == Some(span) {
            true => self.twin + 1,
            false => 0,
        };
        self.last = Some(span);
        (self.visit)(Identifier {
            node: self.node,
            name,
            span,
            twin: self.twin,
        });
    }

    fn word(&mut self, (name, span): (&'a [u8], Span)) {
        self.name(name, span);
    }

    /// A name that isn't a string or a private name.
    fn ident(&mut self, ident: Ident<'a>) {
        let name = ident.bytes();
        if !ident.is_string() && !name.starts_with(b"#") {
            self.name(name, ident.span());
        }
    }

    fn ident_if_some(&mut self, ident: Option<Ident<'a>>) {
        if let Some(ident) = ident {
            self.ident(ident);
        }
    }

    fn key(&mut self, key: Option<Key<'a>>) {
        if let Some(key) = key
            && let KeyKind::Ident(name) = key.kind()
            && !key.is_jsx()
        {
            self.name(name.bytes(), key.inner_span(self.node.file()));
        }
    }
}
