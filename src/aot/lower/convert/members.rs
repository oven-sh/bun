use bun_sema::bind::Binding;
use bun_sema::check::aot::{
    GaveUp, MemberLookup, ObjectMemberKind, PositionTypes, ShapeKind, WrittenType,
};
use bun_sema::hir::{ExprId, ExprKind, MemberKey};
use smallvec::{SmallVec, smallvec};

use super::edges::Construct;
use super::patterns::find_tuple_elements;
use crate::ir::generated::TypeSiteKind;
use crate::ir::{LayoutId, ValueId};
use crate::lower::positions::SiteOrigin;
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, expression};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum FoundKind {
    Field,
    Accessor,
    IndexSignature,
    Contents,
}

#[derive(Copy, Clone)]
struct FoundMember {
    kind: FoundKind,
    types: PositionTypes,
    is_optional: bool,
}

fn classify_lookup(lookup: Result<MemberLookup, GaveUp>) -> Option<FoundMember> {
    match lookup {
        Ok(MemberLookup::Member(member)) => Some(FoundMember {
            kind: match member.kind {
                ObjectMemberKind::Field | ObjectMemberKind::Method => FoundKind::Field,
                _ => FoundKind::Accessor,
            },
            types: member.types,
            is_optional: member.is_optional,
        }),
        Ok(MemberLookup::Index(signature)) => Some(FoundMember {
            kind: FoundKind::IndexSignature,
            types: signature.types,
            is_optional: false,
        }),
        Ok(MemberLookup::Absent) | Err(_) => None,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn look_up_member(&mut self, access: ExprId) -> Option<FoundMember> {
        let found = self.resolve_member(access);
        let written = found.and_then(|found| found.types.written.written());
        let memo = &mut self.types.conversions.written_expressions;
        memo.insert(access, written);
        found
    }

    pub(super) fn find_declared_member_type(&mut self, access: ExprId) -> Option<CheckerTypeId> {
        self.resolve_member(access)?.types.checked.ok()
    }

    fn resolve_member(&mut self, access: ExprId) -> Option<FoundMember> {
        let (object, key) = self.hir.member_key(access)?;
        match key {
            MemberKey::Name(name) => {
                let receiver = self
                    .find_written_type(object)
                    .and_then(|receiver| self.queries.without_nullish(receiver).ok());
                let found = receiver
                    .and_then(|receiver| classify_lookup(self.queries.find_member(receiver, name)));
                found.or_else(|| classify_lookup(self.queries.member_access(access)))
            }
            MemberKey::Computed(index) => {
                let found = classify_lookup(self.queries.member_access(access));
                found.or_else(|| self.look_up_element(object, index))
            }
            MemberKey::PrivateName(_) => None,
        }
    }

    fn look_up_element(&mut self, object: ExprId, index: ExprId) -> Option<FoundMember> {
        if !self.has_number_type(index) {
            return None;
        }
        let written = self.find_written_type(object);
        // Under a constant index the read of a tuple is a reference, which is converted to the type of that one element.
        let is_any_element = expression::find_constant(self, index).is_none();
        let written = written.and_then(|ty| find_contents_type(self, ty, is_any_element));
        let checked = self.queries.expression_type(object).ok();
        let checked = checked.and_then(|ty| find_contents_type(self, ty, is_any_element));
        if written.is_none() && checked.is_none() {
            return None;
        }
        Some(FoundMember {
            kind: FoundKind::Contents,
            types: PositionTypes {
                written: written.map_or(WrittenType::Unwritten, WrittenType::Written),
                checked: checked.ok_or(GaveUp::Unresolved),
            },
            is_optional: false,
        })
    }

    pub(in crate::lower) fn find_array_element_type(
        &mut self,
        container: CheckerTypeId,
    ) -> Option<CheckerTypeId> {
        let container = self.queries.without_nullish(container).ok()?;
        match self.queries.type_shape(container).ok()?.kind {
            ShapeKind::Array { element, .. } => Some(element),
            ShapeKind::Int32 { base } => self.find_array_element_type(base),
            _ => None,
        }
    }

    fn has_number_type(&mut self, expression: ExprId) -> bool {
        let Ok(ty) = self.queries.expression_type(expression) else {
            return false;
        };
        let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
        while let Some(ty) = pending.pop() {
            let Ok(shape) = self.queries.type_shape(ty) else {
                return false;
            };
            match shape.kind {
                ShapeKind::Number
                | ShapeKind::NumberLiteral(_)
                | ShapeKind::NumericEnumMember(_) => {}
                ShapeKind::Union(members) => pending.extend_from_slice(members),
                ShapeKind::Int32 { base } => pending.push(base),
                _ => return false,
            }
        }
        true
    }

    pub(super) fn find_written_type(&mut self, expression: ExprId) -> Option<CheckerTypeId> {
        if let Some(&written) = self.types.conversions.written_expressions.get(&expression) {
            return written;
        }
        let written = self.compute_written_type(expression);
        let memo = &mut self.types.conversions.written_expressions;
        memo.insert(expression, written);
        written
    }

    fn compute_written_type(&mut self, expression: ExprId) -> Option<CheckerTypeId> {
        match self.hir[expression].kind {
            ExprKind::Ident(_) => match self.bound.binding(expression) {
                Binding::Symbol(symbol) => {
                    let symbol = self.queries.canonical_symbol(self.file, symbol);
                    self.queries.written_variable_type(symbol).written()
                }
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
            },
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.look_up_member(expression)?.types.written.written()
            }
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) => {
                let target = self.queries.resolved_call(expression).ok()??;
                target.result.written.written()
            }
            ExprKind::As { ty, .. } => self.queries.written_type(ty).written(),
            ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr)
            | ExprKind::AsConst(expr)
            | ExprKind::Instantiation { expr, .. } => self.find_written_type(expr),
            ExprKind::Await(operand) => {
                let operand_type = self.find_written_type(operand)?;
                self.queries.awaited_type(operand_type).ok()
            }
            _ => None,
        }
    }

    // A store goes into the slot of whatever object the receiver is, so the types of the receiver say what the slot holds.
    fn note_views_of_receiver(&mut self, access: ExprId) {
        let Some((object, _)) = self.hir.member_key(access) else {
            return;
        };
        let Ok(receiver) = self.queries.expression_type(object) else {
            return;
        };
        let mapped = self.map_type_at(receiver, self.hir[object].pos).ty;
        let views: SmallVec<[LayoutId; 4]> =
            SmallVec::from_slice(&self.fragment.types.get(mapped).layouts);
        for layout in views {
            self.note_view(layout);
        }
    }
}

fn find_contents_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    container: CheckerTypeId,
    is_any_element: bool,
) -> Option<CheckerTypeId> {
    let element = file.find_array_element_type(container);
    if element.is_some() || !is_any_element {
        return element;
    }
    find_tuple_elements(file, container)?;
    let held = file.collect_element_types_from(container, 0);
    match held.is_empty() {
        true => None,
        false => file.queries.union_of(&held).ok(),
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn convert_to_member(
        &mut self,
        access: ExprId,
        value: ValueId,
        source: Option<ExprId>,
    ) -> ValueId {
        let Some(found) = self.file.look_up_member(access) else {
            return value;
        };
        self.file.note_views_of_receiver(access);
        if matches!(found.kind, FoundKind::Accessor) && found.types.written.written().is_none() {
            return value;
        }
        let kind = match found.kind {
            FoundKind::Field | FoundKind::Accessor => TypeSiteKind::Field,
            FoundKind::IndexSignature | FoundKind::Contents => TypeSiteKind::Element,
        };
        let origin = SiteOrigin {
            kind,
            position: self.file.hir[access].pos,
        };
        let position = self.file.create_position(found.types, origin);
        let position = match found.is_optional {
            true => self.file.add_undefined(position),
            false => position,
        };
        self.describe_int32_flow(position, super::Int32Subject::Member(access), source);
        super::convert(self, value, position, source)
    }

    // The slot of a field holds what the type of the field says, and an accessor returns what its getter was converted to.
    pub(crate) fn claim_member_read(&mut self, access: ExprId, value: ValueId) -> ValueId {
        if !self.file.is_checked() {
            return value;
        }
        let Some(found) = self.file.look_up_member(access) else {
            return value;
        };
        let construct = match found.kind {
            FoundKind::Field | FoundKind::Accessor => return value,
            FoundKind::Contents => Construct::ContentsRead,
            FoundKind::IndexSignature => Construct::IndexSignatureRead,
        };
        let types = PositionTypes {
            written: WrittenType::Unwritten,
            ..found.types
        };
        let origin = SiteOrigin {
            kind: TypeSiteKind::Element,
            position: self.file.hir[access].pos,
        };
        let position = self.file.create_position(types, origin);
        // The checker leaves out the `undefined` of a name that the object lacks, and programs read such names all the time.
        let position = match found.kind {
            FoundKind::IndexSignature => self.file.add_undefined(position),
            FoundKind::Field | FoundKind::Accessor | FoundKind::Contents => position,
        };
        self.convert_read(value, position, construct)
    }
}
