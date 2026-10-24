use smallvec::SmallVec;

use super::{ChildTypes, Component, EdgeKind, Exploration, MappedType, Reach, TypeEdge};
use crate::ir::generated::LimitId;
use crate::ir::{Id, Mapped, TypeTable};
use crate::lower::{CheckerTypeId, FileLowering};

type OpenTypes = SmallVec<[CheckerTypeId; 4]>;

#[derive(Copy, Clone)]
struct Verdict {
    weight: u32,
    is_oversized: bool,
}

impl Verdict {
    const OVERSIZED: Verdict = Verdict {
        weight: u32::MAX,
        is_oversized: true,
    };
}

struct ComponentChildren<'x> {
    component: &'x Component,
    verdict: Verdict,
    open: &'x mut OpenTypes,
}

struct ExhaustedChildren<'x> {
    position: u32,
    open: &'x mut OpenTypes,
}

struct ShallowChildren<'x> {
    open: &'x mut OpenTypes,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn ensure_mapped(&mut self, ty: CheckerTypeId, position: u32) -> MappedType {
        self.ensure_mapped_within(ty, position, &mut OpenTypes::new())
    }

    fn ensure_mapped_within(
        &mut self,
        ty: CheckerTypeId,
        position: u32,
        open: &mut OpenTypes,
    ) -> MappedType {
        if let Some(&entry) = self.types.mapped.get(&ty) {
            return entry;
        }
        match self.explore(ty) {
            Exploration::Complete(components) => {
                for component in &components {
                    self.map_component(component, position, open);
                }
            }
            Exploration::Exhausted => self.map_exhausted_type(ty, position, open),
        }
        self.types.mapped[&ty]
    }

    fn map_component(&mut self, component: &Component, position: u32, open: &mut OpenTypes) {
        if self.types.mapped.contains_key(&component.members[0].ty) {
            return;
        }
        let verdict = self.judge_component(component);
        if verdict.is_oversized {
            self.gave_up(LimitId::MaxTypeNodes, position);
        }
        for member in &component.members {
            self.map_member(component, verdict, open, member.ty);
        }
    }

    fn judge_component(&mut self, component: &Component) -> Verdict {
        let mut targets: SmallVec<[CheckerTypeId; 8]> = component
            .members
            .iter()
            .flat_map(|member| &member.edges)
            .map(|edge| edge.target)
            .filter(|&target| !is_member(component, target))
            .collect();
        targets.sort_unstable_by_key(|target| target.0);
        targets.dedup();
        let mut weight = u32::try_from(component.members.len()).unwrap_or(u32::MAX);
        let mut reaches_oversized_type = false;
        for target in targets {
            let Some(entry) = self.types.mapped.get(&target) else {
                debug_assert!(false, "components arrive after what they reach");
                continue;
            };
            weight = weight.saturating_add(entry.weight);
            reaches_oversized_type |= entry.is_oversized;
        }
        if reaches_oversized_type {
            return Verdict::OVERSIZED;
        }
        if u64::from(weight) <= self.inputs.limits.get(LimitId::MaxTypeNodes) {
            return Verdict {
                weight,
                is_oversized: false,
            };
        }
        match self.count_reachable_types(component.members[0].ty) {
            Reach::Within(count) => Verdict {
                weight: count,
                is_oversized: false,
            },
            Reach::AboveLimit => Verdict::OVERSIZED,
        }
    }

    fn map_member(
        &mut self,
        component: &Component,
        verdict: Verdict,
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
        let mut children = ComponentChildren {
            component,
            verdict,
            open: &mut *open,
        };
        let mapped = self.map_shape(ty, &mut children);
        open.pop();
        let entry = MappedType {
            mapped,
            weight: verdict.weight,
            is_oversized: verdict.is_oversized,
        };
        self.finish_type(ty, entry);
        mapped
    }

    fn finish_type(&mut self, ty: CheckerTypeId, entry: MappedType) {
        self.types.mapped.insert(ty, entry);
        self.record_source(entry.mapped, ty);
    }

    fn record_source(&mut self, mapped: Mapped, ty: CheckerTypeId) {
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
            EdgeKind::Contents if entry.is_oversized => self.map_shallow(edge.target),
            EdgeKind::Contents | EdgeKind::Transparent => entry.mapped,
        }
    }

    fn map_exhausted_type(&mut self, ty: CheckerTypeId, position: u32, open: &mut OpenTypes) {
        self.gave_up(LimitId::MaxTypeNodes, position);
        open.push(ty);
        let mut children = ExhaustedChildren {
            position,
            open: &mut *open,
        };
        let mapped = self.map_shape(ty, &mut children);
        open.pop();
        let entry = MappedType {
            mapped,
            weight: u32::MAX,
            is_oversized: true,
        };
        self.finish_type(ty, entry);
    }

    fn map_exhausted_contents(&mut self, edge: TypeEdge, position: u32) -> Mapped {
        if !self.types.mapped.contains_key(&edge.target) {
            match self.explore(edge.target) {
                Exploration::Exhausted => return self.map_shallow(edge.target),
                Exploration::Complete(components) => {
                    for component in &components {
                        self.map_component(component, position, &mut OpenTypes::new());
                    }
                }
            }
        }
        self.map_mapped_child(edge)
    }

    pub(super) fn map_shallow(&mut self, ty: CheckerTypeId) -> Mapped {
        self.map_shallow_within(ty, &mut OpenTypes::new())
    }

    fn map_shallow_within(&mut self, ty: CheckerTypeId, open: &mut OpenTypes) -> Mapped {
        if let Some(&mapped) = self.types.shallow.get(&ty) {
            return mapped;
        }
        if open.contains(&ty) {
            return Mapped::UNKNOWN;
        }
        open.push(ty);
        let mut children = ShallowChildren { open: &mut *open };
        let mapped = self.map_shape(ty, &mut children);
        open.pop();
        self.types.shallow.insert(ty, mapped);
        mapped
    }
}

fn is_member(component: &Component, ty: CheckerTypeId) -> bool {
    component.members.iter().any(|member| member.ty == ty)
}

impl ChildTypes for ComponentChildren<'_> {
    fn map_child(&mut self, file: &mut FileLowering<'_, '_, '_, '_>, edge: TypeEdge) -> Mapped {
        if !is_member(self.component, edge.target) {
            return file.map_mapped_child(edge);
        }
        match edge.kind {
            EdgeKind::Transparent => {
                file.map_member(self.component, self.verdict, self.open, edge.target)
            }
            EdgeKind::Contents => file.map_shallow(edge.target),
        }
    }
}

impl ChildTypes for ExhaustedChildren<'_> {
    fn map_child(&mut self, file: &mut FileLowering<'_, '_, '_, '_>, edge: TypeEdge) -> Mapped {
        match edge.kind {
            EdgeKind::Transparent if self.open.contains(&edge.target) => Mapped::UNKNOWN,
            EdgeKind::Transparent => {
                file.ensure_mapped_within(edge.target, self.position, self.open)
                    .mapped
            }
            EdgeKind::Contents => file.map_exhausted_contents(edge, self.position),
        }
    }
}

impl ChildTypes for ShallowChildren<'_> {
    fn map_child(&mut self, file: &mut FileLowering<'_, '_, '_, '_>, edge: TypeEdge) -> Mapped {
        match edge.kind {
            EdgeKind::Transparent => file.map_shallow_within(edge.target, self.open),
            EdgeKind::Contents => Mapped::UNKNOWN,
        }
    }
}
