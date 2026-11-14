use super::numbering::Numbering;
use super::unit::LinkUnit;
use crate::ir::generated::{Layout, LayoutKind};
use crate::ir::{Id, LayoutId, PropertyKeyId};
use crate::lower::NameOfHeir;
use rustc_hash::{FxHashMap, FxHashSet};

fn collect_names(units: &[LinkUnit], numbering: &Numbering) -> Vec<NameOfHeir> {
    let mut names = Vec::new();
    for unit in units {
        if unit.names_of_heirs.is_empty() {
            continue;
        }
        let ids = &numbering.tables[unit.tables as usize];
        names.extend(unit.names_of_heirs.iter().filter_map(|name| {
            Some(NameOfHeir {
                heir: ids.layouts[name.heir.index()]?,
                name: ids.property_keys[name.name.index()]?,
                ..*name
            })
        }));
    }
    names.sort_unstable();
    names.dedup();
    names
}

struct Classes<'a> {
    layouts: &'a [Layout],
    heirs: FxHashSet<LayoutId>,
    has_class_below: Vec<bool>,
    holders: FxHashMap<PropertyKeyId, Vec<LayoutId>>,
}

impl<'a> Classes<'a> {
    fn new(layouts: &'a [Layout], names: &[NameOfHeir]) -> Classes<'a> {
        let heirs: FxHashSet<LayoutId> = names.iter().map(|name| name.heir).collect();
        let keys: FxHashSet<PropertyKeyId> = names.iter().map(|name| name.name).collect();
        let mut has_class_below = vec![false; layouts.len()];
        let mut holders: FxHashMap<PropertyKeyId, Vec<LayoutId>> = FxHashMap::default();
        for (index, layout) in layouts.iter().enumerate() {
            if let Some(base) = layout.base {
                has_class_below[base.index()] = true;
            }
            let id = LayoutId::new(index);
            if layout.kind != LayoutKind::Instance
                || layout.constructor.is_none()
                || heirs.contains(&id)
            {
                continue;
            }
            for key in layout.fields.iter().filter_map(|field| field.key) {
                if keys.contains(&key) {
                    holders.entry(key).or_default().push(id);
                }
            }
        }
        Classes {
            layouts,
            heirs,
            has_class_below,
            holders,
        }
    }

    fn row_of(&self, class: LayoutId) -> Option<Vec<LayoutId>> {
        let mut row = vec![class];
        let mut current = class;
        while let Some(base) = self.layouts[current.index()].base {
            if row.contains(&base) {
                return None;
            }
            row.push(base);
            current = base;
        }
        (!row.iter().any(|class| self.heirs.contains(class))).then_some(row)
    }

    fn find_parent(&self, names: &[NameOfHeir]) -> Option<LayoutId> {
        let holders = names.iter().filter_map(|name| self.holders.get(&name.name));
        let fewest = holders.clone().min_by_key(|holders| holders.len())?;
        let has_all = |&candidate: &LayoutId| {
            !self.has_class_below[candidate.index()]
                && self.row_of(candidate).is_some_and(|row| {
                    (holders.clone()).all(|of_name| row.iter().any(|it| of_name.contains(it)))
                })
        };
        let mut candidates = fewest.iter().copied().filter(has_all);
        let parent = candidates.next()?;
        candidates.next().is_none().then_some(parent)
    }
}

pub(super) fn expect_parents_by_names(
    layouts: &mut [Layout],
    units: &[LinkUnit],
    numbering: &Numbering,
) {
    let names = collect_names(units, numbering);
    if names.is_empty() {
        return;
    }
    let classes = Classes::new(layouts, &names);
    let mut found: Vec<(LayoutId, LayoutId)> = names
        .chunk_by(|left, right| left.heir == right.heir)
        .filter(|of_heir| {
            !of_heir[0].parent_is_parameter || !classes.has_class_below[of_heir[0].heir.index()]
        })
        .filter_map(|of_heir| Some((classes.find_parent(of_heir)?, of_heir[0].heir)))
        .collect();
    found.sort_unstable();
    for of_parent in found.chunk_by(|left, right| left.0 == right.0) {
        if let &[(parent, heir)] = of_parent {
            let layout = &mut layouts[heir.index()];
            if layout.base.is_none() {
                layout.base = Some(parent);
            }
        }
    }
}
