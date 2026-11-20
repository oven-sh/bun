#[cfg(test)]
mod tests;

use bun_sema::util::SharedSort;

use super::generated::MAX_TRACKED_INTEGER;
use super::ids::{Id, TypeId};
use super::types::{
    ClassPart, Primitives, Type, TypeFlags, TypeRef, TypeTable, Types, hash_of_type,
};

#[inline]
pub(super) fn normalize_type(table: &mut TypeTable, ty: &mut Type) {
    if !normalize_without_table(ty) {
        merge_class_parts(table, &mut ty.classes);
    }
}

pub(super) fn normalize_without_table(ty: &mut Type) -> bool {
    normalize_integers(ty);
    absorb_covered_parts(ty);
    if ty.strings.len() > 1 {
        ty.strings.sort_unstable();
        ty.strings.dedup();
    }
    if ty.layouts.len() > 1 {
        ty.layouts.sort_unstable();
        ty.layouts.dedup();
    }
    if ty.builtins.len() > 1 {
        ty.builtins
            .shared_sort_unstable_by_key(|builtin| builtin.to_wire());
        ty.builtins.dedup();
    }
    if ty.functions.len() > 1 {
        ty.functions.sort_unstable();
        ty.functions.dedup();
    }
    if ty.classes.len() < 2 {
        return true;
    }
    ty.classes
        .shared_sort_by_key(|part| part.builtin_class.to_wire());
    let mut neighbors = ty.classes.iter().zip(ty.classes.iter().skip(1));
    !neighbors.any(|(left, right)| is_same_class(left, right))
}

impl TypeTable {
    pub fn union(&mut self, left: TypeId, right: TypeId) -> TypeId {
        let is_nullish = right == Self::UNDEFINED || right == Self::NULL || right == Self::NULLISH;
        if is_nullish && left != Self::NEVER && !self.get(left).is_internal() {
            let added = self.get(right).primitives;
            return self.add_primitives(left, added);
        }
        self.union_all([left, right])
    }

    pub fn union_all(&mut self, members: impl IntoIterator<Item = TypeId>) -> TypeId {
        let (types, union) = self.types_and_spare_union();
        debug_assert_eq!(*union, Type::never(), "the last union left nothing behind");
        let union = match add_up(types, members, union) {
            Some(known) => known,
            None => self.intern_spare_union(),
        };
        self.clear_spare_union();
        union
    }

    pub fn find_union(&self, members: impl IntoIterator<Item = TypeId>) -> Option<TypeId> {
        let mut union = Type::never();
        if let Some(known) = add_up(self.types(), members, &mut union) {
            return Some(known);
        }
        let is_normalized = normalize_without_table(&mut union);
        let hash = is_normalized.then(|| hash_of_type(&union))?;
        self.find_hashed(hash, &union)
    }

    pub fn without_primitives(&mut self, ty: TypeId, removed: Primitives) -> TypeId {
        let current = self.get(ty);
        if current.is_internal() {
            return ty;
        }
        let mut remaining = current.to_type();
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

fn add_up(
    types: Types<'_>,
    members: impl IntoIterator<Item = TypeId>,
    union: &mut Type,
) -> Option<TypeId> {
    let mut members = members
        .into_iter()
        .filter(|&member| member != TypeTable::NEVER);
    let Some(first) = members.next() else {
        return Some(TypeTable::NEVER);
    };
    let Some(second) = members.find(|&member| member != first) else {
        return Some(first);
    };
    let mut add_member = |member: TypeId| {
        let member = types.get(member.index());
        add_parts(union, &member);
        member.is_internal()
    };
    let mut has_internal_member = add_member(first);
    has_internal_member |= add_member(second);
    for member in members {
        has_internal_member |= add_member(member);
    }
    debug_assert!(
        !has_internal_member,
        "an opaque or environment type is never part of a union"
    );
    has_internal_member.then_some(TypeTable::ANYTHING)
}

fn normalize_integers(ty: &mut Type) {
    let Some((minimum, maximum)) = ty.integer_range() else {
        clear_integers(ty);
        return;
    };
    let is_empty = minimum > maximum;
    let is_tracked = -MAX_TRACKED_INTEGER <= minimum && maximum <= MAX_TRACKED_INTEGER;
    if !is_empty && !is_tracked {
        ty.primitives.0 |= Primitives::NUMBER.0;
    }
    if is_empty || ty.primitives.0 & Primitives::NUMBER.0 != 0 {
        clear_integers(ty);
    }
}

fn clear_integers(ty: &mut Type) {
    ty.flags.0 &= !TypeFlags::HAS_INTEGERS.0;
    ty.minimum = 0;
    ty.maximum = 0;
}

fn absorb_covered_parts(ty: &mut Type) {
    if ty.primitives.0 & Primitives::STRING.0 != 0 {
        ty.strings.clear();
    }
    if ty.flags.0 & TypeFlags::ANY_OBJECT.0 != 0 {
        ty.flags.0 |= TypeFlags::ANY_FUNCTION.0;
        ty.layouts.clear();
        ty.classes.clear();
        ty.builtins.clear();
    }
    if ty.flags.0 & TypeFlags::ANY_FUNCTION.0 != 0 {
        ty.functions.clear();
    }
}

fn is_same_class(left: &ClassPart, right: &ClassPart) -> bool {
    left.builtin_class == right.builtin_class
}

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

#[inline]
fn add_list<T: Clone>(union: &mut Vec<T>, member: &[T]) {
    match member {
        [] => {}
        [only] => union.push(only.clone()),
        _ => union.extend_from_slice(member),
    }
}

#[inline]
fn add_parts(union: &mut Type, member: &TypeRef<'_>) {
    union.primitives.0 |= member.primitives.0;
    if let Some((minimum, maximum)) = member.integer_range() {
        let (union_minimum, union_maximum) = union.integer_range().unwrap_or((minimum, maximum));
        union.minimum = union_minimum.min(minimum);
        union.maximum = union_maximum.max(maximum);
    }
    union.flags.0 |= member.flags.0;
    add_list(&mut union.strings, member.strings);
    add_list(&mut union.layouts, member.layouts);
    add_list(&mut union.classes, member.classes);
    add_list(&mut union.builtins, member.builtins);
    add_list(&mut union.functions, member.functions);
}
