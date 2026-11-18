//! Which values share a slot of the frame, and where the slots are.

use std::collections::BinaryHeap;

use core::cmp::Reverse;

use super::code::{Code, Home, NEVER, Point, VReg};
use crate::analysis::Cfg;
use crate::ir::{Function, Table};

const MAX_TENANTS: u32 = 16;

#[derive(Clone, Copy)]
struct Tenancy {
    /// Names the slot.
    owner: VReg,
    next: VReg,
    count: u32,
    is_used: bool,
    offset: i32,
}

#[derive(Default)]
pub(crate) struct Slots {
    tenancies: Table<VReg, Tenancy>,
    used: Vec<(Point, Point, VReg)>,
    occupied: BinaryHeap<Reverse<(Point, VReg)>>,
    free: [Vec<i32>; 2],
}

impl Slots {
    /// A parameter and its argument share a slot if they are never live together, so passing one to the other in
    /// memory takes no code.
    pub(crate) fn share(&mut self, function: &Function, cfg: &Cfg, code: &Code) {
        self.tenancies.clear();
        for vreg in code.vregs.keys() {
            self.tenancies.push(Tenancy {
                owner: vreg,
                next: VReg::NONE,
                count: 1,
                is_used: false,
                offset: 0,
            });
        }
        for &block in cfg.order().iter().rev() {
            for &edge in cfg.predecessors(block).iter().rev() {
                for (&param, &arg) in code
                    .params(function.target(edge))
                    .iter()
                    .zip(code.args(edge))
                {
                    if !param.is_none()
                        && code.vregs[param].end != NEVER
                        && code.vregs[arg].home == Home::Spill
                    {
                        self.try_to_join(code, self.owner(param), self.owner(arg));
                    }
                }
            }
        }
    }

    fn tenants(&self, owner: VReg) -> impl Iterator<Item = VReg> {
        core::iter::successors(Some(owner), |&tenant| self.tenancies[tenant].next.expand())
    }

    fn try_to_join(&mut self, code: &Code, owner: VReg, other: VReg) {
        let count = self.tenancies[owner].count + self.tenancies[other].count;
        if owner == other || count > MAX_TENANTS {
            return;
        }
        let overlap = |a: VReg, b: VReg| {
            let (a, b) = (&code.vregs[a], &code.vregs[b]);
            a.start <= b.end && b.start <= a.end
        };
        if self
            .tenants(owner)
            .any(|a| self.tenants(other).any(|b| overlap(a, b)))
        {
            return;
        }
        let mut tenant = other;
        loop {
            self.tenancies[tenant].owner = owner;
            match self.tenancies[tenant].next.expand() {
                Some(next) => tenant = next,
                None => break,
            }
        }
        self.tenancies[tenant].next = core::mem::replace(&mut self.tenancies[owner].next, other);
        self.tenancies[owner].count = count;
    }

    #[inline]
    pub(crate) fn owner(&self, vreg: VReg) -> VReg {
        self.tenancies[vreg].owner
    }

    #[inline]
    pub(crate) fn note_use(&mut self, vreg: VReg) {
        let owner = self.owner(vreg);
        self.tenancies[owner].is_used = true;
    }

    /// From the frame pointer.
    #[inline]
    pub(crate) fn offset(&self, vreg: VReg) -> i32 {
        let tenancy = &self.tenancies[self.owner(vreg)];
        debug_assert!(tenancy.is_used);
        tenancy.offset
    }

    /// Places the slots below the first `taken` bytes under the frame pointer, and returns how many are taken then.
    pub(crate) fn place(
        &mut self,
        function: &Function,
        cfg: &Cfg,
        code: &Code,
        mut taken: u32,
    ) -> u32 {
        self.used.clear();
        for owner in code
            .vregs
            .keys()
            .filter(|&vreg| self.tenancies[vreg].is_used)
        {
            let (mut start, mut end) = (NEVER, 0);
            for tenant in self.tenants(owner) {
                let data = &code.vregs[tenant];
                (start, end) = (start.min(data.start), end.max(data.end));
                // A parameter is written on the edges to its block.
                if data.start == code.blocks[data.block].entry() {
                    for &edge in cfg.predecessors(data.block) {
                        let exit = code.blocks[function.source(edge)].exit();
                        (start, end) = (start.min(exit), end.max(exit));
                    }
                }
            }
            self.used.push((start, end, owner));
        }
        self.used.sort_unstable();
        self.occupied.clear();
        self.free.iter_mut().for_each(Vec::clear);
        let size_of = |vreg: VReg| code.vregs[vreg].class.slot_size();
        for &(start, end, owner) in &self.used {
            while let Some(&Reverse((ended, former))) = self.occupied.peek()
                && ended < start
            {
                self.occupied.pop();
                self.free[size_of(former) as usize / 16].push(self.tenancies[former].offset);
            }
            let size = size_of(owner);
            self.tenancies[owner].offset =
                self.free[size as usize / 16].pop().unwrap_or_else(|| {
                    let unaligned = taken;
                    taken = (taken + size).next_multiple_of(size);
                    if taken - unaligned >= size + 8 {
                        self.free[0].push(-(taken as i32) + size as i32);
                    }
                    -(taken as i32)
                });
            self.occupied.push(Reverse((end, owner)));
        }
        taken
    }
}
