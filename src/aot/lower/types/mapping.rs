use smallvec::SmallVec;

use super::{Component, EdgeKind, MappedType, TypeEdge};
use crate::ir::Mapped;
use crate::ir::generated::LimitId;
use crate::lower::{CheckerTypeId, FileLowering};

type OpenTypes = SmallVec<[CheckerTypeId; 4]>;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn map_type_at(&mut self, ty: CheckerTypeId) -> Mapped {
        self.ensure_mapped(ty, &mut OpenTypes::new())
    }

    fn ensure_mapped(&mut self, ty: CheckerTypeId, open: &mut OpenTypes) -> Mapped {
        if let Some(entry) = self.find_mapped(ty) {
            return entry.mapped;
        }
        // Read before `explore`: the checker's answers during exploration decide the components, so an unstable one must count too.
        let unstable_answers_before = self.queries.count_unstable_answers();
        match self.explore(ty) {
            Some(components) => {
                for component in &components {
                    self.map_component(component, unstable_answers_before, open);
                }
            }
            None => self.map_exhausted_type(ty, unstable_answers_before, open),
        }
        let entry = self.find_mapped(ty);
        debug_assert!(entry.is_some(), "the last component holds the type");
        entry.map_or(Mapped::UNKNOWN, |entry| entry.mapped)
    }

    fn map_component(
        &mut self,
        component: &Component,
        unstable_answers_before: u64,
        open: &mut OpenTypes,
    ) {
        if self.find_mapped(component[0].ty).is_some() {
            return;
        }
        if let [alone] = &component[..]
            && self.meet_again(alone)
        {
            return;
        }
        let weight = self.weigh_component(component);
        for member in component {
            self.map_member(component, weight, unstable_answers_before, open, member.ty);
        }
    }

    fn weigh_component(&mut self, component: &Component) -> Option<u32> {
        let mut targets: SmallVec<[CheckerTypeId; 8]> = component
            .iter()
            .flat_map(|member| &member.edges)
            .map(|edge| edge.target)
            .filter(|&target| !is_member(component, target))
            .collect();
        targets.sort_unstable_by_key(|target| target.0);
        targets.dedup();
        let mut weight = Some(u32::try_from(component.len()).unwrap_or(u32::MAX));
        for target in targets {
            let Some(entry) = self.find_mapped(target) else {
                debug_assert!(false, "components arrive after what they reach");
                continue;
            };
            weight = weight
                .zip(entry.weight)
                .map(|(sum, part)| sum.saturating_add(part));
        }
        let weight = weight?;
        if u64::from(weight) <= self.inputs.limits.get(LimitId::MaxTypeNodes) {
            return Some(weight);
        }
        self.count_reachable_types(component[0].ty)
    }

    fn map_member(
        &mut self,
        component: &Component,
        weight: Option<u32>,
        unstable_answers_before: u64,
        open: &mut OpenTypes,
        ty: CheckerTypeId,
    ) -> Mapped {
        if let Some(entry) = self.find_mapped(ty) {
            return entry.mapped;
        }
        if open.contains(&ty) {
            return Mapped::UNKNOWN;
        }
        open.push(ty);
        if component.len() == 1 {
            self.begin_list_of_function_types();
        }
        let mapped = self.map_shape(ty, &mut |file, edge| {
            if !is_member(component, edge.target) {
                return file.map_mapped_child(edge);
            }
            match edge.kind {
                EdgeKind::Transparent => {
                    file.map_member(component, weight, unstable_answers_before, open, edge.target)
                }
                EdgeKind::Contents => file.map_shallow(edge.target, &mut OpenTypes::new()),
            }
        });
        open.pop();
        let function_types = self.take_list_of_function_types();
        let entry = MappedType { mapped, weight };
        self.keep_mapped(ty, entry, unstable_answers_before, function_types.as_deref());
        mapped
    }

    fn map_mapped_child(&mut self, edge: TypeEdge) -> Mapped {
        // The checker does not memoize a shape it cut short on a low stack, so the table can see an edge that the exploration did not.
        let Some(entry) = self.find_mapped(edge.target) else {
            return Mapped::UNKNOWN;
        };
        match edge.kind {
            EdgeKind::Contents if entry.weight.is_none() => {
                self.map_shallow(edge.target, &mut OpenTypes::new())
            }
            EdgeKind::Contents | EdgeKind::Transparent => entry.mapped,
        }
    }

    fn map_exhausted_type(
        &mut self,
        ty: CheckerTypeId,
        unstable_answers_before: u64,
        open: &mut OpenTypes,
    ) {
        open.push(ty);
        let mapped = self.map_shape(ty, &mut |file, edge| match edge.kind {
            EdgeKind::Transparent if open.contains(&edge.target) => Mapped::UNKNOWN,
            EdgeKind::Transparent => file.ensure_mapped(edge.target, open),
            EdgeKind::Contents => file.map_exhausted_contents(edge),
        });
        open.pop();
        let entry = MappedType {
            mapped,
            weight: None,
        };
        self.keep_mapped(ty, entry, unstable_answers_before, None);
    }

    fn map_exhausted_contents(&mut self, edge: TypeEdge) -> Mapped {
        if self.find_mapped(edge.target).is_none() {
            let unstable_answers_before = self.queries.count_unstable_answers();
            let Some(components) = self.explore(edge.target) else {
                return self.map_shallow(edge.target, &mut OpenTypes::new());
            };
            for component in &components {
                self.map_component(component, unstable_answers_before, &mut OpenTypes::new());
            }
        }
        self.map_mapped_child(edge)
    }

    fn map_shallow(&mut self, ty: CheckerTypeId, open: &mut OpenTypes) -> Mapped {
        if let Some(mapped) = self.find_shallow(ty) {
            return mapped;
        }
        if open.contains(&ty) {
            return Mapped::UNKNOWN;
        }
        open.push(ty);
        let mapped = self.map_shape(ty, &mut |file, edge| match edge.kind {
            EdgeKind::Transparent => file.map_shallow(edge.target, open),
            EdgeKind::Contents => Mapped::UNKNOWN,
        });
        open.pop();
        self.keep_shallow(ty, mapped);
        mapped
    }
}

fn is_member(component: &Component, ty: CheckerTypeId) -> bool {
    component.iter().any(|member| member.ty == ty)
}
