//! Where what is expected of a part of an expression comes from: the related information `elaborateError` adds to its errors.

use super::errors::Diagnostic;
use super::explain::Related;
use super::related::Place;
use super::*;
use crate::bind::{Decl, FnOwner};

impl Checker<'_> {
    /// The end of `elaborateElement`, for who has noted the error. `said`: the error about the property or the element `name` of what
    /// is held against `target`.
    pub(super) fn relate_expected_property(
        &mut self,
        said: Option<Diagnostic>,
        target: TypeId,
        name: Atom,
    ) {
        let Some(said) = said else {
            return;
        };
        self.relate(said.start, said.code, |c| {
            c.expected_property(target, name).into_iter().collect()
        });
    }

    /// The end of `elaborateElement`: the related information of the error about the property or the element `name` of what is held
    /// against `target`.
    pub(super) fn expected_property(&mut self, target: TypeId, name: Atom) -> Option<Related> {
        // What is compared on the way says nothing about the comparison that is being reported.
        let (gave_up, too_complex) = (self.relation_gave_up, self.relation_too_complex);
        let related = self.where_expected_property_comes_from(target, name);
        self.relation_gave_up = gave_up;
        self.relation_too_complex = too_complex;
        related
    }

    /// 6501 at the index signature of `target` that stands in for `name`, or 6500 at what declares the property, or else `target`.
    /// Nothing in the default library is pointed at.
    fn where_expected_property_comes_from(
        &mut self,
        target: TypeId,
        name: Atom,
    ) -> Option<Related> {
        let property = self.first_declaration_of_property(target, name, 0);
        if property.is_none()
            && let Some(signature) = self.declaration_of_applicable_index_signature(target, name)
            && !self.files().module(signature.0).is_lib
        {
            return Some(Related {
                at: Some(signature),
                code: 6501,
                args: Vec::new(),
            });
        }
        let place = match property.flatten() {
            Some(place) => place,
            None => self.first_declaration_of_type_symbol(target)?,
        };
        if self.files().module(place.0).is_lib {
            return None;
        }
        let property_name = if self.files().atoms.is_symbol_name(name) {
            let key = self.key_type_of_name(name)?;
            self.type_to_string(key)
        } else {
            self.atom_text(name)
        };
        let on_type = self.type_to_string(target);
        Some(Related {
            at: Some(place),
            code: 6500,
            args: vec![property_name, on_type],
        })
    }

    /// What starts at `start` in `file`, from where to where `range` says. The text of the default library is not kept, so there
    /// is no telling where anything ends in it.
    fn place_in_file(
        &self,
        file: FileId,
        start: u32,
        range: impl FnOnce(&Self) -> (u32, u32),
    ) -> Place {
        if self.files().module(file).is_lib {
            return (file, start, start);
        }
        let (start, end) = range(self);
        (file, start, end)
    }

    /// `getReducedApparentType`
    fn apparent_type_reduced(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced(ty);
        let ty = self.apparent_type(ty);
        self.reduced(ty)
    }

    /// `GetErrorRangeForNode` of `getPropertyOfType(ty, name).Declarations[0]`. `None`: there is no such property. `Some(None)`:
    /// nothing declares it.
    fn first_declaration_of_property(
        &mut self,
        ty: TypeId,
        name: Atom,
        depth: u32,
    ) -> Option<Option<Place>> {
        if depth > 8 {
            return None;
        }
        let ty = self.apparent_type_reduced(ty);
        if self.is_union(ty) {
            // `createUnionOrIntersectionProperty`: the declarations of what the members have, one member after the other.
            let is_late_bound = self.files().atoms.is_symbol_name(name);
            let mut found: Option<Option<Place>> = None;
            for &part in self.parts(ty) {
                let part = self.apparent_type(part);
                if part.is_never() || !self.is_known(part) {
                    continue;
                }
                if let Some(place) = self.first_declaration_of_property(part, name, depth + 1) {
                    found = Some(found.flatten().or(place));
                    continue;
                }
                // `CheckFlagsReadPartial`: nothing stands in for it in a member that lacks it, so the union does not have it.
                let has_stand_in = match self.members(part) {
                    Some(members) if !is_late_bound => self
                        .applicable_index_type_for_name(&members, name)
                        .is_some(),
                    _ => false,
                };
                if !has_stand_in && !self.is_closed_object_literal_type(part) {
                    return None;
                }
            }
            return found;
        }
        let members = self.members(ty)?;
        let (prop, _) = self.property_of_type(&members, name)?;
        Some(self.first_declaration_of_prop(&prop, depth))
    }

    /// `GetErrorRangeForNode` of `prop.Declarations[0]`
    fn first_declaration_of_prop(&mut self, prop: &Prop, depth: u32) -> Option<Place> {
        match &prop.source {
            PropSource::Members(members) => {
                let &(file, member) = members.first()?;
                Some(self.place_in_file(file, self.hir(file)[member].pos, |c| {
                    c.error_range_of_member(file, member)
                }))
            }
            &PropSource::Parameter(file, param) => {
                let start = self.hir(file)[param].pos;
                Some(self.place_in_file(file, start, |c| (start, c.end_of_param(file, param))))
            }
            &PropSource::Literal(file, written) => {
                let hir::Prop { kind, pos, .. } = self.hir(file)[written];
                // A method or an accessor is pointed at by its name.
                let end = match kind {
                    PropKind::Method | PropKind::Getter | PropKind::Setter => {
                        self.end_of_prop_name(file, written)
                    }
                    _ => self.end_of_prop(file, written),
                };
                Some((file, pos, end))
            }
            &PropSource::Symbol(sym) => {
                let (file, decl) = self.files().decls_of(sym).first().copied()?;
                self.place_of_declaration(file, decl)
            }
            PropSource::Assigned(..) => self.place_of_prop(prop),
            PropSource::Intersected(_, parts) | PropSource::Copy(_, parts, _) => parts
                .iter()
                .find_map(|part| self.first_declaration_of_prop(part, depth + 1)),
            // `addMemberForKeyTypeWorker`: those of the property of the type the modifiers are taken from.
            PropSource::Mapped(..) => prop
                .declared_by_modifiers_property()
                .iter()
                .find_map(|part| self.first_declaration_of_prop(part, depth + 1)),
            PropSource::Type(_) => None,
        }
    }

    /// `GetErrorRangeForNode` of `ty.symbol.Declarations[0]`
    pub(super) fn first_declaration_of_type_symbol(&mut self, ty: TypeId) -> Option<Place> {
        let ty = self.force(ty);
        let sym = match self.data(ty) {
            TypeData::Ref { target, .. } => *target,
            TypeData::Fns { decls, .. } => {
                let &(file, func) = decls.first()?;
                return Some(self.place_of_signature_declaration(file, func));
            }
            TypeData::Anon { origin, .. } => match *origin {
                Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => {
                    let start = self.hir(file)[node].pos;
                    let range = |c: &Self| (start, c.end_of_type_node(file, node));
                    return Some(self.place_in_file(file, start, range));
                }
                Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..) => {
                    let start = self.start_inside_parentheses(file, e);
                    return Some((file, start, self.end_inside_parentheses(file, e)));
                }
                Origin::ClassStatic(sym)
                | Origin::Function(sym)
                | Origin::EnumObject(sym)
                | Origin::Module(sym)
                | Origin::Namespace { module: sym, .. } => sym,
                Origin::GlobalThis => return None,
            },
            _ => return None,
        };
        let (file, decl) = self.files().decls_of(sym).first().copied()?;
        match decl {
            Decl::Class(class) => {
                let class = &self.hir(file)[class];
                let start = if class.name.is_some() {
                    class.name_pos
                } else {
                    class.pos
                };
                Some(self.place_of_token(file, start))
            }
            Decl::Fn(func) => Some(self.place_of_signature_declaration(file, func)),
            _ => self.place_of_declaration(file, decl),
        }
    }

    /// `getApplicableIndexInfo(target, nameType).declaration`, where `nameType` is what names the property `name`.
    fn declaration_of_applicable_index_signature(
        &mut self,
        target: TypeId,
        name: Atom,
    ) -> Option<Place> {
        let ty = self.apparent_type_reduced(target);
        let members = self.members(ty)?;
        let key_type = self.key_type_of_name(name)?;
        let info = self.applicable_index(&members, key_type, Some(name))?;
        let (file, m) = info.declaration?;
        let start = self.hir(file)[m].pos;
        Some(self.place_in_file(file, start, |c| c.error_range_of_member(file, m)))
    }
}
