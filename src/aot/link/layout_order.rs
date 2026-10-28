use bun_sema::util::SharedSort;

use super::keys::MergedKeys;
use super::numbering::RetainedDefinitions;
use super::program_keys::ProgramLayoutKey;
use super::state::{DefinitionSite, Definitions};
use super::unit::LinkUnit;
use crate::ir::Id;

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
    roots[defined_count..].shared_sort_unstable_by_key(|&layout| layouts.keys[layout as usize]);

    order_layouts(layouts.keys.len(), &roots, &|layout| {
        let site = definitions.layouts[layout as usize]?;
        let unit = site.unit as usize;
        let (_, definition) = &units[unit].layout_definitions[site.index as usize];
        Some(layouts.local_to_merged[unit][definition.base?.index()])
    })
}

fn order_layouts(
    layout_count: usize,
    roots: &[u32],
    base_of: &dyn Fn(u32) -> Option<u32>,
) -> Vec<u32> {
    let mut is_visited = vec![false; layout_count];
    let mut order = Vec::with_capacity(roots.len());
    let mut chain = Vec::new();
    for &root in roots {
        let mut next = Some(root);
        while let Some(layout) = next
            && !core::mem::replace(&mut is_visited[layout as usize], true)
        {
            chain.push(layout);
            next = base_of(layout);
        }
        order.extend(chain.drain(..).rev());
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order_by_edges(roots: &[u32], edges: &[(u32, u32)]) -> Vec<u32> {
        order_layouts(roots.len(), roots, &|layout| {
            let own_edge = edges.iter().find(|edge| edge.0 == layout);
            own_edge.map(|edge| edge.1)
        })
    }

    #[test]
    fn bases_precede_roots() {
        assert_eq!(order_by_edges(&[2, 0, 1], &[]), [2, 0, 1]);
        assert_eq!(order_by_edges(&[0, 1], &[(0, 1)]), [1, 0]);
        assert_eq!(order_by_edges(&[0, 1, 2], &[(0, 2), (1, 2)]), [2, 0, 1]);
    }

    #[test]
    fn long_base_chain_is_ordered() {
        let roots: Vec<u32> = (0..10_000).collect();
        let order = order_layouts(roots.len(), &roots, &|layout| (layout + 1..10_000).next());
        assert!(order.iter().rev().eq(&roots));
    }

    #[test]
    fn cycle_lists_each_layout_once() {
        assert_eq!(order_by_edges(&[0, 1], &[(0, 1), (1, 0)]), [1, 0]);
        assert_eq!(order_by_edges(&[1, 0], &[(0, 1), (1, 0)]), [0, 1]);
    }
}
