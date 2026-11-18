//! What the compiler hands the run time. Cells are addresses, as in the graph.

use bun_engine_asm::Code;
use bun_engine_bytecode::Register;
use bun_engine_codegen::ir::Origin;
use bun_engine_vm::Intrinsic;

use crate::graph::probes::Probe;
use crate::graph::{Assumption, ExitInfo, Format, FrameInfo, Layout, Position, Recipe, Shapes};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Place {
    /// At this offset from the frame pointer.
    Frame(i32),
    Gpr(u8),
    Fpr(u8),
    /// A position in [`Output::constants`].
    Constant(u32),
}

/// Where a value of a state is, and in which form.
#[derive(Clone, Copy)]
pub(crate) struct Held(u32);

impl Held {
    const FORMAT_BITS: u32 = 3;
    const KIND_BITS: u32 = 2;

    pub(crate) fn new(place: Place, format: Format) -> Self {
        let (kind, payload) = match place {
            Place::Frame(offset) => (0, (offset / 4) as u32),
            Place::Gpr(number) => (1, number.into()),
            Place::Fpr(number) => (2, number.into()),
            Place::Constant(position) => (3, position),
        };
        let held = Self((payload << Self::KIND_BITS | kind) << Self::FORMAT_BITS | format as u32);
        assert!(held.place() == place);
        held
    }

    pub(crate) fn format(self) -> Format {
        Format::from_tag((self.0 & ((1 << Self::FORMAT_BITS) - 1)) as u8)
    }

    pub(crate) fn place(self) -> Place {
        let shift = Self::FORMAT_BITS + Self::KIND_BITS;
        match self.0 >> Self::FORMAT_BITS & ((1 << Self::KIND_BITS) - 1) {
            0 => Place::Frame((self.0 as i32 >> shift) * 4),
            1 => Place::Gpr((self.0 >> shift) as u8),
            2 => Place::Fpr((self.0 >> shift) as u8),
            _ => Place::Constant(self.0 >> shift),
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct PlacedState {
    /// A position in [`Output::layouts`], or `NO_LAYOUT`.
    pub(crate) layout: u32,
    /// Where the values start in [`Output::held`].
    pub(crate) first: u32,
}

/// The code of an exit is a call that does not return.
#[derive(Clone, Copy)]
pub(crate) struct ExitRecord {
    pub(crate) return_offset: u32,
    pub(crate) info: ExitInfo,
    pub(crate) state: PlacedState,
}

/// The number that a frame has for it is its position plus one. No value of the state is in a register.
#[derive(Clone, Copy)]
pub(crate) struct CallSite {
    pub(crate) origin: Origin,
    pub(crate) state: PlacedState,
}

#[derive(Clone, Copy)]
pub(crate) struct InvalidationPoint {
    /// Where a jump is written.
    pub(crate) offset: u32,
    pub(crate) target: u32,
}

pub(crate) struct Output {
    pub(crate) code: Code,
    pub(crate) entry: u32,
    pub(crate) tables: Description,
    pub(crate) assumptions: Vec<Assumption>,
}

/// What stays with the code.
pub(crate) struct Description {
    /// From the stack pointer up to the frame pointer. An exit has room for its frames in there.
    pub(crate) frame_size: u32,
    pub(crate) writes_profiles: bool,
    /// Ascending.
    pub(crate) exits: Box<[ExitRecord]>,
    pub(crate) call_sites: Box<[CallSite]>,
    pub(crate) held: Box<[Held]>,
    pub(crate) constants: Box<[u64]>,
    pub(crate) invalidation_points: Box<[InvalidationPoint]>,
    pub(crate) frames: Box<[FrameInfo]>,
    pub(crate) layouts: Box<[Layout]>,
    pub(crate) layout_registers: Box<[Register]>,
    pub(crate) recipes: Box<[Recipe]>,
    /// By origin.
    pub(crate) positions: Box<[Position]>,
    /// Where the code for each begins, ascending. Empty unless a profiler wants to know.
    pub(crate) origins: Box<[(u32, Origin)]>,
    pub(crate) probes: Box<[Probe]>,
    /// What those refer to. Empty if there are none.
    pub(crate) shapes: Shapes,
    pub(crate) intrinsics: Box<[Intrinsic]>,
}
