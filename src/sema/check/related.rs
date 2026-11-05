//! Related information: spans of the other entities an error refers to, like
//! `'x' is declared here.`

use super::Checker;
use super::sink::Reported;
use super::sink::held;
use crate::bind::Decl;
use crate::program::{FileId, Sym};
use crate::types::{Prop, PropSource};

/// A file and a span in it.
pub(super) type FileSpan = (FileId, u32, u32);

impl Checker<'_, '_> {
    /// Spans the name, number or string token that starts at `start` in `file`.
    pub(super) fn span_of_token(&self, file: FileId, start: u32) -> FileSpan {
        (file, start, self.end_of_token_at(file, start))
    }

    /// `GetErrorRangeForNode` of a declaration.
    pub(super) fn error_span_of_declaration(&self, file: FileId, decl: Decl) -> Option<FileSpan> {
        match self.error_range_of_declaration(file, decl) {
            Some((start, end)) => Some((file, start, end)),
            None => self.span_of_declaration(file, decl),
        }
    }

    /// `GetNameOfDeclaration(decl) ?? decl`: the declaration's name, or its start if it's unnamed.
    pub(super) fn span_of_declaration(&self, file: FileId, decl: Decl) -> Option<FileSpan> {
        let start = self.declaration_name_start(file, decl)?;
        if let Decl::Member(_) | Decl::Property(_) | Decl::EnumMember(_) = decl {
            return Some((file, start, self.end_of_name_at(file, start).max(start)));
        }
        Some(self.span_of_token(file, start))
    }

    /// `symbol.ValueDeclaration`, falling back to the first declaration.
    pub(super) fn span_of_symbol(&self, sym: Sym) -> Option<FileSpan> {
        let files = self.files();
        let value_declaration = files.value_declaration(files.canonical(sym));
        let (file, decl) = value_declaration.or_else(|| files.decls_of(sym).first().copied())?;
        self.span_of_declaration(file, decl)
    }

    /// The property's name at `prop.ValueDeclaration`. `None` for a synthesized property.
    pub(super) fn span_of_prop(&self, prop: &Prop) -> Option<FileSpan> {
        match Self::value_declaration(prop)? {
            &PropSource::Literal(file, prop) => {
                Some(self.span_of_token(file, self.hir(file)[prop].pos))
            }
            &PropSource::Symbol(sym) => match self.files().value_declaration(sym) {
                Some((file, Decl::Expando(first) | Decl::ThisProperty(first))) => {
                    Some(self.span_of_token(file, self.hir(file)[first].pos))
                }
                _ => self.span_of_symbol(sym),
            },
            PropSource::Type(_)
            | PropSource::Intersected(..)
            | PropSource::Mapped(..)
            | PropSource::Copy(..)
            | PropSource::ReverseMapped(..) => None,
        }
    }

    /// The `GetErrorRangeForNode` span of `prop.Declarations[0]`. `None` if it has no declaration.
    pub(super) fn span_of_first_prop_declaration(&mut self, prop: &Prop) -> Option<FileSpan> {
        self.span_of_first_prop_declaration_within(prop, 0)
    }

    fn span_of_first_prop_declaration_within(
        &mut self,
        prop: &Prop,
        depth: u32,
    ) -> Option<FileSpan> {
        if depth > 8 {
            return None;
        }
        let error_span =
            |c: &Self, file: FileId, decl: Decl| c.error_span_of_declaration(file, decl);
        match &prop.source {
            &PropSource::Literal(file, literal_prop) => {
                error_span(self, file, Decl::Property(literal_prop))
            }
            &PropSource::Symbol(sym) => {
                let (file, decl) = self.files().decls_of(sym).first().copied()?;
                error_span(self, file, decl)
            }
            // `createUnionOrIntersectionProperty` concatenates the declarations of all the parts.
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts) => parts
                .iter()
                .find_map(|part| self.span_of_first_prop_declaration_within(part, depth + 1)),
            // `resolveMappedTypeMembers` uses the declarations of the property the modifiers come
            // from.
            PropSource::Mapped(..) => prop
                .declared_by_modifiers_property()
                .iter()
                .find_map(|part| self.span_of_first_prop_declaration_within(part, depth + 1)),
            PropSource::Type(_) => None,
        }
    }

    /// `'{0}' is declared here.`
    pub(super) fn declared_here(&self, at: FileSpan, name: Vec<u8>) -> Reported {
        Reported::new(at, 2728, held(vec![name]))
    }
}
