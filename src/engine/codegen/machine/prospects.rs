//! How soon, and how likely, the values that are live at the end of a block are wanted in a register.

use bun_engine_asm::Bank;

use super::code::{BlockData, Code, NEVER, VRegData};
use super::liveness::Liveness;
use crate::analysis::{Cfg, Frequencies, Loop};
use crate::bitset;
use crate::ir::{Block, Entity, Function, Table};

/// In instructions, and longer for a use that is less likely to come.
pub(crate) type Distance = u32;

pub(crate) const FARTHEST: Distance = 1 << 28;

const LANES: usize = 4;
const MAX_GROUPS: usize = 1 << 19;
/// What a loop holds in a register is wanted there at the end of each turn, however far its next use is.
const LONGEST_WAIT_AT_HEADER: f32 = 256.0;
const LENGTH_OF_INNER_LOOP: u32 = 64;
/// The position after the banks, for what does not depend on registers.
const REGARDLESS: usize = 2;

#[derive(Clone, Copy)]
pub(crate) struct Prospect {
    pub(crate) distance: Distance,
    /// That the value is wanted before all registers are lost.
    pub(crate) chance: f32,
}

/// Of the values with consecutive bits, up to the end of the current turn of any loop.
#[derive(Clone, Copy, Default)]
struct Group {
    /// The inverse of the distance.
    nearness: [f32; LANES],
    chance: [f32; LANES],
}

#[derive(Clone, Copy, Default)]
struct Row {
    start: u32,
    len: u32,
}

impl Row {
    #[inline]
    fn range(self) -> core::ops::Range<usize> {
        self.start as usize..(self.start + self.len) as usize
    }
}

/// From the end of a block.
#[derive(Clone, Copy, Default)]
struct Outlook {
    row: Row,
    /// The chance to come back to the header of the innermost loop with the registers of each bank intact.
    returns: [f32; 3],
    /// The chance to leave that loop in this turn, and come back to the header of the one around it.
    returns_further: [f32; 3],
    way_back: Distance,
}

#[derive(Clone, Copy, Default)]
struct LoopOutlook {
    at_header: Row,
    /// The share of the turns that lose the registers of each bank.
    losses: [f32; 2],
}

#[derive(Default)]
pub(crate) struct Prospects {
    groups: Vec<Group>,
    /// By position. Empty if nothing is known.
    outlooks: Vec<Outlook>,
    loops: Table<Loop, LoopOutlook>,
    groups_live_in: Vec<u32>,
    row: Vec<Group>,
    words: usize,
    /// A row for each loop, of what is in registers at its header.
    kept: Vec<u64>,
}

fn set(row: &mut [Group], global: usize, nearness: f32, chance: f32) {
    if let Some(group) = row.get_mut(global / LANES) {
        (group.nearness[global % LANES], group.chance[global % LANES]) = (nearness, chance);
    }
}

fn unless_lost(chances: [f32; 3], block: &BlockData) -> [f32; 3] {
    let [gprs, fprs, regardless] = chances;
    let kept = |chance, bank: Bank| {
        if block.barrier[bank as usize] == 0 {
            chance
        } else {
            0.0
        }
    };
    [kept(gprs, Bank::Gpr), kept(fprs, Bank::Fpr), regardless]
}

/// The chance that something happens in some turn of a loop.
fn in_the_end(in_one_turn: f32, returns: f32) -> f32 {
    (in_one_turn / (1.0 - returns).max(f32::EPSILON)).min(1.0)
}

impl Prospects {
    /// Without `is_wanted` it only gets ready to note what loops keep.
    pub(crate) fn compute(
        &mut self,
        function: &Function,
        cfg: &Cfg,
        frequencies: &Frequencies,
        code: &Code,
        liveness: &Liveness,
        is_wanted: bool,
    ) {
        self.words = liveness.words();
        self.kept.clear();
        self.kept.resize(cfg.loops().len() * self.words, 0);
        self.outlooks.clear();
        if is_wanted && self.make_room(function, cfg, liveness) {
            self.flow_backward(function, cfg, frequencies, code, liveness);
        }
    }

    #[inline]
    pub(crate) fn are_known(&self) -> bool {
        !self.outlooks.is_empty()
    }

    pub(crate) fn note_kept(&mut self, headed: Loop, global: u32) {
        bitset::insert(
            &mut self.kept[headed.index() * self.words..],
            global as usize,
        );
    }

    #[inline]
    pub(crate) fn is_kept(&self, around: Loop, global: u32) -> bool {
        bitset::contains(&self.kept[around.index() * self.words..], global as usize)
    }

    /// The share of the turns of the loop that lose all registers of the bank.
    pub(crate) fn losses(&self, around: Loop, bank: Bank) -> f32 {
        self.loops[around].losses[bank as usize]
    }

    #[inline]
    fn read(&self, row: Row, global: usize) -> (f32, f32) {
        let group = self.groups[row.range()].get(global / LANES);
        group.map_or((0.0, 0.0), |group| {
            (group.nearness[global % LANES], group.chance[global % LANES])
        })
    }

    /// For a global value, from the end of the block.
    pub(crate) fn after(&self, cfg: &Cfg, block: Block, value: &VRegData) -> Prospect {
        let outlook = &self.outlooks[cfg.position(block) as usize];
        let (global, bank) = (value.global as usize, value.class.bank() as usize);
        let (mut nearness, mut chance) = self.read(outlook.row, global);
        let mut around = cfg.loop_of(block);
        for (returns, way) in [
            (outlook.returns[bank], outlook.way_back),
            (outlook.returns_further[bank], LENGTH_OF_INNER_LOOP),
        ] {
            let Some(data) = cfg.loops().get(around) else {
                break;
            };
            if self.is_kept(around, value.global) {
                let at_header = self.read(self.loops[around].at_header, global).0;
                let wait = (1.0 / at_header).min(LONGEST_WAIT_AT_HEADER);
                let more = returns * (1.0 - chance);
                chance += more;
                nearness += more / (way as f32 + wait);
            }
            around = data.parent;
        }
        Prospect {
            distance: ((1.0 / nearness) as Distance).min(FARTHEST),
            chance,
        }
    }

    fn make_room(&mut self, function: &Function, cfg: &Cfg, liveness: &Liveness) -> bool {
        self.groups_live_in.clear();
        self.groups_live_in.extend(cfg.order().iter().map(|&block| {
            let live = liveness.live_in(cfg, block);
            live.iter().rposition(|&word| word != 0).map_or(0, |index| {
                (index as u32 * u64::BITS + live[index].ilog2()) / LANES as u32 + 1
            })
        }));
        let mut total = 0usize;
        let mut add_row = |len: u32| {
            total += len as usize;
            Row {
                start: (total - len as usize) as u32,
                len,
            }
        };
        for &block in cfg.order() {
            let edges = function.successors(block);
            let lengths = edges
                .filter(|&edge| !cfg.is_backward(function, edge))
                .map(|edge| self.groups_live_in[cfg.position(function.target(edge)) as usize]);
            self.outlooks.push(Outlook {
                row: add_row(lengths.max().unwrap_or(0)),
                ..Outlook::default()
            });
        }
        self.loops.clear();
        for data in cfg.loops().values() {
            self.loops.push(LoopOutlook {
                at_header: add_row(self.groups_live_in[data.positions().start as usize]),
                losses: [0.0; 2],
            });
        }
        if total > MAX_GROUPS {
            self.outlooks.clear();
            return false;
        }
        self.groups.clear();
        self.groups.resize(total, Group::default());
        true
    }

    fn flow_backward(
        &mut self,
        function: &Function,
        cfg: &Cfg,
        frequencies: &Frequencies,
        code: &Code,
        liveness: &Liveness,
    ) {
        let mut row = core::mem::take(&mut self.row);
        let mut uses = code.foreign_uses.iter().peekable();
        for (position, &block) in cfg.order().iter().enumerate().rev() {
            let data = &code.blocks[block];
            if let Some(around) = cfg.loop_of(block).expand() {
                self.find_ways_back(function, cfg, frequencies, code, block, around);
            }
            let len = self.groups_live_in[position] as usize;
            row.clear();
            if data.barrier.into_iter().min() == Some(0) {
                let length = (data.end - data.first) as f32;
                let at_end = self.groups[self.outlooks[position].row.range()].iter();
                row.extend(at_end.take(len).map(|group| Group {
                    nearness: group.nearness.map(|it| it / (1.0 + length * it)),
                    chance: group.chance,
                }));
                let defined = liveness.starting_at(code, position);
                for value in defined.map(|vreg| &code.vregs[vreg]) {
                    if !value.is_floating() {
                        set(&mut row, value.global as usize, 0.0, 0.0);
                    }
                }
                for bank in [Bank::Gpr, Bank::Fpr] {
                    if data.barrier[bank as usize] != 0 {
                        let bits = liveness.bits_of(bank);
                        (bits.start..bits.end.min(len * LANES))
                            .for_each(|global| set(&mut row, global, 0.0, 0.0));
                    }
                }
            }
            row.resize(len, Group::default());
            while let Some(foreign) = uses.next_if(|foreign| foreign.block == block) {
                if foreign.first_warm != NEVER {
                    let value = &code.vregs[foreign.vreg];
                    let distance = (foreign.first_warm - data.entry()) / 2;
                    let barrier = data.barrier[value.class.bank() as usize];
                    if barrier == 0 || distance < barrier {
                        let nearness = 1.0 / (distance + 1) as f32;
                        set(&mut row, value.global as usize, nearness, 1.0);
                    }
                }
            }
            if let Some(headed) = cfg.loop_headed_by(block) {
                self.step_out_of(headed, position, data, code, liveness, &mut row);
            }
            for &edge in cfg.predecessors(block) {
                let source = function.source(edge);
                let before = cfg.position(source) as usize;
                if before < position {
                    let share = frequencies.of_edge(edge) / frequencies.of_block(source);
                    let at_end = &mut self.groups[self.outlooks[before].row.range()];
                    for (sum, group) in at_end.iter_mut().zip(&row) {
                        for lane in 0..LANES {
                            sum.nearness[lane] += share * group.nearness[lane];
                            sum.chance[lane] += share * group.chance[lane];
                        }
                    }
                }
            }
        }
        self.row = row;
    }

    /// Turns the row for the start of a header into what the code before the loop has to expect.
    fn step_out_of(
        &mut self,
        headed: Loop,
        position: usize,
        header: &BlockData,
        code: &Code,
        liveness: &Liveness,
        row: &mut [Group],
    ) {
        let returns = unless_lost(self.outlooks[position].returns, header);
        let outlook = &mut self.loops[headed];
        self.groups[outlook.at_header.range()].copy_from_slice(row);
        for bank in [Bank::Gpr, Bank::Fpr] {
            let returns_intact = returns[bank as usize];
            let losses = 1.0 - returns_intact / returns[REGARDLESS].max(f32::EPSILON);
            outlook.losses[bank as usize] = losses;
            let bits = liveness.bits_of(bank);
            for global in bits.start..bits.end.min(row.len() * LANES) {
                let (group, lane) = (&mut row[global / LANES], global % LANES);
                if group.chance[lane] < losses {
                    (group.nearness[lane], group.chance[lane]) = (0.0, 0.0);
                } else {
                    group.chance[lane] = in_the_end(group.chance[lane], returns_intact);
                }
            }
        }
        for value in (liveness.starting_at(code, position)).map(|vreg| &code.vregs[vreg]) {
            set(row, value.global as usize, 0.0, 0.0);
        }
    }

    fn find_ways_back(
        &mut self,
        function: &Function,
        cfg: &Cfg,
        frequencies: &Frequencies,
        code: &Code,
        block: Block,
        around: Loop,
    ) {
        let (mut returns, mut further, mut way_back) = ([0.0; 3], [0.0; 3], FARTHEST);
        let outer = cfg.loops()[around].parent;
        for edge in function.successors(block) {
            let target = function.target(edge);
            let share = frequencies.of_edge(edge) / frequencies.of_block(block);
            let (data, onward) = (
                &code.blocks[target],
                &self.outlooks[cfg.position(target) as usize],
            );
            let mut level = cfg.loop_of(target);
            let (mut arrives, mut beyond, mut way) = ([1.0; 3], [0.0; 3], 0);
            if !cfg.is_backward(function, edge) {
                arrives = unless_lost(onward.returns, data);
                beyond = unless_lost(onward.returns_further, data);
                way = (data.end - data.first + onward.way_back).min(FARTHEST);
                if let Some(entered) = cfg.loop_headed_by(target) {
                    arrives = core::array::from_fn(|i| in_the_end(beyond[i], arrives[i]));
                    (beyond, way) = ([0.0; 3], LENGTH_OF_INNER_LOOP);
                    level = cfg.loops()[entered].parent;
                }
            }
            if level == around {
                for i in 0..3 {
                    returns[i] += share * arrives[i];
                    further[i] += share * beyond[i];
                }
                if !function.is_rare(edge) {
                    way_back = way_back.min(way);
                }
            } else if level == outer && !outer.is_none() {
                (0..3).for_each(|i| further[i] += share * arrives[i]);
            }
        }
        let outlook = &mut self.outlooks[cfg.position(block) as usize];
        (outlook.returns, outlook.returns_further) = (returns, further);
        outlook.way_back = way_back;
    }
}
