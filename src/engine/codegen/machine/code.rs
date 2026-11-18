//! Machine instructions over virtual registers, in SSA form, with the blocks and edges of the function.

use bun_engine_asm::{Bank, Gpr, Reg, RegisterSet};

use crate::ir::{Block, Edge, Origin, Pool, Span, State, Table, Type, Value, entities};

entities! {
    VReg = "%";
    /// An instruction that can exit, clobbers registers or involves the client.
    Site = "site";
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Class {
    /// The upper half of the register is clear.
    Int32,
    Int64,
    Float32,
    Float64,
    Vector,
}

impl Class {
    #[inline]
    pub(crate) fn of(ty: Type) -> Self {
        match ty {
            Type::I32 => Self::Int32,
            Type::I64 => Self::Int64,
            Type::F32 => Self::Float32,
            Type::F64 => Self::Float64,
            Type::V128 => Self::Vector,
            Type::Void | Type::Tuple => unreachable!("is in no register"),
        }
    }

    #[inline]
    pub(crate) fn bank(self) -> Bank {
        if matches!(self, Self::Int32 | Self::Int64) {
            Bank::Gpr
        } else {
            Bank::Fpr
        }
    }

    #[inline]
    pub(crate) fn slot_size(self) -> u32 {
        if self == Self::Vector { 16 } else { 8 }
    }
}

/// Where a value is found when it is in no register.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Home {
    /// A slot that has the value only once it is stored there.
    Spill,
    Constant(Value),
    Displaced(Gpr, i32),
    Incoming(i32),
}

/// An instruction reads at twice its position and writes at the point after that.
pub(crate) type Point = u32;

pub(crate) const NEVER: Point = Point::MAX;

#[inline]
pub(crate) fn early(position: usize) -> Point {
    position as Point * 2
}

#[inline]
pub(crate) fn late(position: usize) -> Point {
    position as Point * 2 + 1
}

/// The register in which an instruction asks for the value or an heir.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Wish {
    None,
    /// The instruction runs less often than the definition.
    Weak(u8),
    Firm(u8),
    /// The value is still there afterwards.
    Lasting(u8),
}

#[derive(Clone)]
pub(crate) struct VRegData {
    pub(crate) class: Class,
    pub(crate) wish: Wish,
    pub(crate) home: Home,
    /// Of the definition. What has none counts as defined on the way into the loop with this header if it is global.
    pub(crate) block: Block,
    /// Its bit in sets of the values that are live between blocks, or `LOCAL`. Values that live far apart share one.
    pub(crate) global: u32,
    pub(crate) start: Point,
    /// The last point at which it is live, or `NEVER` if nothing uses it.
    pub(crate) end: Point,
    /// The result or parameter that had best take over the register, or `NONE`.
    pub(crate) heir: VReg,
    /// The last of the heirs, up to the parameter of a loop. The value itself if it has none.
    pub(crate) goal: VReg,
    /// The position of the last record of its uses outside the block that defines it.
    pub(crate) foreign_use: u32,
}

pub(crate) const LOCAL: u32 = u32::MAX;

impl VRegData {
    /// Can be had anywhere without having been defined.
    #[inline]
    pub(crate) fn is_floating(&self) -> bool {
        matches!(self.home, Home::Constant(_) | Home::Displaced(..))
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Role {
    Use,
    LateUse,
    Def,
    /// Shares a register with no other operand.
    EarlyDef,
    /// Like `EarlyDef`, without a value.
    Temp,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Place {
    Register,
    /// Or at home, if that can be addressed.
    RegisterOrMemory,
    Anywhere,
    ColdAnywhere,
    Fixed,
    /// A register that is never allocated. There is no value.
    Given,
}

/// Instead of the index of a register.
pub(crate) const AT_HOME: u8 = 0x7f;
const NO_TIE: u8 = 0xf;

#[derive(Clone, Copy)]
pub(crate) struct Operand {
    pub(crate) vreg: VReg,
    pub(crate) role: Role,
    pub(crate) place: Place,
    /// The fixed register, the bank of a temporary, or the operands whose register a result had best take.
    wish: u8,
    /// The register, and whether the value is dead afterwards.
    outcome: u8,
    /// The position at which the value is wanted after this. For all but one of several uses by an instruction it may
    /// be that of the instruction.
    pub(crate) next: u32,
}

impl Operand {
    const DIES: u8 = 0x80;

    #[inline]
    pub(crate) fn new(vreg: VReg, role: Role, place: Place) -> Self {
        Self {
            vreg,
            role,
            place,
            wish: NO_TIE << 4 | NO_TIE,
            outcome: AT_HOME,
            next: 0,
        }
    }

    #[inline]
    pub(crate) fn fixed(vreg: VReg, role: Role, reg: Reg) -> Self {
        Self {
            wish: reg.index() as u8,
            ..Self::new(vreg, role, Place::Fixed)
        }
    }

    #[inline]
    pub(crate) fn given(reg: u8) -> Self {
        Self {
            outcome: reg,
            ..Self::new(VReg::NONE, Role::Use, Place::Given)
        }
    }

    #[inline]
    pub(crate) fn temp(bank: Bank) -> Self {
        Self {
            wish: bank as u8,
            ..Self::new(VReg::NONE, Role::Temp, Place::Register)
        }
    }

    #[inline]
    pub(crate) fn tied(vreg: VReg, first: u8, second: Option<u8>) -> Self {
        Self {
            wish: second.unwrap_or(NO_TIE) << 4 | first,
            ..Self::new(vreg, Role::Def, Place::Register)
        }
    }

    #[inline]
    pub(crate) fn fixed_register(self) -> u8 {
        debug_assert!(self.place == Place::Fixed);
        self.wish
    }

    #[inline]
    pub(crate) fn temp_bank(self) -> Bank {
        if self.wish == Bank::Gpr as u8 {
            Bank::Gpr
        } else {
            Bank::Fpr
        }
    }

    /// Positions among the operands of the instruction.
    #[inline]
    pub(crate) fn ties(self) -> impl Iterator<Item = usize> {
        [self.wish & NO_TIE, self.wish >> 4]
            .into_iter()
            .filter(|&tie| tie != NO_TIE)
            .map(usize::from)
    }

    #[inline]
    pub(crate) fn is_use(self) -> bool {
        matches!(self.role, Role::Use | Role::LateUse)
    }

    #[inline]
    pub(crate) fn assigned(self) -> u8 {
        self.outcome & !Self::DIES
    }

    #[inline]
    pub(crate) fn assign(&mut self, reg: u8) {
        self.outcome = self.outcome & Self::DIES | reg;
    }

    #[inline]
    pub(crate) fn dies(self) -> bool {
        self.outcome & Self::DIES != 0
    }

    #[inline]
    pub(crate) fn set_dies(&mut self, dies: bool) {
        self.outcome = self.outcome & !Self::DIES | if dies { Self::DIES } else { 0 };
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Head {
    pub(crate) first_operand: u32,
    pub(crate) operand_count: u16,
    /// Has an operand in a fixed register, or clobbers.
    pub(crate) is_constrained: bool,
    /// The results and temporaries, which come before the uses.
    pub(crate) result_count: u8,
    /// Is not constrained, reads at the start and writes at the end.
    pub(crate) is_plain: bool,
    pub(crate) has_late_uses: bool,
    pub(crate) site: Site,
    pub(crate) origin: Origin,
}

impl Head {
    #[inline]
    pub(crate) fn results(self) -> core::ops::Range<usize> {
        self.first_operand as usize..self.first_operand as usize + usize::from(self.result_count)
    }

    #[inline]
    pub(crate) fn uses(self) -> core::ops::Range<usize> {
        self.results().end..self.operands().end
    }

    #[inline]
    pub(crate) fn operands(self) -> core::ops::Range<usize> {
        self.first_operand as usize..self.first_operand as usize + usize::from(self.operand_count)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct SiteData {
    pub(crate) value: Value,
    pub(crate) is_exit: bool,
    pub(crate) state: State,
    pub(crate) state_vregs: Span<VReg>,
    /// An operand that the exit can compute back from the result, which may therefore take its register.
    pub(crate) recoverable: VReg,
    pub(crate) clobbers_early: RegisterSet,
    pub(crate) clobbers_late: RegisterSet,
    pub(crate) clobbers_upper_halves: RegisterSet,
    /// The allocator fills in the rest.
    pub(crate) state_assigned: Span<u8>,
    pub(crate) live_registers: RegisterSet,
    pub(crate) live_vectors: RegisterSet,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct BlockData {
    pub(crate) first: u32,
    pub(crate) end: u32,
    /// About how many registers of each bank are needed at most, beyond those for what is live at the start.
    pub(crate) pressure: [i32; 2],
    /// What the instructions clobber or need for themselves, other than those that leave nothing of a bank.
    pub(crate) claimed: RegisterSet,
    /// For each bank, how many instructions come before the first that clobbers all of it, plus one. Zero for none.
    pub(crate) barrier: [u32; 2],
    pub(crate) params: Span<VReg>,
}

impl BlockData {
    #[inline]
    pub(crate) fn entry(&self) -> Point {
        early(self.first as usize)
    }

    #[inline]
    pub(crate) fn exit(&self) -> Point {
        late(self.end as usize - 1)
    }
}

/// The uses of a value in a block that does not define it.
#[derive(Clone, Copy)]
pub(crate) struct ForeignUse {
    pub(crate) block: Block,
    pub(crate) vreg: VReg,
    /// `NEVER` if all of them are cold.
    pub(crate) first_warm: Point,
}

/// All that register allocation has to know of the instructions.
#[derive(Default)]
pub(crate) struct Code {
    pub(crate) heads: Vec<Head>,
    pub(crate) operands: Vec<Operand>,
    pub(crate) vregs: Table<VReg, VRegData>,
    /// With the last block that uses each.
    pub(crate) globals: Vec<(VReg, Block)>,
    pub(crate) foreign_uses: Vec<ForeignUse>,
    pub(crate) sites: Table<Site, SiteData>,
    pub(crate) blocks: Table<Block, BlockData>,
    pub(crate) edge_args: Table<Edge, Span<VReg>>,
    /// A value among the arguments of the edge that is known to equal a constant there, and the constant.
    pub(crate) edge_equalities: Table<Edge, (VReg, VReg)>,
    pub(crate) vreg_lists: Pool<VReg>,
    pub(crate) outgoing_bytes: u32,
}

impl Code {
    #[inline]
    pub(crate) fn params(&self, block: Block) -> &[VReg] {
        &self.vreg_lists[self.blocks[block].params]
    }

    #[inline]
    pub(crate) fn args(&self, edge: Edge) -> &[VReg] {
        &self.vreg_lists[self.edge_args[edge]]
    }
}

/// The registers of an architecture, as the allocator sees them.
#[derive(Clone, Copy)]
pub(crate) struct Registers {
    pub(crate) allocatable: RegisterSet,
    /// Taken last, to leave them to values that live across calls.
    pub(crate) kept_by_calls: RegisterSet,
    /// Cycles of moves between general registers are resolved by exchanging, not through a scratch register.
    pub(crate) swaps_gprs: bool,
    /// An instruction can read a float or vector constant from memory.
    pub(crate) addresses_float_constants: bool,
}
