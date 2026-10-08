//! A file of Flow. Its HIR has the nodes of TypeScript: `flow.rs` of `bun_sema_parser` says which
//! stand for what. This tells them apart, from the nodes and from the tokens at the positions that
//! they record.
//!
//! Everything here is only meaningful if [`File::is_flow`].

use super::{
    Class, Enum, Expr, File, Flags, Ident, Interface, List, Member, Modifier, Param, TupleElem,
    TypeNode, TypeParam,
};
use crate::span::Span;
use crate::tokens::{next_token, token_len};
use bun_sema::hir;

impl File<'_> {
    /// The file is parsed as Flow.
    #[inline]
    pub fn is_flow(&self) -> bool {
        self.is_flow
    }

    /// The token that starts at `start`.
    fn flow_token_span_at(&self, start: u32) -> Span {
        let rest = self.text().get(start as usize..).unwrap_or_default();
        Span::new(start, start + token_len(rest) as u32)
    }
}

impl Expr<'_> {
    /// `(e: T)`
    #[inline]
    pub fn is_flow_type_cast(self) -> bool {
        self.file.is_flow && self.is_angle_bracket_assertion()
    }
}

impl Modifier<'_> {
    /// The keyword or the sign as it is written: `static`, `proto`, `+`, `opaque`.
    pub fn token_span(self) -> Span {
        self.file.flow_token_span_at(self.try_raw().map_or(0, |raw| raw.pos))
    }
}

impl<'a> TypeNode<'a> {
    /// The `T` of `?T`.
    pub fn flow_nullable_operand(self) -> Option<TypeNode<'a>> {
        match self.try_raw()?.kind {
            hir::TypeNodeKind::JSDoc {
                ty,
                kind: hir::JSDocTypeKind::Nullable,
                is_postfix: false,
            } => TypeNode::some(self.file, ty),
            _ => None,
        }
    }

    /// The `T` of `renders T`.
    pub fn flow_type_operator_operand(self) -> Option<TypeNode<'a>> {
        match self.try_raw()?.kind {
            hir::TypeNodeKind::Unique(ty) => TypeNode::some(self.file, ty),
            _ => None,
        }
    }

    /// The first token of the type.
    pub fn first_token(self) -> &'a [u8] {
        self.file.slice(self.file.flow_token_span_at(self.span().start))
    }

    /// `{| |}`
    pub fn is_flow_exact_object(self) -> bool {
        self.text().starts_with(b"{|")
    }

    /// `obj?.[index]`, for an `IndexedAccess` of `obj`.
    pub fn has_flow_optional_token(self, obj: TypeNode<'a>) -> bool {
        self.file.slice(next_token(self.file.text(), obj.outer_span().end)) == b"?."
    }
}

impl<'a> TypeParam<'a> {
    /// `const`, and the variance: `+`, `-`, `in`, `out`.
    pub fn modifiers(self) -> List<'a, Modifier<'a>> {
        List::run(self.file, self.try_raw().map_or(hir::Span::EMPTY, |raw| raw.modifiers))
    }

    /// `T: Bound`, as opposed to `T extends Bound`.
    pub fn has_flow_colon(self) -> bool {
        self.file.slice(next_token(self.file.text(), self.name().span().end)) == b":"
    }
}

impl<'a> TupleElem<'a> {
    /// The `+`, `-`, `readonly` or `writeonly` of `[+a: T]`, and the `a`.
    pub fn flow_variance_and_label(self) -> (Option<Span>, Option<Ident<'a>>) {
        let Some(raw) = self.try_raw() else {
            return (None, None);
        };
        if raw.name.is_none() {
            return (None, None);
        }
        let text = self.file.text();
        let first = self.file.flow_token_span_at(raw.start);
        // The label is followed by the `?` or the `:`.
        let after = self.file.slice(next_token(text, first.end));
        if raw.has_dots || after == b":" || after == b"?" {
            let start = if raw.has_dots { next_token(text, first.end).start } else { first.start };
            return (None, Some(self.file.ident(raw.name, start)));
        }
        (Some(first), Some(self.file.ident(raw.name, next_token(text, first.end).start)))
    }

    /// The `T`. `None` for the `...` that ends an inexact tuple.
    pub fn flow_type(self) -> Option<TypeNode<'a>> {
        TypeNode::some(self.file, self.try_raw()?.written)
    }
}

impl<'a> Param<'a> {
    /// In a component: the `a` of `a as b`, the `'a'` of `'a' as b` and of `'a': T`.
    pub fn flow_outer_name(self) -> Option<Span> {
        let raw = self.try_raw()?;
        let inner = match self.file.hir.pats.get(raw.pat.idx()) {
            Some(pat) => pat.pos,
            None => self.ty()?.outer_span().start,
        };
        (!self.is_rest() && raw.pos < inner).then(|| self.file.flow_token_span_at(raw.pos))
    }
}

impl<'a> Member<'a> {
    /// The `a` of `[[a]]: T`.
    pub fn flow_internal_slot(self) -> Option<Ident<'a>> {
        let raw = self.try_raw()?;
        match raw.key {
            hir::PropKey::Name(name) if raw.flags.contains(Flags::COMPUTED_NAME) => {
                Some(self.file.ident(name, raw.name_pos))
            }
            _ => None,
        }
    }

    /// `...T`, or the `...` that ends an inexact object type.
    pub fn is_flow_spread(self) -> bool {
        self.try_raw().is_some_and(|raw| raw.flags.contains(Flags::REST))
    }
}

impl<'a> Interface<'a> {
    /// Of `opaque type A: B = C`: the `C`. The bounds are [`Interface::extends`].
    pub fn flow_opaque_type(self) -> Option<TypeNode<'a>> {
        let file = self.stmt().file();
        List::ids(file, file.hir.interfaces.get(self.id().idx())?.other_heritage).first()
    }
}

impl<'a> Class<'a> {
    /// Of `declare class A mixins B, C`: `B` and `C`.
    pub fn flow_mixins(self) -> List<'a, TypeNode<'a>> {
        let list = self.try_raw().map_or(hir::IdList::EMPTY, |raw| raw.other_implements);
        List::ids(self.file, list)
    }
}

impl Enum<'_> {
    /// The `string` of `enum A of string {}`.
    pub fn flow_explicit_type(self) -> Option<Span> {
        let file = self.stmt().file();
        let of = next_token(file.text(), self.name().span().end);
        (file.slice(of) == b"of").then(|| next_token(file.text(), of.end))
    }
}
