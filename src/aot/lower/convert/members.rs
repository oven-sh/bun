use bun_sema::bind::Binding;
use bun_sema::check::aot::{GaveUp, MemberLookup, PositionTypes, ShapeKind, WrittenType};
use bun_sema::hir::{ExprId, ExprKind, MemberKey};
use smallvec::{SmallVec, smallvec};

use super::patterns::find_tuple_elements;
use crate::ir::ValueId;
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, expression};

#[derive(Copy, Clone)]
struct FoundMember {
    types: PositionTypes,
    is_optional: bool,
}

fn classify_lookup(lookup: Result<MemberLookup, GaveUp>) -> Option<FoundMember> {
    match lookup {
        Ok(MemberLookup::Member(member)) => Some(FoundMember {
            types: member.types,
            is_optional: member.is_optional,
        }),
        Ok(MemberLookup::Index(signature)) => Some(FoundMember {
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
        let written = self.find_written_type(object)?;
        if !self.has_number_type(index) {
            return None;
        }
        let is_any_element = expression::find_constant(self, index).is_none();
        let written = find_contents_type(self, written, is_any_element)?;
        Some(FoundMember {
            types: PositionTypes {
                written: WrittenType::Written(written),
                checked: Err(GaveUp::Unresolved),
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
        let (types, is_optional) = (found.types, found.is_optional);
        let Some(position) = self
            .file
            .find_int32_position(types, types.written, is_optional)
        else {
            return value;
        };
        self.describe_int32_flow_into_member(position, access, source);
        super::convert(self, value, position, source)
    }
}
