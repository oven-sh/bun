//! Related information: the spans of the other entities an error refers to. `'x' is declared here.`

use super::Checker;
use super::sink::Reported;
use super::sink::held;
use crate::bind::Decl;
use crate::program::{FileId, Sym};
use crate::types::{Prop, PropSource};

/// A file and a span in it.
pub(super) type Place = (FileId, u32, u32);

impl Checker<'_> {
    /// From `start` in `file` to the end of the name, number or string that starts there.
    pub(super) fn place_of_token(&self, file: FileId, start: u32) -> Place {
        (file, start, self.end_of_token_at(file, start))
    }

    /// `getErrorRangeForNode` of a declaration: its name, or its start if it has none.
    pub(super) fn place_of_declaration(&self, file: FileId, decl: Decl) -> Option<Place> {
        let start = self.declaration_name_start(file, decl)?;
        if let Decl::Member(_) | Decl::Property(_) = decl {
            return Some((file, start, self.end_of_name_at(file, start).max(start)));
        }
        Some(self.place_of_token(file, start))
    }

    /// `symbol.ValueDeclaration`, or else the first declaration.
    pub(super) fn place_of_symbol(&self, sym: Sym) -> Option<Place> {
        let files = self.files();
        let value_declaration = files.value_declaration(files.canonical(sym));
        let (file, decl) = value_declaration.or_else(|| files.decls_of(sym).first().copied())?;
        self.place_of_declaration(file, decl)
    }

    /// `prop.ValueDeclaration`: the name where the property is declared. `None`: it is synthesized.
    pub(super) fn place_of_prop(&self, prop: &Prop) -> Option<Place> {
        match Self::value_declaration(prop)? {
            &PropSource::Literal(file, prop) => {
                Some(self.place_of_token(file, self.hir(file)[prop].pos))
            }
            &PropSource::Symbol(sym) => match self.files().value_declaration(sym) {
                Some((file, Decl::Expando(first) | Decl::ThisProperty(first))) => {
                    Some(self.place_of_token(file, self.hir(file)[first].pos))
                }
                _ => self.place_of_symbol(sym),
            },
            PropSource::Type(_)
            | PropSource::Intersected(..)
            | PropSource::Mapped(..)
            | PropSource::Copy(..)
            | PropSource::ReverseMapped(..) => None,
        }
    }

    /// The `GetErrorRangeForNode` span of `prop.Declarations[0]`. `None`: it has no declaration.
    pub(super) fn place_of_first_prop_declaration(&mut self, prop: &Prop) -> Option<Place> {
        self.place_of_first_prop_declaration_within(prop, 0)
    }

    fn place_of_first_prop_declaration_within(&mut self, prop: &Prop, depth: u32) -> Option<Place> {
        if depth > 8 {
            return None;
        }
        let of_declaration =
            |c: &Self, file: FileId, decl: Decl| match c.error_range_of_declaration(file, decl) {
                Some((start, end)) => Some((file, start, end)),
                None => c.place_of_declaration(file, decl),
            };
        match &prop.source {
            &PropSource::Literal(file, written) => {
                of_declaration(self, file, Decl::Property(written))
            }
            &PropSource::Symbol(sym) => {
                let (file, decl) = self.files().decls_of(sym).first().copied()?;
                of_declaration(self, file, decl)
            }
            // `createUnionOrIntersectionProperty`: the declarations of all of them, concatenated.
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts) => parts
                .iter()
                .find_map(|part| self.place_of_first_prop_declaration_within(part, depth + 1)),
            // `resolveMappedTypeMembers`: the declarations of the property that the modifiers come
            // from.
            PropSource::Mapped(..) => prop
                .declared_by_modifiers_property()
                .iter()
                .find_map(|part| self.place_of_first_prop_declaration_within(part, depth + 1)),
            PropSource::Type(_) => None,
        }
    }

    /// `'{0}' is declared here.`
    pub(super) fn declared_here(&self, at: Place, name: Vec<u8>) -> Reported {
        Reported::new(at, 2728, held(vec![name]))
    }
}
