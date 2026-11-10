//! Where a subexpression's expected type comes from. `elaborateError` attaches this to its errors
//! as related information.

use super::related::FileSpan;
use super::*;
use crate::bind::Decl;

impl Checker<'_, '_> {
    /// The tail of `elaborateElement`. Returns the related information for an error about property
    /// or element `name` of an expression compared with `target`.
    pub(super) fn expected_property(&mut self, target: TypeId, name: Atom) -> Option<Reported> {
        // Comparisons made here aren't part of the comparison being reported, so its flag is
        // restored.
        let too_complex = self.relation_too_complex;
        let related = self.related_info_for_expected_property(target, name);
        self.relation_too_complex = too_complex;
        related
    }

    /// Returns 6501 at `target`'s index signature that applies to `name`, or 6500 at the property's
    /// declaration, falling back to `target`'s declaration. Never points into the default library.
    fn related_info_for_expected_property(
        &mut self,
        target: TypeId,
        name: Atom,
    ) -> Option<Reported> {
        let property = self.first_declaration_of_property(target, name);
        if property.is_none()
            && let Some(signature) = self.declaration_of_applicable_index_signature(target, name)
            && !self.files().module(signature.0).is_lib
        {
            return Some(Reported::bare(signature, 6501));
        }
        let declaration_span = match property.flatten() {
            Some(declaration_span) => declaration_span,
            None => self.first_declaration_of_type_symbol(target)?,
        };
        if self.files().module(declaration_span.0).is_lib {
            return None;
        }
        let property_name = if self.atoms().is_symbol_name(name) {
            let key = self.key_type_of_name(name)?;
            self.type_to_string(key)
        } else {
            self.atom_text(name)
        };
        let on_type = self.type_to_string(target);
        Some(self.new_diagnostic(
            declaration_span,
            6500,
            &[Arg::Bytes(&property_name), Arg::Bytes(&on_type)],
        ))
    }

    /// Returns the span that `range` computes for the node at `start` in `file`. If the default
    /// library's text isn't stored, its end positions are unknown and the span is empty.
    fn span_in_file(
        &self,
        file: FileId,
        start: u32,
        range: impl FnOnce(&Self) -> (u32, u32),
    ) -> FileSpan {
        if self.hir(file).text.is_empty() {
            return (file, start, start);
        }
        let (start, end) = range(self);
        (file, start, end)
    }

    /// `GetErrorRangeForNode` of `getPropertyOfType(ty, name).Declarations[0]`. `None` if there's
    /// no such property, `Some(None)` if it has no declaration.
    fn first_declaration_of_property(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<Option<FileSpan>> {
        let (prop, _) = self.get_property_of_type(ty, name)?;
        Some(self.span_of_first_prop_declaration(prop))
    }

    /// `GetErrorRangeForNode` of `ty.symbol.Declarations[0]`
    pub(super) fn first_declaration_of_type_symbol(&mut self, ty: TypeId) -> Option<FileSpan> {
        let sym = match self.data(ty) {
            TypeData::Ref { target, .. } => *target,
            TypeData::Fns { decls, .. } => {
                let &(file, func) = decls.first()?;
                return Some(self.span_of_signature_declaration(file, func));
            }
            TypeData::Anon { origin, .. } => match *origin {
                Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => {
                    let start = self.hir(file)[node].pos;
                    let range = |c: &Self| (start, c.end_of_type_node(file, node));
                    return Some(self.span_in_file(file, start, range));
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
                let (start, end) = self.error_range_of_class(file, class);
                Some((file, start, end))
            }
            Decl::Fn(func) => Some(self.span_of_signature_declaration(file, func)),
            _ => self.span_of_declaration(file, decl),
        }
    }

    /// `getApplicableIndexInfo(target, nameType).declaration`, where `nameType` is the name type of
    /// property `name`.
    fn declaration_of_applicable_index_signature(
        &mut self,
        target: TypeId,
        name: Atom,
    ) -> Option<FileSpan> {
        let ty = self.reduced_apparent_type(target);
        let members = self.structured_members(ty)?;
        let key_type = self.key_type_of_name(name)?;
        let info = self.applicable_index_info(&members, key_type)?;
        let (file, m) = info.declaration?;
        let start = self.hir(file)[m].start;
        Some(self.span_in_file(file, start, |c| c.error_range_of_member(file, m)))
    }
}
