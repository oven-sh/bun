//! What the instructions of a loop, with those of the loops in it, may do.

use super::writes::Writes;
use crate::analysis::{Cfg, Loop};
use crate::ir::{EffectFlags, Function, Heap, Table};

pub struct LoopEffects<'a> {
    cfg: &'a Cfg,
    writes: Writes,
    flags: Table<Loop, EffectFlags>,
}

impl<'a> LoopEffects<'a> {
    pub fn new(function: &Function, cfg: &'a Cfg) -> Self {
        let mut flags = Table::filled(cfg.loops().len(), EffectFlags::empty());
        let writes = Writes::collect(
            function,
            cfg,
            |block| !cfg.loop_of(block).is_none(),
            |value, effects, _| flags[cfg.loop_of(function.block_of(value))] |= effects.flags,
        );
        for id in cfg.loops().keys().rev() {
            if let Some(parent) = cfg.loops()[id].parent.expand() {
                let inner = flags[id];
                flags[parent] |= inner;
            }
        }
        Self { cfg, writes, flags }
    }

    pub fn may_write(&mut self, function: &Function, id: Loop, heap: Heap) -> bool {
        let groups = self.writes.groups_overlapping(function, heap);
        let numbers = self.writes.at_positions(self.cfg.loops()[id].positions());
        self.writes
            .may_change(function, numbers, None, groups, &mut 0)
    }

    /// Those that any of the instructions has.
    pub fn flags(&self, id: Loop) -> EffectFlags {
        self.flags[id]
    }
}
