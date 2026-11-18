//! Where code comes from, and how to get back there.

use core::panic::Location;

use bun_engine_bytecode::{Register, Specialization};
use bun_engine_codegen::ir::{Origin, Type, Value as Ssa};
use bun_engine_vm::ExitSite;

/// A position in `Graph::frames`. The first is the function that has the frame on the stack.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct FrameIndex(pub(crate) u32);

impl FrameIndex {
    pub(crate) const ROOT: Self = Self(0);

    pub(crate) fn index(self) -> usize {
        self.0 as usize
    }
}

/// How the caller of an inlined function goes on.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum CallKind {
    Call,
    Construct,
    /// The frame of the caller is gone, as far as scripts can tell.
    TailCall,
    /// Of a getter or a setter.
    Accessor,
}

impl CallKind {
    pub(crate) fn specialization(self) -> Specialization {
        if self == Self::Construct {
            Specialization::Construct
        } else {
            Specialization::Call
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct FrameInfo {
    /// The address of the code block that has the profiles.
    pub(crate) code_block: usize,
    pub(crate) global: usize,
    /// Not of the root.
    pub(crate) caller: Origin,
    pub(crate) kind: CallKind,
    pub(crate) is_builtin: bool,
    /// The words that the interpreter needs below the frame pointer.
    pub(crate) frame_words: u32,
    pub(crate) parameters: u32,
    /// The words from the frame pointer of the root down to its own, once an exit has made it a frame.
    pub(crate) distance: u32,
    /// The `InlineEntry`, until the graph is specialized. `NONE` for the root.
    pub(crate) entry: Ssa,
    pub(crate) shows: Shown,
}

bitflags::bitflags! {
    /// What scripts can get hold of while a function is waiting for a call to return.
    #[derive(Clone, Copy)]
    pub(crate) struct Shown: u8 {
        const CALLEE = 1 << 0;
        const ARGUMENTS = 1 << 1;
    }
}

impl Shown {
    pub(crate) fn includes(self, register: Register) -> bool {
        register == Register::CALLEE && self.contains(Self::CALLEE)
            || register.offset() > Register::THIS.offset() && self.contains(Self::ARGUMENTS)
    }
}

/// What an `Origin` stands for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Position {
    pub(crate) frame: FrameIndex,
    pub(crate) offset: u32,
}

impl Position {
    /// The frame whose code block remembers the exits from here, and under which name.
    pub(crate) fn exit_site(
        self,
        frames: &[FrameInfo],
        position_of: impl Fn(Origin) -> Position,
    ) -> (FrameIndex, ExitSite) {
        let mut outer = self;
        while outer.frame != FrameIndex::ROOT && frames[outer.frame.index()].is_builtin {
            outer = position_of(frames[outer.frame.index()].caller);
        }
        let site = ExitSite {
            offset: outer.offset,
            offset_in_callee: (outer != self).then_some(self.offset),
        };
        (outer.frame, site)
    }
}

/// What the values of a state are. Those of the callers come first.
#[derive(Clone, Copy)]
pub(crate) struct Layout {
    /// The instruction to run again or, for a caller, the one that is waiting for the call to return.
    pub(crate) resume: Origin,
    /// `NO_LAYOUT` for the root.
    pub(crate) caller: u32,
    /// A range of `Graph::layout_registers`, with one register for each value.
    pub(crate) first_register: u32,
    pub(crate) register_count: u32,
}

pub(crate) const NO_LAYOUT: u32 = u32::MAX;

/// In a layout of an inlined function, where the number of arguments including `this` goes.
pub(crate) const ARGUMENT_COUNT: Register = Register::from_offset(4);

/// The tag of a value in a state.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum Format {
    Tagged,
    Int32,
    Int52,
    Double,
    Boolean,
    /// The offset in the coroutine of the frame at which it is.
    Saved,
    /// See `Recipe`.
    Virtual,
}

impl Format {
    pub(crate) fn from_tag(tag: u8) -> Self {
        [
            Self::Tagged,
            Self::Int32,
            Self::Int52,
            Self::Double,
            Self::Boolean,
            Self::Saved,
            Self::Virtual,
        ][usize::from(tag)]
    }

    pub(crate) fn machine_type(self) -> Type {
        match self {
            Self::Tagged | Self::Int52 | Self::Saved | Self::Virtual => Type::I64,
            Self::Int32 | Self::Boolean => Type::I32,
            Self::Double => Type::F64,
        }
    }
}

pub(crate) use bun_engine_vm::ExitKind;

/// What the token of an exit stands for.
#[derive(Clone, Copy)]
pub(crate) struct ExitInfo {
    pub(crate) kind: ExitKind,
    /// The instruction whose speculation failed.
    pub(crate) origin: Origin,
    /// The position in the state of the value that was not as expected, and what predicted it.
    pub(crate) culprit: Option<(u32, Profile)>,
    #[cfg(debug_assertions)]
    pub(crate) made_at: &'static Location<'static>,
}

impl ExitInfo {
    /// In the source of the compiler, as far as this build knows.
    pub(crate) fn made_at(&self) -> &'static Location<'static> {
        #[cfg(debug_assertions)]
        return self.made_at;
        #[cfg(not(debug_assertions))]
        Location::caller()
    }
}

/// For what nothing is going to read. It looks like a cell that is not there.
pub(crate) const DEAD: u64 = 0xdead_0000;

/// Where the lower tiers keep the types that a value has had.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Profile {
    Argument(u32),
    /// Of the instruction with this metadata.
    Result(FrameIndex, u32),
}
