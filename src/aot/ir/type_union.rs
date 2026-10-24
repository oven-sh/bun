#[cfg(test)]
mod tests;

use bun_sema::util::SharedSort;

use super::generated::MAX_TRACKED_INTEGER;
use super::ids::TypeId;
use super::types::{ClassPart, Primitives, Type, TypeFlags, TypeTable};

pub(super) fn normalize_type(table: &mut TypeTable, ty: &mut Type) {
    if !normalize_without_table(ty) {
        merge_class_parts(table, &mut ty.classes);
    }
}

// `false`: the type names a class twice, and what the two parts hold together is a type of the table.
pub(super) fn normalize_without_table(ty: &mut Type) -> bool {
    normalize_integers(ty);
    absorb_covered_parts(ty);
    ty.strings.sort_unstable();
    ty.strings.dedup();
    ty.layouts.sort_unstable();
    ty.layouts.dedup();
    ty.builtins
        .shared_sort_unstable_by_key(|builtin| builtin.to_wire());
    ty.builtins.dedup();
    ty.functions.sort_unstable();
    ty.functions.dedup();
    ty.classes
        .shared_sort_by_key(|part| part.builtin_class.to_wire());
    let mut neighbors = ty.classes.iter().zip(ty.classes.iter().skip(1));
    !neighbors.any(|(left, right)| is_same_class(left, right))
}

impl TypeTable {
    pub fn union(&mut self, left: TypeId, right: TypeId) -> TypeId {
        self.union_all([left, right])
    }

    pub fn union_all(&mut self, members: impl IntoIterator<Item = TypeId>) -> TypeId {
        let mut members = members
            .into_iter()
            .filter(|&member| member != TypeTable::NEVER);
        let Some(first) = members.next() else {
            return TypeTable::NEVER;
        };
        let Some(second) = members.find(|&member| member != first) else {
            return first;
        };
        let mut union = Type::never();
        let mut has_internal_member = false;
        for member in [first, second].into_iter().chain(members) {
            let member = self.get(member);
            has_internal_member |= member.is_internal();
            add_parts(&mut union, member);
        }
        debug_assert!(
            !has_internal_member,
            "an opaque or environment type is never part of a union"
        );
        if has_internal_member {
            return TypeTable::ANYTHING;
        }
        self.intern(union)
    }

    pub fn without_primitives(&mut self, ty: TypeId, removed: Primitives) -> TypeId {
        let current = self.get(ty);
        if current.is_internal() {
            return ty;
        }
        let mut remaining = current.clone();
        remaining.primitives = remaining.primitives.without(removed);
        if removed.contains(Primitives::NUMBER) {
            remaining.flags = remaining.flags.without(TypeFlags::HAS_INTEGERS);
        }
        if removed.contains(Primitives::STRING) {
            remaining.strings.clear();
        }
        self.intern(remaining)
    }
}

fn normalize_integers(ty: &mut Type) {
    let Some((minimum, maximum)) = ty.integer_range() else {
        clear_integers(ty);
        return;
    };
    let is_empty = minimum > maximum;
    let is_tracked = -MAX_TRACKED_INTEGER <= minimum && maximum <= MAX_TRACKED_INTEGER;
    if !is_empty && !is_tracked {
        ty.primitives |= Primitives::NUMBER;
    }
    if is_empty || ty.primitives.contains(Primitives::NUMBER) {
        clear_integers(ty);
    }
}

fn clear_integers(ty: &mut Type) {
    ty.flags = ty.flags.without(TypeFlags::HAS_INTEGERS);
    ty.minimum = 0;
    ty.maximum = 0;
}

fn absorb_covered_parts(ty: &mut Type) {
    if ty.primitives.contains(Primitives::STRING) {
        ty.strings.clear();
    }
    if ty.flags.contains(TypeFlags::ANY_OBJECT) {
        ty.flags |= TypeFlags::ANY_FUNCTION;
        ty.layouts.clear();
        ty.classes.clear();
        ty.builtins.clear();
    }
    if ty.flags.contains(TypeFlags::ANY_FUNCTION) {
        ty.functions.clear();
    }
}

fn is_same_class(left: &ClassPart, right: &ClassPart) -> bool {
    left.builtin_class == right.builtin_class
}

// The parts are in the order of their classes.
fn merge_class_parts(table: &mut TypeTable, classes: &mut Vec<ClassPart>) {
    let parts = core::mem::take(classes);
    for run in parts.chunk_by(is_same_class) {
        let mut merged = run[0].clone();
        debug_assert!(
            run.iter()
                .all(|part| part.contents.len() == merged.contents.len())
        );
        for (slot, content) in merged.contents.iter_mut().enumerate() {
            let members = run
                .iter()
                .filter_map(|part| part.contents.get(slot).copied());
            *content = table.union_all(members);
        }
        classes.push(merged);
    }
}

fn add_parts(union: &mut Type, member: &Type) {
    union.primitives |= member.primitives;
    if let Some((minimum, maximum)) = member.integer_range() {
        let (union_minimum, union_maximum) = union.integer_range().unwrap_or((minimum, maximum));
        union.minimum = union_minimum.min(minimum);
        union.maximum = union_maximum.max(maximum);
    }
    union.flags |= member.flags;
    union.strings.extend_from_slice(&member.strings);
    union.layouts.extend_from_slice(&member.layouts);
    union.classes.extend_from_slice(&member.classes);
    union.builtins.extend_from_slice(&member.builtins);
    union.functions.extend_from_slice(&member.functions);
}
