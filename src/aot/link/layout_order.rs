use super::keys::MergedKeys;
use super::numbering::RetainedDefinitions;
use super::program_keys::ProgramLayoutKey;
use super::state::{DefinitionSite, Definitions};
use super::unit::LinkUnit;
use crate::ir::Id;
use smallvec::SmallVec;

type Predecessors = SmallVec<[u32; 4]>;

struct LayoutGraph<'a> {
    units: &'a [LinkUnit],
    local_to_merged: &'a [Vec<u32>],
    definitions: &'a Definitions,
}

impl LayoutGraph<'_> {
    fn predecessors(&self, layout: u32) -> Predecessors {
        let Some(site) = self.definitions.layouts[layout as usize] else {
            return Predecessors::new();
        };
        let unit = site.unit as usize;
        let (_, definition) = &self.units[unit].layout_definitions[site.index as usize];
        let local_to_merged = &self.local_to_merged[unit];
        let predecessors = definition.base.into_iter();
        predecessors.map(|id| local_to_merged[id.index()]).collect()
    }
}

pub(super) fn order_program_layouts(
    units: &[LinkUnit],
    layouts: &MergedKeys<ProgramLayoutKey>,
    definitions: &Definitions,
    defined: &RetainedDefinitions<'_, DefinitionSite>,
) -> Vec<u32> {
    let layout_lists = units.iter().map(|unit| &unit.layout_definitions);
    let mut roots: Vec<u32> = defined.in_units(layout_lists).collect();
    let defined_count = roots.len();
    roots.extend(defined.without_definition());
    roots[defined_count..].sort_unstable_by_key(|&layout| layouts.keys[layout as usize]);

    let graph = LayoutGraph {
        units,
        local_to_merged: &layouts.local_to_merged,
        definitions,
    };
    order_layouts(layouts.keys.len(), &roots, &|layout| graph.predecessors(layout))
}

#[derive(Copy, Clone)]
enum Visit {
    New,
    Open,
    Done,
}

fn order_layouts(
    layout_count: usize,
    roots: &[u32],
    predecessors_of: &dyn Fn(u32) -> Predecessors,
) -> Vec<u32> {
    let mut visits = vec![Visit::New; layout_count];
    let mut stack: Vec<(u32, smallvec::IntoIter<[u32; 4]>)> = Vec::new();
    let mut order = Vec::with_capacity(roots.len());
    for &root in roots {
        let mut next = Some(root);
        loop {
            if let Some(layout) = next {
                match visits[layout as usize] {
                    Visit::New => {
                        visits[layout as usize] = Visit::Open;
                        stack.push((layout, predecessors_of(layout).into_iter()));
                    }
                    Visit::Open | Visit::Done => {}
                }
            }
            let Some((layout, predecessors)) = stack.last_mut() else {
                break;
            };
            next = predecessors.next();
            if next.is_none() {
                visits[*layout as usize] = Visit::Done;
                order.push(*layout);
                stack.pop();
            }
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order_by_edges(roots: &[u32], edges: &[(u32, u32)]) -> Vec<u32> {
        order_layouts(roots.len(), roots, &|layout| {
            let own_edges = edges.iter().filter(|edge| edge.0 == layout);
            own_edges.map(|edge| edge.1).collect()
        })
    }

    #[test]
    fn predecessors_precede_roots() {
        assert_eq!(order_by_edges(&[2, 0, 1], &[]), [2, 0, 1]);
        assert_eq!(order_by_edges(&[0, 1], &[(0, 1)]), [1, 0]);
        assert_eq!(order_by_edges(&[0, 1, 2], &[(0, 1), (0, 2)]), [1, 2, 0]);
        assert_eq!(order_by_edges(&[0, 1, 2], &[(0, 2), (1, 2)]), [2, 0, 1]);
    }

    #[test]
    fn long_base_chain_is_ordered() {
        let roots: Vec<u32> = (0..10_000).collect();
        let order = order_layouts(roots.len(), &roots, &|layout| {
            (layout + 1..10_000).take(1).collect()
        });
        assert!(order.iter().rev().eq(&roots));
    }

    #[test]
    fn cycle_lists_each_layout_once() {
        assert_eq!(order_by_edges(&[0, 1], &[(0, 1), (1, 0)]), [1, 0]);
        assert_eq!(order_by_edges(&[1, 0], &[(0, 1), (1, 0)]), [0, 1]);
    }
}
