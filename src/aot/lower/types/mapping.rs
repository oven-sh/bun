use smallvec::SmallVec;

use super::{Component, EdgeKind, MappedType, TypeEdge};
use crate::ir::generated::LimitId;
use crate::ir::{Id, Mapped, TypeTable};
use crate::lower::{CheckerTypeId, FileLowering};

type OpenTypes = SmallVec<[CheckerTypeId; 4]>;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn map_type_at(&mut self, ty: CheckerTypeId, position: u32) -> Mapped {
        self.ensure_mapped(ty, position, &mut OpenTypes::new())
    }

    fn ensure_mapped(&mut self, ty: CheckerTypeId, position: u32, open: &mut OpenTypes) -> Mapped {
        if let Some(entry) = self.types.mapped.get(&ty) {
            return entry.mapped;
        }
        match self.explore(ty) {
            Some(components) => {
                for component in &components {
                    self.map_component(component, position, open);
                }
            }
            None => self.map_exhausted_type(ty, position, open),
        }
        self.types.mapped[&ty].mapped
    }

    fn map_component(&mut self, component: &Component, position: u32, open: &mut OpenTypes) {
        if self.types.mapped.contains_key(&component[0].ty) {
            return;
        }
        let weight = self.weigh_component(component);
        if weight.is_none() {
            self.gave_up(LimitId::MaxTypeNodes, position);
        }
        for member in component {
            self.map_member(component, weight, open, member.ty);
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
            let Some(entry) = self.types.mapped.get(&target) else {
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
        open: &mut OpenTypes,
        ty: CheckerTypeId,
    ) -> Mapped {
        if let Some(entry) = self.types.mapped.get(&ty) {
            return entry.mapped;
        }
        if open.contains(&ty) {
            return Mapped::UNKNOWN;
        }
        open.push(ty);
        let mapped = self.map_shape(ty, &mut |file, edge| {
            if !is_member(component, edge.target) {
                return file.map_mapped_child(edge);
            }
            match edge.kind {
                EdgeKind::Transparent => file.map_member(component, weight, open, edge.target),
                EdgeKind::Contents => file.map_shallow(edge.target, &mut OpenTypes::new()),
            }
        });
        open.pop();
        self.finish_type(ty, mapped, weight);
        mapped
    }

    fn finish_type(&mut self, ty: CheckerTypeId, mapped: Mapped, weight: Option<u32>) {
        self.types.mapped.insert(ty, MappedType { mapped, weight });
        if mapped.ty.index() >= TypeTable::WELL_KNOWN_COUNT {
            self.types.sources.entry(mapped.ty).or_insert(ty);
        }
    }

    fn map_mapped_child(&mut self, edge: TypeEdge) -> Mapped {
        // The checker does not memoize a shape it cut short on a low stack, so the table can see an edge that the exploration did not.
        let Some(&entry) = self.types.mapped.get(&edge.target) else {
            return Mapped::UNKNOWN;
        };
        match edge.kind {
            EdgeKind::Contents if entry.weight.is_none() => {
                self.map_shallow(edge.target, &mut OpenTypes::new())
            }
            EdgeKind::Contents | EdgeKind::Transparent => entry.mapped,
        }
    }

    fn map_exhausted_type(&mut self, ty: CheckerTypeId, position: u32, open: &mut OpenTypes) {
        self.gave_up(LimitId::MaxTypeNodes, position);
        open.push(ty);
        let mapped = self.map_shape(ty, &mut |file, edge| match edge.kind {
            EdgeKind::Transparent if open.contains(&edge.target) => Mapped::UNKNOWN,
            EdgeKind::Transparent => file.ensure_mapped(edge.target, position, open),
            EdgeKind::Contents => file.map_exhausted_contents(edge, position),
        });
        open.pop();
        self.finish_type(ty, mapped, None);
    }

    fn map_exhausted_contents(&mut self, edge: TypeEdge, position: u32) -> Mapped {
        if !self.types.mapped.contains_key(&edge.target) {
            let Some(components) = self.explore(edge.target) else {
                return self.map_shallow(edge.target, &mut OpenTypes::new());
            };
            for component in &components {
                self.map_component(component, position, &mut OpenTypes::new());
            }
        }
        self.map_mapped_child(edge)
    }

    fn map_shallow(&mut self, ty: CheckerTypeId, open: &mut OpenTypes) -> Mapped {
        if let Some(&mapped) = self.types.shallow.get(&ty) {
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
        self.types.shallow.insert(ty, mapped);
        mapped
    }
}

fn is_member(component: &Component, ty: CheckerTypeId) -> bool {
    component.iter().any(|member| member.ty == ty)
}
