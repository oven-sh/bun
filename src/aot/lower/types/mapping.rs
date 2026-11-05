use smallvec::SmallVec;

use super::{Component, EdgeKind, ExploredType, MappedType, TypeEdge};
use crate::ir::Mapped;
use crate::ir::generated::LimitId;
use crate::lower::{CheckerTypeId, FileLowering};

type OpenTypes = SmallVec<[CheckerTypeId; 4]>;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn map_type_at(&mut self, ty: CheckerTypeId) -> Mapped {
        let row = self.queries.row_of_type(ty) as usize;
        match self.find_mapped_in_row(row) {
            Some(entry) => entry.mapped,
            None => self.map_type_anew(ty, row, &mut OpenTypes::new()),
        }
    }

    fn ensure_mapped(&mut self, ty: CheckerTypeId, open: &mut OpenTypes) -> Mapped {
        let row = self.queries.row_of_type(ty) as usize;
        match self.find_mapped_in_row(row) {
            Some(entry) => entry.mapped,
            None => self.map_type_anew(ty, row, open),
        }
    }

    fn map_type_anew(&mut self, ty: CheckerTypeId, row: usize, open: &mut OpenTypes) -> Mapped {
        let unstable_answers_before = self.queries.count_unstable_answers();
        match self.explore(ty) {
            Some(components) => {
                for component in components.iter() {
                    self.map_component(component, unstable_answers_before, open);
                }
            }
            None => self.map_exhausted_type(ty, row, unstable_answers_before, open),
        }
        let entry = self.find_mapped_in_row(row);
        debug_assert!(entry.is_some(), "the last component holds the type");
        entry.map_or(Mapped::UNKNOWN, |entry| entry.mapped)
    }

    fn map_component(
        &mut self,
        component: &Component,
        unstable_answers_before: u64,
        open: &mut OpenTypes,
    ) {
        let component: &[ExploredType] = component;
        let first_row = self.queries.row_of_type(component[0].ty) as usize;
        if self.find_mapped_in_row(first_row).is_some() {
            return;
        }
        if let [alone] = component
            && self.meet_again(alone, first_row)
        {
            return;
        }
        let weight = self.weigh_component(component);
        for (index, member) in component.iter().enumerate() {
            let row = match index {
                0 => first_row,
                _ => self.queries.row_of_type(member.ty) as usize,
            };
            self.map_member(
                component,
                weight,
                unstable_answers_before,
                open,
                member.ty,
                row,
            );
        }
    }

    fn weigh_component(&mut self, component: &[ExploredType]) -> Option<u32> {
        let mut targets: SmallVec<[CheckerTypeId; 8]> = SmallVec::new();
        for member in component {
            for edge in member.edges.iter() {
                if !is_member(component, edge.target) {
                    targets.push(edge.target);
                }
            }
        }
        if targets.len() > 1 {
            targets.sort_unstable_by_key(|target| target.0);
            targets.dedup();
        }
        let mut weight = Some(u32::try_from(component.len()).unwrap_or(u32::MAX));
        for &target in targets.iter() {
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
        component: &[ExploredType],
        weight: Option<u32>,
        unstable_answers_before: u64,
        open: &mut OpenTypes,
        ty: CheckerTypeId,
        row: usize,
    ) -> Mapped {
        if let Some(entry) = self.find_mapped_in_row(row) {
            return entry.mapped;
        }
        if !open.is_empty() && open.contains(&ty) {
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
                    let row = file.queries.row_of_type(edge.target) as usize;
                    file.map_member(
                        component,
                        weight,
                        unstable_answers_before,
                        open,
                        edge.target,
                        row,
                    )
                }
                EdgeKind::Contents => file.map_shallow(edge.target, &mut OpenTypes::new()),
            }
        });
        open.pop();
        let function_types = self.take_list_of_function_types();
        let entry = MappedType { mapped, weight };
        self.keep_mapped(
            ty,
            row,
            entry,
            unstable_answers_before,
            function_types.as_deref(),
        );
        mapped
    }

    fn map_mapped_child(&mut self, edge: TypeEdge) -> Mapped {
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
        row: usize,
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
        self.keep_mapped(ty, row, entry, unstable_answers_before, None);
    }

    fn map_exhausted_contents(&mut self, edge: TypeEdge) -> Mapped {
        if self.find_mapped(edge.target).is_none() {
            let unstable_answers_before = self.queries.count_unstable_answers();
            let Some(components) = self.explore(edge.target) else {
                return self.map_shallow(edge.target, &mut OpenTypes::new());
            };
            for component in components.iter() {
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

fn is_member(component: &[ExploredType], ty: CheckerTypeId) -> bool {
    component.iter().any(|member| member.ty == ty)
}
