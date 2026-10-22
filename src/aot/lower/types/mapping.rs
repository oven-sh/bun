use smallvec::SmallVec;

use super::exploration::{count_reachable_types, explore};
use super::shape_table::map_shape;
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

pub(super) fn ensure_mapped(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    position: u32,
) -> MappedType {
    ensure_mapped_within(file, ty, position, &mut OpenTypes::new())
}

fn ensure_mapped_within(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    position: u32,
    open: &mut OpenTypes,
) -> MappedType {
    if let Some(&entry) = file.types.mapped.get(&ty) {
        return entry;
    }
    match explore(file, ty) {
        Exploration::Complete(components) => {
            for component in &components {
                map_component(file, component, position, open);
            }
        }
        Exploration::Exhausted => map_exhausted_type(file, ty, position, open),
    }
    file.types.mapped[&ty]
}

fn map_component(
    file: &mut FileLowering<'_, '_, '_, '_>,
    component: &Component,
    position: u32,
    open: &mut OpenTypes,
) {
    if file.types.mapped.contains_key(&component.members[0].ty) {
        return;
    }
    let verdict = judge_component(file, component);
    if verdict.is_oversized {
        file.gave_up(LimitId::MaxTypeNodes, position);
    }
    for member in &component.members {
        map_member(file, component, verdict, open, member.ty);
    }
}

fn judge_component(file: &mut FileLowering<'_, '_, '_, '_>, component: &Component) -> Verdict {
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
        let Some(entry) = file.types.mapped.get(&target) else {
            debug_assert!(false, "components arrive after what they reach");
            continue;
        };
        weight = weight.saturating_add(entry.weight);
        reaches_oversized_type |= entry.is_oversized;
    }
    if reaches_oversized_type {
        return Verdict::OVERSIZED;
    }
    if u64::from(weight) <= file.inputs.limits.get(LimitId::MaxTypeNodes) {
        return Verdict {
            weight,
            is_oversized: false,
        };
    }
    match count_reachable_types(file, component.members[0].ty) {
        Reach::Within(count) => Verdict {
            weight: count,
            is_oversized: false,
        },
        Reach::AboveLimit => Verdict::OVERSIZED,
    }
}

fn is_member(component: &Component, ty: CheckerTypeId) -> bool {
    component.members.iter().any(|member| member.ty == ty)
}

fn map_member(
    file: &mut FileLowering<'_, '_, '_, '_>,
    component: &Component,
    verdict: Verdict,
    open: &mut OpenTypes,
    ty: CheckerTypeId,
) -> Mapped {
    if let Some(entry) = file.types.mapped.get(&ty) {
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
    let mapped = map_shape(file, ty, &mut children);
    open.pop();
    let entry = MappedType {
        mapped,
        weight: verdict.weight,
        is_oversized: verdict.is_oversized,
    };
    finish_type(file, ty, entry);
    mapped
}

fn finish_type(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId, entry: MappedType) {
    file.types.mapped.insert(ty, entry);
    record_source(file, entry.mapped, ty);
}

fn record_source(file: &mut FileLowering<'_, '_, '_, '_>, mapped: Mapped, ty: CheckerTypeId) {
    if mapped.ty.index() >= TypeTable::WELL_KNOWN_COUNT {
        file.types.sources.entry(mapped.ty).or_insert(ty);
    }
}

impl ChildTypes for ComponentChildren<'_> {
    fn map_child(&mut self, file: &mut FileLowering<'_, '_, '_, '_>, edge: TypeEdge) -> Mapped {
        if !is_member(self.component, edge.target) {
            return map_mapped_child(file, edge);
        }
        match edge.kind {
            EdgeKind::Transparent => {
                map_member(file, self.component, self.verdict, self.open, edge.target)
            }
            EdgeKind::Contents => map_shallow(file, edge.target),
        }
    }
}

fn map_mapped_child(file: &mut FileLowering<'_, '_, '_, '_>, edge: TypeEdge) -> Mapped {
    // The checker does not memoize a shape it cut short on a low stack, so the table can see an edge that the exploration did not.
    let Some(&entry) = file.types.mapped.get(&edge.target) else {
        return Mapped::UNKNOWN;
    };
    match edge.kind {
        EdgeKind::Contents if entry.is_oversized => map_shallow(file, edge.target),
        EdgeKind::Contents | EdgeKind::Transparent => entry.mapped,
    }
}

fn map_exhausted_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    position: u32,
    open: &mut OpenTypes,
) {
    file.gave_up(LimitId::MaxTypeNodes, position);
    open.push(ty);
    let mut children = ExhaustedChildren {
        position,
        open: &mut *open,
    };
    let mapped = map_shape(file, ty, &mut children);
    open.pop();
    let entry = MappedType {
        mapped,
        weight: u32::MAX,
        is_oversized: true,
    };
    finish_type(file, ty, entry);
}

impl ChildTypes for ExhaustedChildren<'_> {
    fn map_child(&mut self, file: &mut FileLowering<'_, '_, '_, '_>, edge: TypeEdge) -> Mapped {
        match edge.kind {
            EdgeKind::Transparent if self.open.contains(&edge.target) => Mapped::UNKNOWN,
            EdgeKind::Transparent => {
                ensure_mapped_within(file, edge.target, self.position, self.open).mapped
            }
            EdgeKind::Contents => map_exhausted_contents(file, edge, self.position),
        }
    }
}

fn map_exhausted_contents(
    file: &mut FileLowering<'_, '_, '_, '_>,
    edge: TypeEdge,
    position: u32,
) -> Mapped {
    if !file.types.mapped.contains_key(&edge.target) {
        match explore(file, edge.target) {
            Exploration::Exhausted => return map_shallow(file, edge.target),
            Exploration::Complete(components) => {
                for component in &components {
                    map_component(file, component, position, &mut OpenTypes::new());
                }
            }
        }
    }
    map_mapped_child(file, edge)
}

pub(super) fn map_shallow(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Mapped {
    map_shallow_within(file, ty, &mut OpenTypes::new())
}

fn map_shallow_within(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    open: &mut OpenTypes,
) -> Mapped {
    if let Some(&mapped) = file.types.shallow.get(&ty) {
        return mapped;
    }
    if open.contains(&ty) {
        return Mapped::UNKNOWN;
    }
    open.push(ty);
    let mut children = ShallowChildren { open: &mut *open };
    let mapped = map_shape(file, ty, &mut children);
    open.pop();
    file.types.shallow.insert(ty, mapped);
    mapped
}

impl ChildTypes for ShallowChildren<'_> {
    fn map_child(&mut self, file: &mut FileLowering<'_, '_, '_, '_>, edge: TypeEdge) -> Mapped {
        match edge.kind {
            EdgeKind::Transparent => map_shallow_within(file, edge.target, self.open),
            EdgeKind::Contents => Mapped::UNKNOWN,
        }
    }
}
