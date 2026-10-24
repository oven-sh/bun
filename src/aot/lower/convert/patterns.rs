use bun_sema::atom::Atom;
use bun_sema::check::aot::{MemberLookup, ShapeKind, TupleElement, TupleElementKind};
use bun_sema::hir::{ExprId, ExprKind, PatId, PatKind, PropKey, PropKind};
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
    fn record_flow_into_pattern(&mut self, pattern: PatId, source: Option<ExprId>) {
        if let Some(source) = source
            && let Ok(target) = self.queries.binding_type(pattern)
        {
            self.record_flow_into_type(source, target, ConversionKind::Performed);
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
        self.record_flow_into_pattern(pattern, source);
        let mut pending: SmallVec<[PatId; 8]> = smallvec![pattern];
        while let Some(pattern) = pending.pop() {
            match hir[pattern].kind {
                PatKind::Object(properties) => {
                    for property in properties.iter().map(|property| hir[property]) {
                        self.record_flow_into_pattern(property.value, property.default.some());
                        pending.push(property.value);
                    }
                }
                PatKind::Array(elements) => {
                    for element in elements.iter().map(|element| hir[element]) {
                        self.record_flow_into_pattern(element.pat, element.default.some());
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

    pub(super) fn find_element_type(
        &mut self,
        list: CheckerTypeId,
        index: usize,
    ) -> Option<CheckerTypeId> {
        let stripped = self.queries.without_nullish(list);
        let shape = stripped.and_then(|list| self.queries.type_shape(list));
        if let Ok(ShapeKind::Union(members)) = shape.map(|shape| shape.kind) {
            let mut common = None;
            for &list in members {
                let Some(element) = self.find_element_type(list, index) else {
                    continue;
                };
                if common.is_some_and(|common| common != element) {
                    return None;
                }
                common = Some(element);
            }
            return common;
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
        let erased = self.skip_type_syntax(target);
        let (target, default) = match self.hir[erased].kind {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => (target, Some(value)),
            _ => (target, None),
        };
        pending.extend(taken.map(|taken| (target, Taken::Value(taken))));
        if let Some(default) = default {
            self.add_flowing_operands(pending, target, default);
        }
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
                        match hir[property].kind {
                            PropKind::Init | PropKind::Shorthand => {}
                            PropKind::Spread => {
                                let target = match hir[hir[property].value].kind {
                                    ExprKind::Spread(target) => target,
                                    _ => hir[property].value,
                                };
                                pending.push((target, Taken::RestOfObject(object)));
                                continue;
                            }
                            PropKind::Method | PropKind::Getter | PropKind::Setter => continue,
                        }
                        let member = match hir.runtime_property_key(property) {
                            PropKey::Name(name) => self.find_member_type(object, name),
                            PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => None,
                        };
                        self.add_target(&mut pending, hir[property].value, member);
                    }
                }
                AssignmentTarget::ArrayPattern(elements) => {
                    let (list, first) = match taken {
                        Taken::Value(list) => (list, 0),
                        Taken::RestOfList { list, first } => (list, first),
                        Taken::RestOfObject(_) => continue,
                    };
                    for (index, element) in (first..).zip(hir.ids(elements)) {
                        if let ExprKind::Spread(target) = hir[element].kind {
                            pending.push((target, Taken::RestOfList { list, first: index }));
                            continue;
                        }
                        let taken = self.find_element_type(list, index);
                        self.add_target(&mut pending, element, taken);
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
