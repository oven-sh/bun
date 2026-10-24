use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

use super::shape_edges::collect_edges;
use super::{Component, Exploration, ExploredType, Reach, TypeEdges};
use crate::ir::generated::LimitId;
use crate::lower::{CheckerTypeId, FileLowering};

#[derive(Copy, Clone)]
enum NodeState {
    Open { index: u32 },
    Closed,
}

struct Visit {
    ty: CheckerTypeId,
    edges: TypeEdges,
    next_edge: usize,
    index: u32,
    lowest_link: u32,
    open_start: usize,
}

/// Empty between two walks, which use their memory one after the other.
#[derive(Default)]
pub(super) struct WalkTables {
    states: FxHashMap<CheckerTypeId, NodeState>,
    open: Vec<ExploredType>,
    path: Vec<Visit>,
}

struct Walk {
    states: FxHashMap<CheckerTypeId, NodeState>,
    open: Vec<ExploredType>,
    path: Vec<Visit>,
    components: SmallVec<[Component; 1]>,
}

impl Walk {
    fn begin(tables: WalkTables) -> Walk {
        let WalkTables { states, open, path } = tables;
        Walk {
            states,
            open,
            path,
            components: SmallVec::new(),
        }
    }

    fn end(self) -> (WalkTables, SmallVec<[Component; 1]>) {
        let Walk {
            mut states,
            mut open,
            mut path,
            components,
        } = self;
        states.clear();
        open.clear();
        path.clear();
        (WalkTables { states, open, path }, components)
    }
}

fn enter_type(walk: &mut Walk, ty: CheckerTypeId, edges: TypeEdges) {
    let index = walk.states.len() as u32;
    walk.states.insert(ty, NodeState::Open { index });
    walk.path.push(Visit {
        ty,
        edges,
        next_edge: 0,
        index,
        lowest_link: index,
        open_start: walk.open.len(),
    });
}

fn leave_type(walk: &mut Walk) {
    let Some(finished) = walk.path.pop() else {
        return;
    };
    walk.open.push(ExploredType {
        ty: finished.ty,
        edges: finished.edges,
    });
    if finished.lowest_link == finished.index {
        let component = Component {
            members: walk.open.drain(finished.open_start..).collect(),
        };
        for member in &component.members {
            walk.states.insert(member.ty, NodeState::Closed);
        }
        walk.components.push(component);
    }
    if let Some(parent) = walk.path.last_mut() {
        parent.lowest_link = parent.lowest_link.min(finished.lowest_link);
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn explore(&mut self, root: CheckerTypeId) -> Exploration {
        debug_assert!(
            !self.types.mapped.contains_key(&root),
            "only an unmapped type is explored"
        );
        if self.types.exhausted.contains(&root) {
            return Exploration::Exhausted;
        }
        let edges = collect_edges(self, root);
        // Most types have no part, or parts that are mapped: a component by itself, which needs no walk to be found.
        if edges
            .iter()
            .all(|edge| self.types.mapped.contains_key(&edge.target))
        {
            let members = smallvec![ExploredType { ty: root, edges }];
            return Exploration::Complete(smallvec![Component { members }]);
        }
        let mut walk = Walk::begin(core::mem::take(&mut self.types.walk));
        enter_type(&mut walk, root, edges);
        let is_complete = self.walk_from_root(&mut walk, root);
        let (tables, components) = walk.end();
        self.types.walk = tables;
        match is_complete {
            true => Exploration::Complete(components),
            false => Exploration::Exhausted,
        }
    }

    fn walk_from_root(&mut self, walk: &mut Walk, root: CheckerTypeId) -> bool {
        let limit = self.inputs.limits.get(LimitId::MaxTypeNodes);
        while let Some(visit) = walk.path.last_mut() {
            let Some(&edge) = visit.edges.get(visit.next_edge) else {
                leave_type(walk);
                continue;
            };
            visit.next_edge += 1;
            if self.types.mapped.contains_key(&edge.target) {
                continue;
            }
            if self.types.exhausted.contains(&edge.target) {
                let path = walk.path.iter().map(|visit| visit.ty);
                self.types.exhausted.extend(path);
                return false;
            }
            match walk.states.get(&edge.target).copied() {
                Some(NodeState::Closed) => {}
                Some(NodeState::Open { index }) => visit.lowest_link = visit.lowest_link.min(index),
                None if walk.states.len() as u64 >= limit => {
                    self.types.exhausted.insert(root);
                    return false;
                }
                None => {
                    let edges = collect_edges(self, edge.target);
                    enter_type(walk, edge.target, edges);
                }
            }
        }
        true
    }

    pub(super) fn count_reachable_types(&mut self, root: CheckerTypeId) -> Reach {
        let limit = self.inputs.limits.get(LimitId::MaxTypeNodes);
        let mut visited = FxHashSet::default();
        visited.insert(root);
        let mut pending = vec![root];
        while let Some(ty) = pending.pop() {
            if visited.len() as u64 > limit || self.types.exhausted.contains(&ty) {
                return Reach::AboveLimit;
            }
            for edge in collect_edges(self, ty) {
                if visited.insert(edge.target) {
                    pending.push(edge.target);
                }
            }
        }
        Reach::Within(visited.len() as u32)
    }
}
