//! Most of the image can never be removed, whatever is excluded. The table does not have to tell those pieces apart.
//!
//! A unit that is reached from the roots over unconditional edges alone is live in every configuration. A piece made of
//! such units only is CORE. Neighbouring core pieces of an area always move together, so they become one piece. A core piece
//! outside every area neither moves nor dies, which is what "in no unit" means, so it leaves the table.

use crate::table::{Container, Fixup, Flow, Form, NO_UNIT, ROOT, STARTS_PIECE, Table, Unit};

pub(crate) fn merge(t: &Table) -> Table {
    // ---- live in every configuration
    let mut is_always_live = vec![false; t.units.len()];
    let mut work: Vec<u32> = Vec::new();
    let touch = |unit: u32, is_always_live: &mut [bool], work: &mut Vec<u32>| {
        if unit != NO_UNIT && !is_always_live[unit as usize] {
            is_always_live[unit as usize] = true;
            work.push(unit);
        }
    };
    for (u, unit) in t.units.iter().enumerate() {
        if unit.flags & ROOT != 0 {
            touch(u as u32, &mut is_always_live, &mut work);
        }
    }
    for f in t
        .fixups
        .iter()
        .filter(|f| !f.form.is_weak() && t.unit_at(f.place) == NO_UNIT)
    {
        touch(f.target, &mut is_always_live, &mut work);
    }
    while let Some(u) = work.pop() {
        let unit = &t.units[u as usize];
        for f in t
            .fixups_in(unit.start, unit.end())
            .iter()
            .filter(|f| !f.form.is_weak())
        {
            touch(f.target, &mut is_always_live, &mut work);
        }
        for flow in t.flows_from(u).iter().filter(|flow| flow.condition == 0) {
            touch(flow.to, &mut is_always_live, &mut work);
        }
    }

    // ---- new units
    // The Mach-O header is a unit that moves though it is in no area.
    let is_header = |u: usize| t.format.container == Container::MachO && u == 0;
    let mut units: Vec<Unit> = Vec::new();
    let mut new_unit = vec![NO_UNIT; t.units.len()];
    // The core piece that the next core piece of the same area joins.
    let mut open: Option<(usize, usize)> = None;
    let mut first = 0;
    while first < t.units.len() {
        let next = t.units[first + 1..]
            .iter()
            .position(|u| u.starts_piece())
            .map_or(t.units.len(), |n| first + 1 + n);
        let is_core = is_always_live[first..next].iter().all(|&live| live);
        match t.area_of(t.units[first].start) {
            None if is_core && !is_header(first) => open = None,
            Some(area) if is_core => {
                let end = t.units[next - 1].end();
                let joined = match open {
                    Some((unit, of_area)) if of_area == area => {
                        units[unit].size = end - units[unit].start;
                        units[unit].log2_align =
                            units[unit].log2_align.max(t.units[first].log2_align);
                        unit
                    }
                    _ => {
                        let start = t.units[first].start;
                        units.push(Unit {
                            start,
                            size: end - start,
                            flags: STARTS_PIECE | ROOT,
                            log2_align: t.units[first].log2_align,
                        });
                        units.len() - 1
                    }
                };
                open = Some((joined, area));
                new_unit[first..next].fill(joined as u32);
            }
            _ => {
                open = None;
                for u in first..next {
                    new_unit[u] = units.len() as u32;
                    units.push(t.units[u]);
                }
            }
        }
        first = next;
    }

    // ---- edges and fixups, in terms of the new units
    let renamed = |unit: u32| {
        if unit == NO_UNIT {
            NO_UNIT
        } else {
            new_unit[unit as usize]
        }
    };
    let flows = t
        .flows
        .iter()
        .map(|f| Flow {
            from: renamed(f.from),
            to: renamed(f.to),
            condition: f.condition,
        })
        .filter(|f| f.from != NO_UNIT && f.to != NO_UNIT && f.from != f.to)
        .collect();
    let moves = |unit: u32| {
        unit != NO_UNIT
            && (t.area_of(units[unit as usize].start).is_some() || is_header(unit as usize))
    };
    let mut fixups: Vec<Fixup> = t
        .fixups
        .iter()
        .filter_map(|f| {
            let (from, to) = (renamed(t.unit_at(f.place)), renamed(f.target));
            // Nothing to patch and no edge: neither end moves, and the target cannot die.
            if !moves(from) && to == NO_UNIT {
                return None;
            }
            if f.form == Form::None && (to == NO_UNIT || from == to) {
                return None;
            }
            // A distance inside one piece does not change. (Not so for `adrp`, which counts in pages.)
            if from == to && matches!(f.form, Form::Rel32 | Form::Rel64 | Form::Branch26) {
                return None;
            }
            // Of what stays, an `adrp` needs no more than the page.
            let extra = if f.form == Form::Page21 && to == NO_UNIT {
                0
            } else {
                f.extra
            };
            Some(Fixup {
                target: to,
                extra,
                ..*f
            })
        })
        .collect();
    fixups.sort_unstable();
    Table {
        units,
        flows,
        fixups,
        ..t.clone_header()
    }
}

impl Table {
    fn clone_header(&self) -> Self {
        Self {
            format: self.format,
            features: self.features.clone(),
            areas: self.areas.clone(),
            code: self.code.clone(),
            patches: self.patches.clone(),
            units: Vec::new(),
            flows: Vec::new(),
            fixups: Vec::new(),
        }
    }
}
