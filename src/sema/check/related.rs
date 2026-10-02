//! Related information: where the other things an error is about are. `'x' is declared here.`

use super::Checker;
use super::explain::Related;
use crate::bind::{Decl, SymFlags};
use crate::program::{FileId, Sym};
use crate::types::{Prop, PropSource};

/// A file, and from where to where in it.
pub(super) type Place = (FileId, u32, u32);

impl Checker<'_> {
    /// From `start` in `file` to the end of the name, number or string that starts there.
    pub(super) fn place_of_token(&self, file: FileId, start: u32) -> Place {
        (file, start, self.end_of_token_at(file, start))
    }

    /// `getErrorRangeForNode` of a declaration: its name, or where it starts if it has none.
    pub(super) fn place_of_declaration(&self, file: FileId, decl: Decl) -> Option<Place> {
        let start = self.declaration_name_start(file, decl)?;
        Some(self.place_of_token(file, start))
    }

    /// `symbol.ValueDeclaration`, or else the first declaration there is.
    pub(super) fn place_of_symbol(&self, sym: Sym) -> Option<Place> {
        let decls = self.files().decls_of(sym);
        let is_value = |decl: Decl| {
            !matches!(
                decl,
                Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_) | Decl::File
            )
        };
        let has_value = self.files().flags(sym).intersects(SymFlags::VALUE);
        let (file, decl) = decls
            .iter()
            .find(|d| has_value && is_value(d.1))
            .or_else(|| decls.iter().next())
            .copied()?;
        self.place_of_declaration(file, decl)
    }

    /// `prop.ValueDeclaration`: the name where the property is declared. `None`: it is made up.
    pub(super) fn place_of_prop(&self, prop: &Prop) -> Option<Place> {
        match Self::value_declaration(prop)? {
            PropSource::Members(members) => {
                let &(file, member) = members.first()?;
                Some(self.place_of_token(file, self.hir(file)[member].pos))
            }
            &PropSource::Parameter(file, param) => {
                let hir = self.hir(file);
                Some(self.place_of_token(file, hir[hir[param].pat].pos))
            }
            &PropSource::Literal(file, prop) => {
                Some(self.place_of_token(file, self.hir(file)[prop].pos))
            }
            &PropSource::Symbol(sym) => self.place_of_symbol(sym),
            PropSource::Assigned(file, assignments) => {
                let &first = assignments.first()?;
                Some(self.place_of_token(*file, self.hir(*file)[first].pos))
            }
            PropSource::Type(_)
            | PropSource::Intersected(..)
            | PropSource::Mapped(..)
            | PropSource::Copy(..) => None,
        }
    }

    /// `prop.Declarations[0]`, where `GetErrorRangeForNode` points at it. `None`: nothing declares it.
    pub(super) fn place_of_first_prop_declaration(&mut self, prop: &Prop) -> Option<Place> {
        self.place_of_first_prop_declaration_within(prop, 0)
    }

    fn place_of_first_prop_declaration_within(&mut self, prop: &Prop, depth: u32) -> Option<Place> {
        use crate::hir::PropKind;
        if depth > 8 {
            return None;
        }
        // The text of the default library and of JSON is not kept: there is nothing to tell an end by.
        let has_text = |c: &Self, file: FileId| !c.hir(file).text.is_empty();
        match &prop.source {
            PropSource::Members(members) => {
                let &(file, member) = members.first()?;
                if !has_text(self, file) {
                    return Some(self.place_of_token(file, self.hir(file)[member].pos));
                }
                let (start, end) = self.error_range_of_member(file, member);
                Some((file, start, end))
            }
            &PropSource::Parameter(file, param) => Some((
                file,
                self.hir(file)[param].pos,
                self.end_of_param(file, param),
            )),
            &PropSource::Literal(file, written) => {
                let start = self.hir(file)[written].pos;
                if !has_text(self, file) {
                    return Some(self.place_of_token(file, start));
                }
                let end = match self.hir(file)[written].kind {
                    PropKind::Method | PropKind::Getter | PropKind::Setter => {
                        self.end_of_prop_name(file, written)
                    }
                    _ => self.end_of_prop(file, written),
                };
                Some((file, start, end))
            }
            &PropSource::Symbol(sym) => {
                let (file, decl) = self.files().decls_of(sym).first().copied()?;
                self.place_of_declaration(file, decl)
            }
            PropSource::Assigned(file, assignments) => {
                let &first = assignments.first()?;
                Some((
                    *file,
                    self.start_inside_parentheses(*file, first),
                    self.end_inside_parentheses(*file, first),
                ))
            }
            // `createUnionOrIntersectionProperty`: the declarations of all of them, one after the other.
            PropSource::Intersected(_, parts) | PropSource::Copy(_, parts, _) => parts
                .iter()
                .find_map(|part| self.place_of_first_prop_declaration_within(part, depth + 1)),
            // `resolveMappedTypeMembers`: those of the property the modifiers come from.
            PropSource::Mapped(..) => prop
                .declared_by_modifiers_property()
                .iter()
                .find_map(|part| self.place_of_first_prop_declaration_within(part, depth + 1)),
            PropSource::Type(_) => None,
        }
    }

    /// `'{0}' is declared here.`
    pub(super) fn declared_here(&self, at: Place, name: String) -> Related {
        Related {
            at: Some(at),
            code: 2728,
            args: vec![name],
        }
    }
}
