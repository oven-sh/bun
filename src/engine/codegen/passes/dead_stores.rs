//! Removes stores that are certain to be overwritten before anything can look.

use core::ops::Range;

use super::places::Place;
use crate::analysis::Cfg;
use crate::ir::{AccessFlags, Block, EffectFlags, Function, Heap, Op, Table, Value};

const MOST_PLACES: usize = 16;

#[derive(Clone, Copy)]
struct Overwritten {
    place: Place,
    heap: Heap,
}

/// `stores` has their number, or more, for each block.
pub(super) fn remove_dead_stores(function: &mut Function, cfg: &Cfg, stores: &Table<Block, u32>) {
    if stores.values().sum::<u32>() < 2 {
        return;
    }
    let mut at_starts = Vec::new();
    // Still empty for the target of an edge that goes back.
    let mut at_start: Table<Block, Range<usize>> = function.block_table(0..0);
    let mut current: Vec<Overwritten> = Vec::with_capacity(MOST_PLACES);
    for &block in cfg.order().iter().rev() {
        let mut after = function
            .successors(block)
            .map(|edge| &at_starts[at_start[function.target(edge)].clone()]);
        current.clear();
        current.extend_from_slice(after.next().unwrap_or_default());
        for others in after {
            current.retain(|known| {
                let covers = |other: &Overwritten| other.place.covers(&known.place);
                others.iter().any(covers)
            });
        }
        let (mut value, mut stores_left) = (function.last(block), stores[block]);
        while !value.is_none() && (stores_left != 0 || !current.is_empty()) {
            let previous = function.previous(value);
            stores_left -= u32::from(go_back_over(function, value, &mut current));
            value = previous;
        }
        at_start[block] = at_starts.len()..at_starts.len() + current.len();
        at_starts.extend_from_slice(&current);
    }
}

/// Returns whether the instruction is a store.
fn go_back_over(function: &mut Function, value: Value, current: &mut Vec<Overwritten>) -> bool {
    let effects = function.effects(value);
    if effects.has(EffectFlags::EXITS) {
        current.clear();
    }
    match (*function.op(value), Place::of(function, value)) {
        (Op::Store { access, .. }, Some(place)) => {
            if current.iter().any(|later| later.place.covers(&place)) {
                function.remove(value);
            } else if !access.has(AccessFlags::TRAPS) {
                if current.len() == MOST_PLACES {
                    current.remove(0);
                }
                let heap = access.heap();
                current.push(Overwritten { place, heap });
            }
            return true;
        }
        (Op::Load { access, .. } | Op::LoadLane { access, .. }, Some(place)) => {
            current.retain(|later| {
                !function.may_alias(access.heap(), later.heap)
                    || later.place.is_apart_from(function, &place)
            });
        }
        _ => current.retain(|later| !function.may_alias(effects.reads, later.heap)),
    }
    false
}
