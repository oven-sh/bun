//! ESTree's `Literal`s that are a string or a number, wherever they are.

use crate::ast::{
    ExprTag, File, ImportAttributes, Key, KeyKind, Node, PatTag, StmtKind, StmtTag, TypeTag,
};
use crate::span::{Span, Spanned};
use crate::tokens::skip_trivia;

/// A string in quotes or a number: what ESLint calls a listener for `Literal` with.
///
/// Only some of them are expressions here. The others are part of the node that has them.
#[derive(Copy, Clone)]
pub struct Literal<'a> {
    span: Span,
    owner: Node<'a>,
}

impl<'a> Literal<'a> {
    /// The expression or the type that the literal is. Otherwise what it is a part of:
    /// - the [`Prop`](crate::ast::Prop), [`Member`](crate::ast::Member), [`PatProp`](crate::ast::PatProp) or
    ///   [`EnumMember`](crate::ast::EnumMember) that it is the key of, with or without brackets,
    /// - the [`ImportSpec`](crate::ast::ImportSpec) or [`ExportSpec`](crate::ast::ExportSpec) that it is a name of,
    /// - the statement that it is the module specifier of, the `"a"` of `export * as "a"` or of `declare module "a"`, or a key
    ///   of `with { "a": "b" }`,
    /// - the `import("a")` type.
    #[inline]
    pub fn owner(self) -> Node<'a> {
        self.owner
    }

    /// ESTree's `raw`.
    #[inline]
    pub fn text(self) -> &'a [u8] {
        self.owner.file().slice(self.span)
    }

    /// `1n`
    #[inline]
    pub fn is_bigint(self) -> bool {
        self.text().ends_with(b"n")
    }
}

impl Spanned for Literal<'_> {
    #[inline]
    fn span(&self) -> Span {
        self.span
    }
}

impl<'a> File<'a> {
    pub(crate) fn every_string_literal(&'a self, mut visit: impl FnMut(Literal<'a>)) {
        let is_quoted = |span: Span| matches!(self.text().get(span.start as usize), Some(b'"' | b'\''));
        // What may be a name as well as a string.
        let mut name = |span: Span, owner: Node<'a>| {
            if is_quoted(span) {
                visit(Literal { span, owner });
            }
        };
        let key = |key: Option<Key<'a>>, owner: Node<'a>, name: &mut dyn FnMut(Span, Node<'a>)| {
            if let Some(key) = key
                && matches!(key.kind(), KeyKind::String(_) | KeyKind::ComputedString(_))
            {
                name(key.inner_span(self), owner);
            }
        };
        let attributes = |attributes: Option<ImportAttributes<'a>>, owner: Node<'a>, name: &mut dyn FnMut(Span, Node<'a>)| {
            for entry in attributes.into_iter().flat_map(|it| it.entries()) {
                key(entry.key(), owner, name);
            }
        };
        self.every_stmt_of(
            &[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar, StmtTag::ImportEquals, StmtTag::Module],
            |stmt| {
                let owner = Node::Stmt(stmt);
                match stmt.kind() {
                    StmtKind::ExportStar { alias: Some(alias), .. } => name(alias.span(), owner),
                    StmtKind::Module(module) => name(module.name_span(), owner),
                    _ => {}
                }
                if let Some(specifier) = stmt.module_specifier_span() {
                    name(specifier, owner);
                }
                attributes(stmt.import_attributes(), owner, &mut name);
            },
        );
        self.every_type_of(&[TypeTag::Import], |ty| {
            if let Some(source) = ty.import_source_span() {
                name(source, Node::Type(ty));
            }
            attributes(ty.import_attributes(), Node::Type(ty), &mut name);
        });
        self.every_prop(|it| key(it.key(), Node::Prop(it), &mut name));
        self.every_member(|it| match it.constructor_keyword() {
            Some(constructor) => name(constructor.span(), Node::Member(it)),
            None => key(it.key(), Node::Member(it), &mut name),
        });
        self.every_enum_member(|it| key(it.key(), Node::EnumMember(it), &mut name));
        if !self.pats_of(PatTag::Object).is_empty() {
            self.every_pat_prop(|it| key(it.key(), Node::PatProp(it), &mut name));
        }
        self.every_import_spec(|it| name(it.imported().span(), Node::ImportSpec(it)));
        self.every_export_spec(|it| {
            name(it.local().span(), Node::ExportSpec(it));
            if it.is_renamed() {
                name(it.exported().span(), Node::ExportSpec(it));
            }
        });
        self.every_type_of(&[TypeTag::StringLit], |ty| name(ty.span(), Node::Type(ty)));
        self.every_expr_of(&[ExprTag::String], |e| {
            if !e.is_jsx_text() && !e.is_jsx_tag_name() {
                name(e.span(), Node::Expr(e));
            }
        });
    }

    pub(crate) fn every_number_literal(&'a self, mut visit: impl FnMut(Literal<'a>)) {
        let mut key = |key: Option<Key<'a>>, owner: Node<'a>| {
            if let Some(key) = key
                && matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
            {
                visit(Literal { span: key.inner_span(self), owner });
            }
        };
        self.every_prop(|it| key(it.key(), Node::Prop(it)));
        self.every_member(|it| key(it.key(), Node::Member(it)));
        self.every_enum_member(|it| key(it.key(), Node::EnumMember(it)));
        if !self.pats_of(PatTag::Object).is_empty() {
            self.every_pat_prop(|it| key(it.key(), Node::PatProp(it)));
        }
        self.every_type_of(&[TypeTag::NumberLit, TypeTag::BigIntLit], |ty| {
            // `-1` is a `UnaryExpression` there.
            let span = match ty.text().starts_with(b"-") {
                true => Span::new(skip_trivia(self.text(), ty.span().start + 1), ty.span().end),
                false => ty.span(),
            };
            visit(Literal { span, owner: Node::Type(ty) });
        });
        self.every_expr_of(&[ExprTag::Number, ExprTag::BigInt], |e| visit(Literal { span: e.span(), owner: Node::Expr(e) }));
    }
}
