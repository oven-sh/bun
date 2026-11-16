use bun_sema::hir::{self, ClassId, Flags, MemberId, MemberKind, PropKey};
use bun_sema::util::SharedSort;
use rustc_hash::FxHashMap;

use super::{DecoratedKind, Decoration, DecorationGroup, ValueInitializers};
use crate::lower::class::{ClassPlan, has_decorators, is_auto_accessor, runtime_members};

pub(in crate::lower) type InitializerLists = FxHashMap<MemberId, ValueInitializers>;

pub(in crate::lower) fn plan_decorations(
    hir: &hir::File<'_>,
    class: ClassId,
    plan: &mut ClassPlan,
) -> InitializerLists {
    let mut decorations: Vec<Decoration> = runtime_members(hir, class)
        .filter_map(|member| create_decoration(hir, member))
        .collect();
    decorations.shared_sort_by_key(|decoration| decoration.group());
    let mut next = 0;
    let has_instance_methods = decorations
        .iter()
        .any(|decoration| decoration.group() == DecorationGroup::InstanceMethod);
    if has_instance_methods {
        plan.instance_method_initializers = Some(next);
        next += 1;
    }
    let mut lists = InitializerLists::default();
    for decoration in &mut decorations {
        match decoration.kind {
            DecoratedKind::Accessor | DecoratedKind::Field => {
                let initializers = ValueInitializers {
                    value: next,
                    extra: next + 1,
                };
                next += 2;
                decoration.initializers = Some(initializers);
                lists.insert(decoration.member, initializers);
            }
            DecoratedKind::Method | DecoratedKind::Getter | DecoratedKind::Setter => {}
        }
    }
    plan.initializer_list_count = next;
    plan.decorations = decorations;
    lists
}

fn create_decoration(hir: &hir::File<'_>, member: MemberId) -> Option<Decoration> {
    let node = hir[member];
    if !has_decorators(hir, node.modifiers) {
        return None;
    }
    let is_private = match hir.runtime_member_key(member) {
        PropKey::Private(_) => true,
        PropKey::None | PropKey::Name(_) | PropKey::Computed(_) => false,
    };
    let kind = match hir.runtime_member_kind(member) {
        MemberKind::Method => DecoratedKind::Method,
        MemberKind::Getter => DecoratedKind::Getter,
        MemberKind::Setter => DecoratedKind::Setter,
        MemberKind::Property if is_auto_accessor(hir, member) => DecoratedKind::Accessor,
        MemberKind::Property => DecoratedKind::Field,
        _ => return None,
    };
    Some(Decoration {
        member,
        kind,
        is_static: node.flags.contains(Flags::STATIC),
        is_private,
        initializers: None,
    })
}
