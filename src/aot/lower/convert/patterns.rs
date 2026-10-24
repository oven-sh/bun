use bun_sema::atom::Atom;
use bun_sema::check::aot::{MemberLookup, ShapeKind, TupleElement, TupleElementKind};
use bun_sema::hir::{ExprId, ExprKind, PatId, PatKind, PropId, PropKey, PropKind};
use smallvec::{SmallVec, smallvec};

use super::supertypes::ConversionKind;
use crate::ir::ContentsSlot;
use crate::lower::expression::AssignmentTarget;
use crate::lower::types::find_contents_type;
use crate::lower::{CheckerTypeId, FileLowering};

#[derive(Copy, Clone)]
enum Taken {
    Value(CheckerTypeId),
    RestOfList { list: CheckerTypeId, first: usize },
    RestOfObject(CheckerTypeId),
}

type PendingTargets = SmallVec<[(ExprId, Taken); 8]>;

impl FileLowering<'_, '_, '_, '_> {
    fn record_default(&mut self, pattern: PatId, default: ExprId) {
        if let Some(default) = default.some()
            && let Ok(target) = self.queries.binding_type(pattern)
        {
            self.record_flow_into_type(default, target, ConversionKind::Performed);
        }
    }

    // The name under a pattern has the type of what the pattern takes out, so only the whole value and the defaults are converted.
    pub(in crate::lower) fn record_binding_pattern_flow(
        &mut self,
        pattern: PatId,
        source: Option<ExprId>,
    ) {
        let hir = self.hir;
        match hir[pattern].kind {
            PatKind::Object(_) | PatKind::Array(_) => {}
            PatKind::Missing | PatKind::Ident(_) => return,
        }
        if let Some(source) = source
            && let Ok(target) = self.queries.binding_type(pattern)
        {
            self.record_flow_into_type(source, target, ConversionKind::Performed);
        }
        let mut pending: SmallVec<[PatId; 8]> = smallvec![pattern];
        while let Some(pattern) = pending.pop() {
            match hir[pattern].kind {
                PatKind::Object(properties) => {
                    for property in properties.iter().map(|property| hir[property]) {
                        self.record_default(property.value, property.default);
                        pending.push(property.value);
                    }
                }
                PatKind::Array(elements) => {
                    for element in elements.iter().map(|element| hir[element]) {
                        self.record_default(element.pat, element.default);
                        pending.push(element.pat);
                    }
                }
                PatKind::Missing | PatKind::Ident(_) => {}
            }
        }
    }

    fn find_member_type(&mut self, object: CheckerTypeId, name: Atom) -> Option<CheckerTypeId> {
        let object = self.queries.without_nullish(object).ok()?;
        match self.queries.find_member(object, name).ok()? {
            MemberLookup::Member(member) => member.types.checked.ok(),
            MemberLookup::Index(signature) => signature.types.checked.ok(),
            MemberLookup::Absent => None,
        }
    }

    fn find_common_element_type(
        &mut self,
        lists: &[CheckerTypeId],
        index: usize,
    ) -> Option<CheckerTypeId> {
        let mut common = None;
        for &list in lists {
            let Some(element) = self.find_element_type(list, index) else {
                continue;
            };
            if common.is_some_and(|common| common != element) {
                return None;
            }
            common = Some(element);
        }
        common
    }

    pub(super) fn find_element_type(
        &mut self,
        list: CheckerTypeId,
        index: usize,
    ) -> Option<CheckerTypeId> {
        if let Some(members) = find_union_members(self, list) {
            return self.find_common_element_type(members, index);
        }
        let Some(elements) = find_tuple_elements(self, list) else {
            return find_contents_type(self, list, ContentsSlot::Element);
        };
        for (position, element) in elements.iter().enumerate() {
            match element.kind {
                TupleElementKind::Required | TupleElementKind::Optional if position < index => {}
                TupleElementKind::Required
                | TupleElementKind::Optional
                | TupleElementKind::Rest => {
                    return Some(element.ty);
                }
                TupleElementKind::Variadic => return None,
            }
        }
        None
    }

    pub(super) fn collect_element_types_from(
        &mut self,
        list: CheckerTypeId,
        first: usize,
    ) -> SmallVec<[CheckerTypeId; 4]> {
        let Some(elements) = find_tuple_elements(self, list) else {
            return find_contents_type(self, list, ContentsSlot::Element)
                .into_iter()
                .collect();
        };
        let mut types = SmallVec::new();
        for (position, element) in elements.iter().enumerate() {
            match element.kind {
                TupleElementKind::Required | TupleElementKind::Optional if position < first => {}
                TupleElementKind::Required
                | TupleElementKind::Optional
                | TupleElementKind::Rest => {
                    types.push(element.ty);
                }
                TupleElementKind::Variadic => {
                    types.extend(find_contents_type(self, element.ty, ContentsSlot::Element));
                }
            }
        }
        types
    }

    fn split_default(&self, target: ExprId) -> (ExprId, Option<ExprId>) {
        let erased = self.skip_type_syntax(target);
        if let ExprKind::Assign {
            op: None,
            target,
            value,
        } = self.hir[erased].kind
        {
            return (target, Some(value));
        }
        (target, None)
    }

    fn add_flowing_operands(
        &mut self,
        pending: &mut PendingTargets,
        target: ExprId,
        source: ExprId,
    ) {
        for operand in self.collect_flowing_operands(source) {
            if let Ok(ty) = self.queries.expression_type(operand) {
                pending.push((target, Taken::Value(ty)));
            }
        }
    }

    fn add_target(
        &mut self,
        pending: &mut PendingTargets,
        target: ExprId,
        taken: Option<CheckerTypeId>,
    ) {
        let (target, default) = self.split_default(target);
        pending.extend(taken.map(|taken| (target, Taken::Value(taken))));
        if let Some(default) = default {
            self.add_flowing_operands(pending, target, default);
        }
    }

    fn add_property_target(
        &mut self,
        pending: &mut PendingTargets,
        property: PropId,
        object: CheckerTypeId,
    ) {
        let hir = self.hir;
        match hir[property].kind {
            PropKind::Init | PropKind::Shorthand => {}
            PropKind::Spread => {
                let target = skip_spread(self, hir[property].value);
                pending.push((target, Taken::RestOfObject(object)));
                return;
            }
            PropKind::Method | PropKind::Getter | PropKind::Setter => return,
        }
        let member = match hir.runtime_property_key(property) {
            PropKey::Name(name) => self.find_member_type(object, name),
            PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => None,
        };
        self.add_target(pending, hir[property].value, member);
    }

    fn add_element_target(
        &mut self,
        pending: &mut PendingTargets,
        element: ExprId,
        list: CheckerTypeId,
        index: usize,
    ) {
        if let ExprKind::Spread(target) = self.hir[element].kind {
            pending.push((target, Taken::RestOfList { list, first: index }));
            return;
        }
        let taken = self.find_element_type(list, index);
        self.add_target(pending, element, taken);
    }

    fn record_flow_into_target(&mut self, target: ExprId, taken: Taken) {
        let Ok(assigned) = self.queries.expression_type(target) else {
            return;
        };
        let position = self.hir[target].pos;
        match taken {
            Taken::Value(source) => {
                let kind = ConversionKind::Asserted;
                self.record_conversion(source, assigned, position, kind);
            }
            Taken::RestOfObject(object) => {
                self.record_copied_members(object, assigned, position);
            }
            Taken::RestOfList { list, first } => {
                let Some(held) = find_contents_type(self, assigned, ContentsSlot::Element) else {
                    return;
                };
                for element in self.collect_element_types_from(list, first) {
                    let kind = ConversionKind::Asserted;
                    self.record_conversion(element, held, position, kind);
                }
            }
        }
    }

    fn record_taken_values(&mut self, mut pending: PendingTargets) {
        let hir = self.hir;
        while let Some((target, taken)) = pending.pop() {
            match self.classify_assignment_target(target) {
                AssignmentTarget::Elision => {}
                AssignmentTarget::Identifier { .. } | AssignmentTarget::Expression => {
                    self.record_flow_into_target(target, taken);
                }
                AssignmentTarget::ObjectPattern(properties) => {
                    let Taken::Value(object) = taken else {
                        continue;
                    };
                    for property in properties.iter() {
                        self.add_property_target(&mut pending, property, object);
                    }
                }
                AssignmentTarget::ArrayPattern(elements) => {
                    let (list, first) = match taken {
                        Taken::Value(list) => (list, 0),
                        Taken::RestOfList { list, first } => (list, first),
                        Taken::RestOfObject(_) => continue,
                    };
                    for (index, element) in hir.ids(elements).enumerate() {
                        self.add_element_target(&mut pending, element, list, first + index);
                    }
                }
            }
        }
    }

    pub(in crate::lower) fn record_assignment_pattern_flow(
        &mut self,
        target: ExprId,
        source: ExprId,
    ) {
        match self.classify_assignment_target(target) {
            AssignmentTarget::ArrayPattern(_) | AssignmentTarget::ObjectPattern(_) => {}
            _ => return,
        }
        let mut pending = PendingTargets::new();
        self.add_flowing_operands(&mut pending, target, source);
        self.record_taken_values(pending);
    }

    pub(in crate::lower) fn record_assigned_type_flow(
        &mut self,
        target: ExprId,
        source: CheckerTypeId,
    ) {
        self.record_taken_values(smallvec![(target, Taken::Value(source))]);
    }
}

pub(super) fn find_tuple_elements<'c>(
    file: &mut FileLowering<'_, 'c, '_, '_>,
    list: CheckerTypeId,
) -> Option<&'c [TupleElement]> {
    let list = file.queries.without_nullish(list).ok()?;
    let ShapeKind::Tuple { elements, .. } = file.queries.type_shape(list).ok()?.kind else {
        return None;
    };
    Some(elements)
}

fn find_union_members<'c>(
    file: &mut FileLowering<'_, 'c, '_, '_>,
    list: CheckerTypeId,
) -> Option<&'c [CheckerTypeId]> {
    let list = file.queries.without_nullish(list).ok()?;
    let ShapeKind::Union(members) = file.queries.type_shape(list).ok()?.kind else {
        return None;
    };
    Some(members)
}

fn skip_spread(file: &FileLowering<'_, '_, '_, '_>, element: ExprId) -> ExprId {
    if let ExprKind::Spread(target) = file.hir[element].kind {
        target
    } else {
        element
    }
}
