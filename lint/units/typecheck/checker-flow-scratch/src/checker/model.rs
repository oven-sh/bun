// Scratch: a small working model of the callees that the flow walks of the tests reach: unions by member list, type facts by table, diagnostics as a list.
use crate::ast::{Arg, DiagnosticId, NodeId};
use crate::checker::data::*;
use crate::core::List;
use crate::diagnostics::MessageId;

#[derive(Default)]
pub struct Model {
    pub unions: Vec<(Vec<TypeId>, TypeId)>,
    pub facts: Vec<(TypeId, TypeFacts, TypeId)>,
    pub diagnostics: Vec<(NodeId, MessageId)>,
    pub added: Vec<DiagnosticId>,
    pub last_reduction: UnionReduction,
}

impl<'a> Checker<'a> {
    pub fn new_test_type(&mut self, flags: TypeFlags) -> TypeId {
        self.types.alloc(Type {
            flags,
            ..Default::default()
        })
    }
    fn members(&self, t: TypeId) -> Vec<TypeId> {
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            return self.types[t].union_types.clone();
        }
        if self.types[t].flags.intersects(TypeFlags::NEVER) {
            return Vec::new();
        }
        vec![t]
    }
    pub fn type_types(&self, t: TypeId) -> List<'a, TypeId> {
        List::from_slice(Box::leak(self.types[t].union_types.clone().into_boxed_slice()))
    }
    pub fn get_union_type(&mut self, types: List<'_, TypeId>) -> TypeId {
        self.get_union_type_ex(types, UnionReduction::LITERAL, TypeAliasId::NIL, TypeId::NIL)
    }
    pub fn get_union_type_ex(
        &mut self,
        types: List<'_, TypeId>,
        union_reduction: UnionReduction,
        alias: TypeAliasId,
        origin: TypeId,
    ) -> TypeId {
        self.model.last_reduction = union_reduction;
        let mut members: Vec<TypeId> = Vec::new();
        for t in types.iter() {
            members.extend(self.members(t));
        }
        members.sort();
        members.dedup();
        if members.is_empty() {
            return self.never_type;
        }
        if members.len() == 1 {
            return members[0];
        }
        if let Some(found) = self.model.unions.iter().find(|entry| entry.0 == members) {
            return found.1;
        }
        let t = self.types.alloc(Type {
            flags: TypeFlags::UNION,
            union_types: members.clone(),
            ..Default::default()
        });
        self.model.unions.push((members, t));
        t
    }
    pub fn is_type_subset_of(&mut self, source: TypeId, target: TypeId) -> bool {
        if source == target || self.types[source].flags.intersects(TypeFlags::NEVER) {
            return true;
        }
        let target_members = self.members(target);
        self.types[target].flags.intersects(TypeFlags::UNION)
            && self.members(source).iter().all(|t| target_members.contains(t))
    }
    pub fn recombine_unknown_type(&mut self, t: TypeId) -> TypeId {
        t
    }
    pub fn convert_auto_to_any(&mut self, t: TypeId) -> TypeId {
        t
    }
    fn with_facts(&self, t: TypeId, facts: TypeFacts) -> TypeId {
        match self.model.facts.iter().find(|entry| entry.0 == t && entry.1 == facts) {
            Some(entry) => entry.2,
            None => t,
        }
    }
    pub fn get_adjusted_type_with_facts(&mut self, t: TypeId, facts: TypeFacts) -> TypeId {
        self.with_facts(t, facts)
    }
    pub fn get_type_with_facts(&mut self, t: TypeId, include: TypeFacts) -> TypeId {
        self.with_facts(t, include)
    }
    pub fn create_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        self.model.diagnostics.push((node, message));
        DiagnosticId(self.model.diagnostics.len() as u32)
    }
    pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId {
        self.model.added.push(diagnostic);
        diagnostic
    }
}
