//! Related information: where the other things an error is about are. `'x' is declared here.`

use super::Checker;
use super::explain::{Related, end_of_token};
use crate::bind::{Decl, SymFlags};
use crate::program::{FileId, Sym};
use crate::types::{Prop, PropSource};

/// A file, and from where to where in it.
pub(super) type Place = (FileId, u32, u32);

impl Checker<'_> {
    /// From `start` in `file` to the end of the name, number or string that starts there.
    pub(super) fn place_of_token(&self, file: FileId, start: u32) -> Place {
        (file, start, end_of_token(&self.hir(file).text, start))
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
            PropSource::Type(_) | PropSource::Intersected(..) | PropSource::Mapped(..) => None,
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
