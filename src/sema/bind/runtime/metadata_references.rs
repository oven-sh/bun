use super::references::ReferencePass;
use super::{Binding, ImplicitReferenceKind};
use crate::atom::Atom;
use crate::bind::decorator_metadata::{
    DesignEntries, DesignValue, Metadata, MetadataCollector, MetadataGlobal, MetadataReference,
    first_name, has_decorators, has_parameter_decorator, is_decoratable_member,
    is_legacy_decorated_member,
};
use crate::bind::{ClassOwner, ScopeId};
use crate::hir::*;
use crate::util::SharedSort;
use smallvec::SmallVec;

struct PendingReference {
    reference: MetadataReference,
    scope: ScopeId,
    name: Atom,
    node: NodeData,
}

#[derive(Default)]
struct SerializedGlobals {
    first_members: SmallVec<[(MetadataGlobal, MemberId); 9]>,
}

impl SerializedGlobals {
    fn add(&mut self, member: MemberId, metadata: Metadata) {
        for global in metadata.serialized().globals().into_iter().flatten() {
            if !self.first_members.iter().any(|entry| entry.0 == global) {
                self.first_members.push((global, member));
            }
        }
    }

    fn add_list(&mut self, member: MemberId, list: &[Metadata]) {
        for &metadata in list {
            self.add(member, metadata);
        }
    }

    fn add_entries(&mut self, member: MemberId, entries: &DesignEntries) {
        for (_, value) in entries {
            match value {
                DesignValue::Type(metadata) => self.add(member, *metadata),
                DesignValue::Types(list) => self.add_list(member, list),
            }
        }
    }
}

fn collect_class(collector: &mut MetadataCollector<'_, '_>, class: ClassId) -> SerializedGlobals {
    let hir = collector.hir;
    let mut serialized = SerializedGlobals::default();
    let mut has_constructor_implementation = false;
    for member in hir[class].members.iter() {
        let node = hir[member];
        if node.kind != MemberKind::Constructor {
            let entries = collector.collect_member(member);
            if is_legacy_decorated_member(hir, member) {
                serialized.add_entries(member, &entries);
            }
            continue;
        }
        let Some(constructor) = node.func.some() else {
            continue;
        };
        let parameters = collector.collect_constructor(class, constructor);
        if has_constructor_implementation || !is_decoratable_member(hir, member) {
            continue;
        }
        has_constructor_implementation = true;
        if has_decorators(hir, hir[class].modifiers) || has_parameter_decorator(hir, member) {
            serialized.add_list(member, &parameters);
        }
    }
    serialized
}

impl ReferencePass<'_, '_> {
    pub(super) fn resolve_decorator_metadata(&mut self) {
        let hir = self.lookup.hir;
        let has_legacy_decorators = hir.has_typescript_semantics() && hir.legacy_decorators;
        if !self.options.emits_decorator_metadata || !has_legacy_decorators {
            return;
        }
        let mut pending = Vec::new();
        for index in 0..hir.classes.len() {
            self.collect_class_references(ClassId(index as u32), &mut pending);
        }
        pending.shared_sort_unstable_by_key(|entry: &PendingReference| entry.reference);
        for entry in pending {
            let kind = ImplicitReferenceKind::DecoratorMetadata(entry.reference);
            self.add_implicit_reference(entry.scope, entry.name, entry.node, kind);
        }
    }

    fn collect_class_references(&self, class: ClassId, pending: &mut Vec<PendingReference>) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let class_scope = bound.class_scope[class.idx()];
        if class_scope.is_none() || self.type_only.has_scope(class_scope) {
            return;
        }
        let mut collector = MetadataCollector::new(hir);
        let serialized = collect_class(&mut collector, class);
        for visited in collector.visited() {
            if let Some(name) = first_name(hir, visited.node) {
                pending.push(PendingReference {
                    reference: MetadataReference::TypeName(visited.node),
                    scope: class_scope,
                    name,
                    node: visited.annotated,
                });
            }
        }
        match bound.class_owner[class.idx()] {
            ClassOwner::Stmt(_) => {}
            ClassOwner::Expr(_) => return,
        }
        let enclosing_scope = bound.scopes[class_scope.idx()].parent;
        for (global, member) in serialized.first_members {
            let name = global.name();
            if self.lookup.find(enclosing_scope, name).binding != Binding::Free {
                pending.push(PendingReference {
                    reference: MetadataReference::Global(class, global),
                    scope: enclosing_scope,
                    name,
                    node: NodeData::Member(member),
                });
            }
        }
    }
}
