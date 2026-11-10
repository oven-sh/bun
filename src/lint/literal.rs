//! Finds every ESTree `Literal` that's a string or a number, wherever it appears.

use crate::ast::{
    ExprTag, File, Handle, ImportAttributes, Key, KeyKind, Node, PatTag, StmtKind, StmtTag, TypeTag,
};
use crate::span::{Span, Spanned};
use crate::tokens::skip_trivia;
use bun_sema::hir::{Flags, NameKind};

/// A quoted string or a number. ESLint calls `Literal` listeners with these.
///
/// Only some of them are expressions in our tree. The others are part of the node that owns them.
#[derive(Copy, Clone)]
pub struct Literal<'a> {
    span: Span,
    owner: Node<'a>,
}

impl<'a> Literal<'a> {
    /// The literal itself, if it's an expression or a type. Otherwise the node it's part of:
    /// - the [`Prop`](crate::ast::Prop), [`Member`](crate::ast::Member), [`PatProp`](crate::ast::PatProp) or
    ///   [`EnumMember`](crate::ast::EnumMember) that it is the key of, with or without brackets,
    /// - the [`ImportSpec`](crate::ast::ImportSpec) or [`ExportSpec`](crate::ast::ExportSpec) that it is a name of,
    /// - the statement that it is the module specifier of, the `"a"` in `export * as "a"` or `declare module "a"`, or a
    ///   key in `with { "a": "b" }`,
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

/// A [`Literal`] without the reference to the file.
#[derive(Copy, Clone)]
pub(crate) struct RawLiteral {
    span: Span,
    owner: u32,
    sort: Sort,
}

/// The HIR vector that a literal's owner is in.
#[derive(Copy, Clone)]
enum Sort {
    Expr,
    Stmt,
    Type,
    Prop,
    Member,
    EnumMember,
    PatProp,
    ImportSpec,
    ExportSpec,
}

impl RawLiteral {
    fn of(literal: Literal) -> Option<RawLiteral> {
        let (sort, owner) = match literal.owner {
            Node::Expr(it) => (Sort::Expr, it.id().0),
            Node::Stmt(it) => (Sort::Stmt, it.id().0),
            Node::Type(it) => (Sort::Type, it.id().0),
            Node::Prop(it) => (Sort::Prop, it.id().0),
            Node::Member(it) => (Sort::Member, it.id().0),
            Node::EnumMember(it) => (Sort::EnumMember, it.id().0),
            Node::PatProp(it) => (Sort::PatProp, it.id().0),
            Node::ImportSpec(it) => (Sort::ImportSpec, it.id().0),
            Node::ExportSpec(it) => (Sort::ExportSpec, it.id().0),
            _ => return None,
        };
        Some(RawLiteral {
            span: literal.span,
            owner,
            sort,
        })
    }

    #[inline]
    fn literal<'a>(self, file: &'a File<'a>) -> Literal<'a> {
        let owner = match self.sort {
            Sort::Expr => Node::Expr(Handle::from_raw(file, self.owner)),
            Sort::Stmt => Node::Stmt(Handle::from_raw(file, self.owner)),
            Sort::Type => Node::Type(Handle::from_raw(file, self.owner)),
            Sort::Prop => Node::Prop(Handle::from_raw(file, self.owner)),
            Sort::Member => Node::Member(Handle::from_raw(file, self.owner)),
            Sort::EnumMember => Node::EnumMember(Handle::from_raw(file, self.owner)),
            Sort::PatProp => Node::PatProp(Handle::from_raw(file, self.owner)),
            Sort::ImportSpec => Node::ImportSpec(Handle::from_raw(file, self.owner)),
            Sort::ExportSpec => Node::ExportSpec(Handle::from_raw(file, self.owner)),
        };
        Literal {
            span: self.span,
            owner,
        }
    }
}

// Almost every key is a plain identifier. These helpers rule that out from the raw HIR, before a `Key` is built.
impl File<'_> {
    #[inline]
    fn is_quote_at(&self, pos: u32) -> bool {
        matches!(self.text().get(pos as usize), Some(b'"' | b'\''))
    }

    #[inline]
    fn is_digit_at(&self, pos: u32) -> bool {
        (self.text().get(pos as usize)).is_some_and(u8::is_ascii_digit)
    }

    /// True if a key of kind `key_kind` at `pos` can be a `KeyKind::String` or a `KeyKind::ComputedString`.
    #[inline]
    fn can_be_string_key(&self, key_kind: NameKind, pos: u32) -> bool {
        match key_kind {
            NameKind::StringLiteral | NameKind::ComputedString => true,
            NameKind::Identifier => self.is_quote_at(pos),
            NameKind::NumericLiteral | NameKind::ComputedNumber | NameKind::Jsx => false,
        }
    }

    /// The same for `KeyKind::Number` and `KeyKind::ComputedNumber`. The HIR has no kind for a `bigint` key, so this
    /// also checks for a digit.
    #[inline]
    fn can_be_number_key(&self, key_kind: NameKind, pos: u32) -> bool {
        matches!(
            key_kind,
            NameKind::NumericLiteral | NameKind::ComputedNumber
        ) || self.is_digit_at(pos)
    }
}

impl<'a> File<'a> {
    /// Computed once and shared by all rules.
    #[inline(never)]
    fn string_literals(&'a self) -> &'a [RawLiteral] {
        self.by_kind().string_literals.get_or_init(|| {
            let mut all = Vec::new();
            self.find_string_literals(|literal| all.extend(RawLiteral::of(literal)));
            all
        })
    }

    #[inline]
    pub(crate) fn every_string_literal(&'a self, mut visit: impl FnMut(Literal<'a>)) {
        for raw in self.string_literals() {
            visit(raw.literal(self));
        }
    }

    /// The same for numbers.
    #[inline(never)]
    fn number_literals(&'a self) -> &'a [RawLiteral] {
        self.by_kind().number_literals.get_or_init(|| {
            let mut all = Vec::new();
            self.find_number_literals(|literal| all.extend(RawLiteral::of(literal)));
            all
        })
    }

    #[inline]
    pub(crate) fn every_number_literal(&'a self, mut visit: impl FnMut(Literal<'a>)) {
        for raw in self.number_literals() {
            visit(raw.literal(self));
        }
    }

    fn find_string_literals(&'a self, mut visit: impl FnMut(Literal<'a>)) {
        let hir = &self.hir;
        // Visits a name that may be either an identifier or a string.
        let mut name = |span: Span, owner: Node<'a>| {
            if self.is_quote_at(span.start) {
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
        // Only for assertions: true for the keys that `key` and `name` together would visit.
        let is_string = |key: Option<Key<'a>>| {
            key.is_some_and(|key| {
                matches!(key.kind(), KeyKind::String(_) | KeyKind::ComputedString(_))
                    && self.is_quote_at(key.inner_span(self).start)
            })
        };
        let attributes = |attributes: Option<ImportAttributes<'a>>,
                          owner: Node<'a>,
                          name: &mut dyn FnMut(Span, Node<'a>)| {
            for entry in attributes.into_iter().flat_map(|it| it.entries()) {
                key(entry.key(), owner, name);
            }
        };
        self.every_stmt_of(
            &[
                StmtTag::Import,
                StmtTag::ExportNamed,
                StmtTag::ExportStar,
                StmtTag::ImportEquals,
                StmtTag::Module,
            ],
            |stmt| {
                let owner = Node::Stmt(stmt);
                match stmt.kind() {
                    StmtKind::ExportStar {
                        alias: Some(alias), ..
                    } => name(alias.span(), owner),
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
        self.every_prop(|it| {
            if (hir.props.get(it.id().idx()))
                .is_some_and(|raw| self.can_be_string_key(raw.name_kind, raw.pos))
            {
                key(it.key(), Node::Prop(it), &mut name);
            } else {
                debug_assert!(!is_string(it.key()));
            }
        });
        self.every_member(|it| {
            let can_be_string = hir.members.get(it.id().idx()).is_some_and(|raw| {
                raw.flags.contains(Flags::STRING_NAME) || self.is_quote_at(raw.name_pos)
            });
            if !can_be_string {
                debug_assert!(match it.constructor_keyword() {
                    Some(constructor) => !self.is_quote_at(constructor.span().start),
                    None => !is_string(it.key()),
                });
                return;
            }
            match it.constructor_keyword() {
                Some(constructor) => name(constructor.span(), Node::Member(it)),
                None => key(it.key(), Node::Member(it), &mut name),
            }
        });
        self.every_enum_member(|it| {
            if (hir.enum_members.get(it.id().idx()))
                .is_some_and(|raw| self.can_be_string_key(raw.name_kind, raw.pos))
            {
                key(it.key(), Node::EnumMember(it), &mut name);
            } else {
                debug_assert!(!is_string(it.key()));
            }
        });
        if !self.pats_of(PatTag::Object).is_empty() {
            self.every_pat_prop(|it| {
                if (hir.pat_props.get(it.id().idx()))
                    .is_some_and(|raw| self.can_be_string_key(raw.name_kind, raw.key_pos))
                {
                    key(it.key(), Node::PatProp(it), &mut name);
                } else {
                    debug_assert!(!is_string(it.key()));
                }
            });
        }
        self.every_import_spec(|it| {
            if it.imported().is_string() {
                name(it.imported().span(), Node::ImportSpec(it));
            } else {
                debug_assert!(!self.is_quote_at(it.imported().span().start));
            }
        });
        self.every_export_spec(|it| {
            // ESLint has two nodes even if the name is written once: `export { "a" } from "b"`.
            for specifier_name in [it.local(), it.exported()] {
                if specifier_name.is_string() {
                    name(specifier_name.span(), Node::ExportSpec(it));
                } else {
                    debug_assert!(!self.is_quote_at(specifier_name.span().start));
                }
            }
        });
        self.every_type_of(&[TypeTag::StringLit], |ty| name(ty.span(), Node::Type(ty)));
        self.every_expr_of(&[ExprTag::String], |e| {
            if !e.is_jsx_text() && !e.is_jsx_tag_name() {
                name(e.span(), Node::Expr(e));
            }
        });
    }

    fn find_number_literals(&'a self, mut visit: impl FnMut(Literal<'a>)) {
        let hir = &self.hir;
        // Only for assertions.
        let is_number = |key: Option<Key<'a>>| {
            key.is_some_and(|key| {
                matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
            })
        };
        let mut key = |key: Option<Key<'a>>, owner: Node<'a>| {
            if let Some(key) = key
                && matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
            {
                visit(Literal {
                    span: key.inner_span(self),
                    owner,
                });
            }
        };
        self.every_prop(|it| {
            if (hir.props.get(it.id().idx()))
                .is_some_and(|raw| self.can_be_number_key(raw.name_kind, raw.pos))
            {
                key(it.key(), Node::Prop(it));
            } else {
                debug_assert!(!is_number(it.key()));
            }
        });
        self.every_member(|it| {
            if hir.members.get(it.id().idx()).is_some_and(|raw| {
                raw.flags
                    .intersects(Flags::COMPUTED_NAME | Flags::LITERAL_NAME)
                    || self.is_digit_at(raw.name_pos)
            }) {
                key(it.key(), Node::Member(it));
            } else {
                debug_assert!(!is_number(it.key()));
            }
        });
        self.every_enum_member(|it| {
            if (hir.enum_members.get(it.id().idx()))
                .is_some_and(|raw| self.can_be_number_key(raw.name_kind, raw.pos))
            {
                key(it.key(), Node::EnumMember(it));
            } else {
                debug_assert!(!is_number(it.key()));
            }
        });
        if !self.pats_of(PatTag::Object).is_empty() {
            self.every_pat_prop(|it| {
                if (hir.pat_props.get(it.id().idx()))
                    .is_some_and(|raw| self.can_be_number_key(raw.name_kind, raw.key_pos))
                {
                    key(it.key(), Node::PatProp(it));
                } else {
                    debug_assert!(!is_number(it.key()));
                }
            });
        }
        self.every_type_of(&[TypeTag::NumberLit, TypeTag::BigIntLit], |ty| {
            // In ESTree `-1` is a `UnaryExpression`.
            let span = match ty.text().starts_with(b"-") {
                true => Span::new(skip_trivia(self.text(), ty.span().start + 1), ty.span().end),
                false => ty.span(),
            };
            visit(Literal {
                span,
                owner: Node::Type(ty),
            });
        });
        self.every_expr_of(&[ExprTag::Number, ExprTag::BigInt], |e| {
            visit(Literal {
                span: e.span(),
                owner: Node::Expr(e),
            })
        });
    }
}
