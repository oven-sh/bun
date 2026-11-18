//! What an instruction reads and writes, and where it jumps.

use crate::code::{Body, IntCases};
use crate::instruction::{Flow, Opcode, RawInstruction, Shape};
use crate::operand::{Field, Jump, Narrow, Operand, Register, SuspendPointIndex};

/// The registers `first.nth(0)` to `first.nth(count - 1)`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Run {
    pub first: Register,
    pub count: u32,
}

impl Run {
    #[inline(always)]
    fn one(first: Register) -> Run {
        Run { first, count: 1 }
    }

    pub fn registers(self) -> impl Iterator<Item = Register> {
        (0..self.count).map(move |index| self.first.nth(index))
    }

    #[inline]
    pub fn contains(self, register: Register) -> bool {
        (self.first.offset().wrapping_sub(register.offset()) as u32) < self.count
    }
}

/// On which ways out an instruction has written a register. The way to a handler is never among them.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Written {
    Always,
    IfJumps,
    UnlessJumps,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum EdgeKind {
    FallThrough,
    Jump,
    Throw,
}

impl Written {
    pub fn holds_on(self, edge: EdgeKind) -> bool {
        match edge {
            EdgeKind::FallThrough => self != Written::IfJumps,
            EdgeKind::Jump => self != Written::UnlessJumps,
            EdgeKind::Throw => false,
        }
    }
}

/// How control gets to a `resume`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Resumption {
    /// From `resume_dispatch`, with the registers that were saved.
    Dispatched,
    /// From the instruction before, as if the frame stayed: tells what has to be saved. `resume` reads what the
    /// table asks to be saved in any case.
    Direct,
}

/// A bit for each operand.
#[derive(Clone, Copy)]
struct Roles {
    read: u8,
    written: u8,
    /// What says more than that one register is read or always written.
    other_reads: u8,
    other_writes: u8,
    targets: u8,
    branches: bool,
}

static ROLES: [Roles; Opcode::COUNT] = {
    let mut all = [Roles {
        read: 0,
        written: 0,
        other_reads: 0,
        other_writes: 0,
        targets: 0,
        branches: false,
    }; Opcode::COUNT];
    let mut opcode = 0;
    while opcode < Opcode::COUNT {
        let (roles, shapes) = (&mut all[opcode], Opcode::ALL[opcode].shapes());
        roles.branches = opcode == Opcode::ResumeDispatch as usize;
        let mut index = 0;
        while index < shapes.len() {
            let bit = 1 << index;
            match shapes[index] {
                Shape::Reg | Shape::Src => roles.read |= bit,
                Shape::Dst => roles.written |= bit,
                Shape::Mut => {
                    roles.read |= bit;
                    roles.written |= bit;
                }
                Shape::Reg2 | Shape::Reg3 | Shape::First | Shape::ArgumentCount => {
                    roles.other_reads |= bit;
                }
                Shape::DstIfJumps
                | Shape::DstUnlessJumps
                | Shape::Dst2
                | Shape::Dst3
                | Shape::Variables => roles.other_writes |= bit,
                Shape::Mut3 => {
                    roles.other_reads |= bit;
                    roles.other_writes |= bit;
                }
                Shape::Target => {
                    roles.targets |= bit;
                    roles.branches = true;
                }
                Shape::IntSwitch | Shape::StringSwitch => roles.branches = true,
                _ => {}
            }
            index += 1;
        }
        opcode += 1;
    }
    all
};

/// For a narrow instruction that reads and always writes single registers, and writes none after the second.
#[derive(Clone, Copy)]
#[repr(align(16))]
struct PlainRoles {
    /// A mask for the byte of each operand.
    read: u64,
    written: u16,
    /// Zero for the others.
    size: u8,
    can_throw: bool,
}

static PLAIN_ROLES: [PlainRoles; 256] = {
    let mut all = [PlainRoles {
        read: 0,
        written: 0,
        size: 0,
        can_throw: false,
    }; 256];
    let mut index = Opcode::Wide32Prefix as usize + 1;
    while index < Opcode::COUNT {
        let (opcode, roles) = (Opcode::ALL[index], ROLES[index]);
        if roles.other_reads | roles.other_writes | roles.written >> 2 == 0
            && !matches!(opcode.shapes(), [.., Shape::SuspendPoint])
        {
            let mut operand = 0;
            while operand < Opcode::MAX_OPERANDS {
                all[index].read |= (0xff * (roles.read >> operand & 1) as u64) << (8 * operand);
                operand += 1;
            }
            all[index].written =
                (0xff * (roles.written & 1) as u16) | (0xff00 * (roles.written >> 1) as u16);
            all[index].size = opcode.size::<Narrow>() as u8;
            all[index].can_throw = opcode.flow().can_throw();
        }
        index += 1;
    }
    all
};

/// By the byte of a narrow operand.
static BITS_OF_FIRST_LOCALS: [u64; 256] = {
    let mut bits = [0; 256];
    let mut local = 0;
    while local < 64 {
        bits[255 - local] = 1 << local;
        local += 1;
    }
    bits
};

/// What an instruction does to locals 0 to 63, a bit for each.
pub(crate) struct PlainEffects {
    pub(crate) read: u64,
    pub(crate) written: u64,
    pub(crate) can_throw: bool,
    pub(crate) size: u32,
}

impl PlainEffects {
    /// `None` for all but the most common instructions.
    #[inline(always)]
    pub(crate) fn read(code: &[u8], offset: u32) -> Option<PlainEffects> {
        let bytes = code.get(offset as usize..offset as usize + 9)?;
        let roles = &PLAIN_ROLES[usize::from(bytes[0])];
        let operands = u64::from_le_bytes(*bytes[1..].first_chunk()?);
        let bits = |operands: u64, count: usize| {
            (0..count).fold(0, |all, index| {
                all | BITS_OF_FIRST_LOCALS[usize::from((operands >> (8 * index)) as u8)]
            })
        };
        (roles.size != 0).then(|| PlainEffects {
            read: bits(operands & roles.read, Opcode::MAX_OPERANDS),
            written: bits(operands & u64::from(roles.written), 2),
            can_throw: roles.can_throw,
            size: u32::from(roles.size),
        })
    }
}

#[inline(always)]
fn for_each_bit(mut bits: u8, mut visit: impl FnMut(usize)) {
    while bits != 0 {
        visit(bits.trailing_zeros() as usize);
        bits &= bits - 1;
    }
}

/// Without the registers that a suspend point saves.
#[inline(always)]
fn for_each_operand_use(opcode: Opcode, words: &[u32], mut visit: impl FnMut(Run)) {
    let roles = ROLES[opcode as usize];
    for_each_bit(roles.read, |index| {
        if let Some(register) = Operand::from_word(words[index]).as_register() {
            visit(Run::one(register));
        }
    });
    for_each_bit(roles.other_reads, |index| {
        let register = Register::from_word(words[index]);
        let (first, count) = match opcode.shapes()[index] {
            Shape::Reg2 => (register, 2),
            Shape::First => (register, words[index + 1]),
            Shape::ArgumentCount => {
                let count = words[index].saturating_sub(1);
                let lowest = Register::outgoing_argument(words[index + 1], 0);
                (lowest.nth(count.wrapping_neg()).nth(1), count)
            }
            _ => (register, 3),
        };
        if count != 0 {
            visit(Run { first, count });
        }
    });
}

/// Without the registers that a suspend point restores.
#[inline(always)]
pub(crate) fn for_each_operand_def(
    opcode: Opcode,
    words: &[u32],
    mut visit: impl FnMut(Run, Written),
) {
    let roles = ROLES[opcode as usize];
    for_each_bit(roles.written, |index| {
        visit(Run::one(Register::from_word(words[index])), Written::Always);
    });
    for_each_bit(roles.other_writes, |index| {
        let register = Register::from_word(words[index]);
        let (first, count, written) = match opcode.shapes()[index] {
            Shape::DstIfJumps => (register, 1, Written::IfJumps),
            Shape::DstUnlessJumps => (register, 1, Written::UnlessJumps),
            Shape::Dst2 => (register, 2, Written::Always),
            Shape::Variables => (
                Register::SCOPE,
                words[index].saturating_add(1),
                Written::Always,
            ),
            _ => (register, 3, Written::Always),
        };
        visit(Run { first, count }, written);
    });
}

impl Opcode {
    /// Whether it has a target, as an operand or in a table.
    #[inline(always)]
    pub fn branches(self) -> bool {
        ROLES[self as usize].branches
    }

    /// Of the instruction at `offset`, if it is narrow and has just one.
    #[inline(always)]
    pub(crate) fn only_target(self, code: &[u8], offset: u32) -> Option<u32> {
        let targets = ROLES[self as usize].targets;
        let bytes = &code[offset as usize..];
        (bytes[0] == self as u8 && targets.is_power_of_two())
            .then(|| Jump::read::<Narrow>(bytes, targets.trailing_zeros() as usize).from(offset))
    }
}

impl RawInstruction {
    fn saved_registers(&self, body: &Body) -> impl Iterator<Item = Run> {
        let point = SuspendPointIndex(self.words()[self.words().len() - 1]);
        (body.saved_registers(point).iter()).map(|it| Run::one(it.register))
    }

    /// The slots that it names. What reads the arguments as the caller passed them names none.
    #[inline]
    pub fn for_each_use(&self, body: &Body, visit: impl FnMut(Run)) {
        self.for_each_use_with(body, Resumption::Dispatched, visit);
    }

    #[inline(always)]
    pub(crate) fn for_each_use_with(
        &self,
        body: &Body,
        resumption: Resumption,
        mut visit: impl FnMut(Run),
    ) {
        for_each_operand_use(self.opcode, self.words(), &mut visit);
        if let (Opcode::Suspend | Opcode::Await, Resumption::Dispatched)
        | (Opcode::Resume, Resumption::Direct) = (self.opcode, resumption)
        {
            self.saved_registers(body).for_each(visit);
        }
    }

    /// Without the frame of a callee, where nothing outlives the call.
    #[inline]
    pub fn for_each_def(&self, body: &Body, visit: impl FnMut(Run, Written)) {
        self.for_each_def_with(body, Resumption::Dispatched, visit);
    }

    #[inline(always)]
    pub(crate) fn for_each_def_with(
        &self,
        body: &Body,
        resumption: Resumption,
        mut visit: impl FnMut(Run, Written),
    ) {
        for_each_operand_def(self.opcode, self.words(), &mut visit);
        if self.opcode == Opcode::Resume && resumption == Resumption::Dispatched {
            let saved = self.saved_registers(body);
            saved.for_each(|run| visit(run, Written::Always));
        }
    }

    /// Where the instruction at `offset` may jump. An offset can come more than once.
    pub fn for_each_target(&self, body: &Body, offset: u32, mut visit: impl FnMut(u32)) {
        let words = self.words();
        match self.opcode {
            Opcode::SwitchInt | Opcode::SwitchChar => {
                let switch = &body.int_switches()[words[1] as usize];
                visit(switch.default);
                match &switch.cases {
                    IntCases::Dense { targets, .. } => targets.iter().copied().for_each(visit),
                    IntCases::Sparse(cases) => cases.iter().for_each(|case| visit(case.1)),
                }
            }
            Opcode::SwitchString => {
                let switch = &body.string_switches()[words[1] as usize];
                visit(switch.default);
                switch.targets.iter().copied().for_each(visit);
            }
            Opcode::ResumeDispatch => {
                let points = body.suspend_points().iter();
                points.for_each(|point| visit(point.resume));
            }
            opcode => for_each_bit(ROLES[opcode as usize].targets, |index| {
                visit(Jump(words[index] as i32).from(offset));
            }),
        }
    }

    /// Where control may go in this frame after the instruction at `offset`. An offset can come more than once.
    pub fn for_each_successor(
        &self,
        body: &Body,
        offset: u32,
        mut visit: impl FnMut(u32, EdgeKind),
    ) {
        self.for_each_target(body, offset, |target| visit(target, EdgeKind::Jump));
        let flow = self.opcode.flow();
        if flow.falls_through() {
            visit(offset + u32::from(self.size), EdgeKind::FallThrough);
        }
        if flow.can_throw()
            && let Some(handler) = body.handler_for(offset)
        {
            visit(handler.target, EdgeKind::Throw);
        }
    }
}

impl Resumption {
    #[inline(always)]
    pub(crate) fn falls_through(self, flow: Flow) -> bool {
        flow.falls_through() || (flow == Flow::Suspends && self == Resumption::Direct)
    }

    #[inline(always)]
    pub(crate) fn branches(self, opcode: Opcode) -> bool {
        opcode.branches() && (opcode != Opcode::ResumeDispatch || self == Resumption::Dispatched)
    }
}
