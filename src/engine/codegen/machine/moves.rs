//! Puts moves that are meant to happen at once in an order.

use bun_engine_asm::{Bank, Reg};

use super::code::{Class, VReg};
use crate::ir::Table;

/// A place between which values move.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Spot(u32);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SpotKind {
    Register(Reg),
    /// The register of the bank that is never allocated.
    Scratch,
    /// A slot of 16 bytes that is no value's home.
    Spare,
    Home(VReg),
}

impl Spot {
    pub(crate) const SCRATCH: Self = Self(Reg::COUNT as u32);
    pub(crate) const SPARE: Self = Self(Reg::COUNT as u32 + 1);
    const FIRST_HOME: u32 = Reg::COUNT as u32 + 2;

    #[inline]
    pub(crate) fn register(index: u8) -> Self {
        Self(index.into())
    }

    #[inline]
    pub(crate) fn home(vreg: VReg) -> Self {
        Self(vreg.0 + Self::FIRST_HOME)
    }

    #[inline]
    pub(crate) fn kind(self) -> SpotKind {
        match self {
            Self::SCRATCH => SpotKind::Scratch,
            Self::SPARE => SpotKind::Spare,
            Self(Self::FIRST_HOME..) => SpotKind::Home(VReg(self.0 - Self::FIRST_HOME)),
            Self(index) => SpotKind::Register(Reg::from_index(index as usize)),
        }
    }

    #[inline]
    pub(crate) fn is_register(self) -> bool {
        self.0 < Self::SCRATCH.0
    }
}

impl core::fmt::Debug for Spot {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.kind().fmt(f)
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Move {
    pub(crate) from: Spot,
    pub(crate) to: Spot,
    pub(crate) class: Class,
    pub(crate) kind: MoveKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum MoveKind {
    Copy,
    /// `from` gets what was in `to`.
    Swap,
    /// A value goes to its own home, which nothing else in the same group of moves touches.
    Spill,
}

impl Move {
    #[inline]
    pub(crate) fn new(from: Spot, to: Spot, class: Class) -> Self {
        Self {
            from,
            to,
            class,
            kind: MoveKind::Copy,
        }
    }

    #[inline]
    pub(crate) fn spill(from: Spot, vreg: VReg, class: Class) -> Self {
        Self {
            from,
            to: Spot::home(vreg),
            class,
            kind: MoveKind::Spill,
        }
    }
}

const NO_MOVE: u32 = u32::MAX;

#[derive(Clone, Copy)]
struct Traffic {
    readers: u32,
    writer: u32,
}

const IDLE: Traffic = Traffic {
    readers: 0,
    writer: NO_MOVE,
};

pub(crate) struct Sequencer {
    registers: [Traffic; Reg::COUNT + 2],
    homes: Table<VReg, Traffic>,
    ready: Vec<u32>,
    pub(crate) used_spare: bool,
}

impl Default for Sequencer {
    fn default() -> Self {
        Self {
            registers: [IDLE; Reg::COUNT + 2],
            homes: Table::default(),
            ready: Vec::new(),
            used_spare: false,
        }
    }
}

impl Sequencer {
    pub(crate) fn reset(&mut self, vreg_count: usize) {
        self.homes.refill(vreg_count, IDLE);
        self.used_spare = false;
    }

    #[inline]
    fn traffic(&mut self, spot: Spot) -> &mut Traffic {
        match spot.0.checked_sub(Spot::FIRST_HOME) {
            Some(vreg) => &mut self.homes[VReg(vreg)],
            None => &mut self.registers[spot.0 as usize],
        }
    }

    /// No two moves have the same destination, and homes that are shared go by one name. Empties `moves`.
    pub(crate) fn sequence(
        &mut self,
        moves: &mut Vec<Move>,
        swaps_gprs: bool,
        mut emit: impl FnMut(Move),
    ) {
        moves.retain(|&step| {
            if step.kind == MoveKind::Spill {
                emit(step);
            }
            step.kind != MoveKind::Spill
        });
        if let [only] = moves[..] {
            moves.clear();
            return emit(only);
        }
        for (index, step) in moves.iter().enumerate() {
            debug_assert!(step.from != step.to);
            self.traffic(step.from).readers += 1;
            let known = core::mem::replace(&mut self.traffic(step.to).writer, index as u32);
            debug_assert!(known == NO_MOVE);
        }
        // Stores go first, as they free registers, and loads last, as what is ready is taken from the end.
        for wants_register in [true, false] {
            for (index, step) in moves.iter().enumerate().rev() {
                if step.to.is_register() == wants_register && self.traffic(step.to).readers == 0 {
                    self.ready.push(index as u32);
                }
            }
        }
        self.drain(moves, &mut emit);
        for first in 0..moves.len() {
            if self.traffic(moves[first].to).writer != NO_MOVE {
                self.break_cycle(moves, first, swaps_gprs, &mut emit);
            }
        }
        moves.clear();
    }

    fn drain(&mut self, moves: &[Move], emit: &mut impl FnMut(Move)) {
        while let Some(index) = self.ready.pop() {
            let step = moves[index as usize];
            emit(step);
            self.traffic(step.to).writer = NO_MOVE;
            let source = self.traffic(step.from);
            source.readers -= 1;
            if source.readers == 0 && source.writer != NO_MOVE {
                let writer = source.writer;
                self.ready.push(writer);
            }
        }
    }

    /// What is left are cycles in which each place is read once.
    fn break_cycle(
        &mut self,
        moves: &mut [Move],
        first: usize,
        swaps_gprs: bool,
        emit: &mut impl FnMut(Move),
    ) {
        let mut last = first;
        let mut only_registers = true;
        loop {
            only_registers &= moves[last].to.is_register();
            if moves[last].from == moves[first].to {
                break;
            }
            last = self.traffic(moves[last].from).writer as usize;
        }
        if only_registers && swaps_gprs && moves[first].class.bank() == Bank::Gpr {
            let mut index = first;
            loop {
                let step = moves[index];
                *self.traffic(step.to) = IDLE;
                if index == last {
                    break;
                }
                emit(Move {
                    kind: MoveKind::Swap,
                    ..step
                });
                index = self.traffic(step.from).writer as usize;
            }
            return;
        }
        let shelter = if only_registers {
            Spot::SCRATCH
        } else {
            Spot::SPARE
        };
        self.used_spare |= !only_registers;
        emit(Move::new(moves[last].from, shelter, moves[last].class));
        self.traffic(moves[last].from).readers = 0;
        self.traffic(shelter).readers = 1;
        moves[last].from = shelter;
        self.ready.push(first as u32);
        self.drain(moves, emit);
    }
}
