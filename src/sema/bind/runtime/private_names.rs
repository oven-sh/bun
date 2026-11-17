use super::{PrivateMembers, PrivateName, PrivateNameId, PrivateReference, RuntimeInput};
use crate::atom::Atom;
use crate::hir::*;
use crate::util::{FxHashMap, SharedSort};
use std::collections::hash_map::Entry;

fn declared_members(node: &Member, member: MemberId) -> Option<PrivateMembers> {
    match node.kind {
        MemberKind::Property if node.flags.contains(Flags::ACCESSOR) => {
            Some(PrivateMembers::AutoAccessor(member))
        }
        MemberKind::Property => Some(PrivateMembers::Field(member)),
        MemberKind::Method => Some(PrivateMembers::Method(member)),
        MemberKind::Getter => Some(PrivateMembers::Accessor {
            getter: Some(member),
            setter: None,
        }),
        MemberKind::Setter => Some(PrivateMembers::Accessor {
            getter: None,
            setter: Some(member),
        }),
        _ => None,
    }
}

fn merge_members(earlier: PrivateMembers, later: PrivateMembers) -> PrivateMembers {
    match (earlier, later) {
        (
            PrivateMembers::Accessor { getter, setter },
            PrivateMembers::Accessor {
                getter: later_getter,
                setter: later_setter,
            },
        ) => PrivateMembers::Accessor {
            getter: getter.or(later_getter),
            setter: setter.or(later_setter),
        },
        (
            PrivateMembers::Field(_)
            | PrivateMembers::Method(_)
            | PrivateMembers::Accessor { .. }
            | PrivateMembers::AutoAccessor(_),
            _,
        ) => earlier,
    }
}

pub(super) fn compute_private_names(
    input: &mut RuntimeInput<'_, '_>,
    mut references: Vec<PrivateReference>,
) {
    let hir = input.hir;
    let mut names: Vec<PrivateName> = Vec::new();
    let mut members: Vec<(MemberId, PrivateNameId)> = Vec::new();
    let mut ids: FxHashMap<(ClassId, Atom), PrivateNameId> = FxHashMap::default();
    for (index, class) in hir.classes.iter().enumerate() {
        if input.bound.class_scope[index].is_none() || class.flags.contains(Flags::AMBIENT) {
            continue;
        }
        let class_id = ClassId(index as u32);
        for member in class.members.iter() {
            let node = &hir[member];
            let PropKey::Private(name) = node.key else {
                continue;
            };
            let Some(declared) = declared_members(node, member) else {
                continue;
            };
            let is_declaration_only = node.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT);
            if is_declaration_only || !has_runtime_member(hir, member) {
                continue;
            }
            let id = match ids.entry((class_id, name)) {
                Entry::Occupied(entry) => {
                    let id = *entry.get();
                    let recorded = &mut names[id.idx()];
                    recorded.members = merge_members(recorded.members, declared);
                    id
                }
                Entry::Vacant(entry) => {
                    let id = *entry.insert(PrivateNameId(names.len() as u32));
                    names.push(PrivateName {
                        class: class_id,
                        name,
                        first_member: member,
                        members: declared,
                        is_static: node.flags.contains(Flags::STATIC),
                    });
                    id
                }
            };
            members.push((member, id));
        }
    }
    members.shared_sort_unstable_by_key(|entry| entry.0);
    references.shared_sort_unstable_by_key(|reference| reference.reference);
    references.dedup_by_key(|reference| reference.reference);
    let resolved = references.iter().filter_map(|reference| {
        let id = *ids.get(&(reference.class?, reference.name))?;
        Some((reference.reference, id))
    });
    let tables = &mut input.bound.runtime.private_names;
    tables.references = resolved.collect();
    tables.names = names;
    tables.members = members;
}
