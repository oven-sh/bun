//! What instruction selection does alike for every architecture.
//!
//! It goes backward through blocks and instructions, so a use is seen before the definition, and the last use first.

use bun_engine_asm::{Bank, Cond, Gpr, Reg, RegisterSet, Sign};

use super::code::{
    BlockData, Class, Code, ForeignUse, Head, Home, LOCAL, NEVER, Operand, Place, Point, Role,
    Site, SiteData, VReg, VRegData, Wish,
};
use crate::analysis::{Cfg, Frequencies, Loop};
use crate::ir::{
    Action, Binary, Block, Boundary, Edge, EffectFlags, Entity, Function, Input, Op, Origin,
    Output, Patchpoint, PatchpointFlags, Slot, Span, State, Table, Type, Unary, Value,
};

/// The instructions that lowering itself needs of an architecture.
pub(crate) trait Instruction: Copy + core::fmt::Debug {
    type Features: Copy;
    /// What instruction selection remembers while it goes through a function.
    type Selection: Default;

    /// Result, source.
    const COPY: Self;
    /// Result, source. Clears the upper half.
    const ZERO_EXTEND: Self;
    const JUMP: Self;
    const RETURN: Self;
    const UNREACHABLE: Self;
    /// Results, temporaries, operands.
    const PATCHPOINT: Self;
    const FRAME_POINTER: Gpr;

    /// Source, anywhere. The offset is from the stack pointer.
    fn store_outgoing(offset: i32, ty: Type) -> Self;
    fn load_outgoing(offset: i32, ty: Type) -> Self;
    /// Source, anywhere. The offset is from the frame pointer.
    fn store_result(offset: i32, ty: Type) -> Self;

    /// The code for an operation that gives an I32 may leave anything in the upper half of the register.
    fn fills_upper_half(function: &Function, op: Op) -> bool;

    /// Putting the constant in a register costs no more than a move from another.
    fn is_as_cheap_as_a_move(ty: Type, bits: u64) -> bool;

    /// Where an integer that goes to the frame has to be, given its bits if it is a constant.
    fn place_to_store_from(constant: Option<u64>) -> Place;

    fn lower(lowering: &mut Lowering<'_, Self>, value: Value);
}

#[derive(Default)]
pub(crate) struct LoweringTables {
    uses: Table<Value, u32>,
    vregs: Table<Value, VReg>,
    is_absorbed: Table<Value, bool>,
    states: Table<State, (Span<VReg>, Block)>,
    scratch: Vec<VReg>,
    /// Arguments to extend with zeros before the block ends: result and source.
    extensions: Vec<(VReg, VReg)>,
    /// The outermost natural loop around each loop, or the loop itself. Constants are shared within it.
    regions: Table<Loop, Loop>,
    /// The constants that have been used since the walk came to the current region.
    floating: Vec<Value>,
}

pub(crate) struct Lowering<'a, I: Instruction> {
    pub(crate) features: I::Features,
    pub(crate) function: &'a mut Function,
    pub(crate) cfg: &'a Cfg,
    pub(crate) selection: I::Selection,
    frequencies: &'a Frequencies,
    slot_offsets: &'a Table<Slot, i32>,
    code: &'a mut Code,
    instructions: &'a mut Vec<I>,
    tables: &'a mut LoweringTables,
    block: Block,
    region: Loop,
    is_cold: bool,
    origin: Origin,
    first_operand: usize,
    is_constrained: bool,
    site: Site,
    /// How many more values are live here than at the end of the block.
    live: [i32; 2],
    most_live: [i32; 2],
    claimed: RegisterSet,
    /// By the current instruction.
    claimed_here: RegisterSet,
    /// The banks that the current instruction clobbers entirely.
    lost_here: RegisterSet,
    allocatable: RegisterSet,
    barrier: [Option<u32>; 2],
}

/// How far a load is looked for from its user.
const REACH_OF_FUSION: usize = 16;

pub(crate) fn lower<I: Instruction>(
    function: &mut Function,
    cfg: &Cfg,
    frequencies: &Frequencies,
    features: I::Features,
    allocatable: RegisterSet,
    slot_offsets: &Table<Slot, i32>,
    code: &mut Code,
    instructions: &mut Vec<I>,
    tables: &mut LoweringTables,
) {
    count_uses(function, cfg, &mut tables.uses);
    tables.vregs.refill(function.value_count(), VReg::NONE);
    tables.is_absorbed.refill(function.value_count(), false);
    tables
        .states
        .refill(function.state_count(), (Span::default(), Block::NONE));
    tables.floating.clear();
    tables.regions.clear();
    for (found, data) in cfg.loops().keys().zip(cfg.loops().values()) {
        let around = data.parent.expand().map(|parent| tables.regions[parent]);
        let own = if data.is_natural { found } else { Loop::NONE };
        (tables.regions).push(around.and_then(Loop::expand).unwrap_or(own));
    }
    instructions.clear();
    code.heads.clear();
    code.operands.clear();
    code.vregs.clear();
    code.globals.clear();
    code.foreign_uses.clear();
    code.sites.clear();
    code.vreg_lists.clear();
    code.blocks
        .refill(function.block_count(), BlockData::default());
    code.edge_args
        .refill(function.edge_count(), Span::default());
    (code.edge_equalities).refill(function.edge_count(), (VReg::NONE, VReg::NONE));
    code.outgoing_bytes = function.outgoing_bytes;
    let mut lowering = Lowering {
        features,
        function,
        cfg,
        selection: Default::default(),
        frequencies,
        slot_offsets,
        code,
        instructions,
        tables,
        block: Block::NONE,
        region: Loop::NONE,
        is_cold: false,
        origin: Origin::default(),
        first_operand: 0,
        is_constrained: false,
        site: Site::NONE,
        live: [0; 2],
        most_live: [0; 2],
        claimed: RegisterSet::EMPTY,
        claimed_here: RegisterSet::EMPTY,
        lost_here: RegisterSet::EMPTY,
        allocatable,
        barrier: [None; 2],
    };
    for &block in cfg.order().iter().rev() {
        lowering.lower_block(block);
    }
    lowering.turn_around();
}

fn count_uses(function: &Function, cfg: &Cfg, uses: &mut Table<Value, u32>) {
    uses.refill(function.value_count(), 0);
    for &block in cfg.order() {
        let mut counted = State::NONE;
        for value in function.instructions(block) {
            function
                .operands(value)
                .iter()
                .for_each(|&operand| uses[operand] += 1);
            let state = function.state_of(value);
            if !state.is_none() && state != counted {
                function
                    .state(state)
                    .iter()
                    .for_each(|&operand| uses[operand] += 1);
                counted = state;
            }
        }
        for edge in function.successors(block) {
            function.args(edge).iter().for_each(|&arg| uses[arg] += 1);
        }
    }
}

impl<I: Instruction> Lowering<'_, I> {
    fn lower_block(&mut self, block: Block) {
        self.block = block;
        self.is_cold = self.frequencies.is_cold(block);
        let around = self.cfg.loop_of(block).expand();
        let region = around.map_or(Loop::NONE, |around| self.tables.regions[around]);
        if core::mem::replace(&mut self.region, region) != region {
            for value in self.tables.floating.drain(..) {
                self.tables.vregs[value] = VReg::NONE;
            }
        }
        (self.live, self.most_live) = Default::default();
        self.claimed = RegisterSet::EMPTY;
        self.barrier = [None; 2];
        let after = self.instructions.len() as u32;

        let last = self.function.last(block);
        self.origin = self.function.origin(last);
        self.lower_args(block);
        self.lower_value(last);
        while let Some((extended, source)) = self.tables.extensions.pop() {
            self.push_def(Operand::new(extended, Role::Def, Place::Register));
            self.push_use(source, Role::Use, Place::RegisterOrMemory);
            self.finish(I::ZERO_EXTEND);
        }
        let mut value = self.function.previous(last);
        while !value.is_none() {
            let is_wanted =
                !self.tables.vregs[value].is_none() || self.function.effects(value).must_execute();
            if is_wanted && !self.tables.is_absorbed[value] {
                self.origin = self.function.origin(value);
                self.lower_value(value);
            }
            value = self.function.previous(value);
        }

        self.define_params(block);
        let data = &mut self.code.blocks[block];
        (data.first, data.end) = (self.instructions.len() as u32, after);
        data.pressure = [0, 1].map(|bank| self.most_live[bank] - self.live[bank]);
        data.claimed = self.claimed;
        data.barrier = self
            .barrier
            .map(|position| position.map_or(0, |position| data.first - position));
    }

    fn lower_args(&mut self, block: Block) {
        for edge in self.function.successors(block) {
            let (target, count) = (self.function.target(edge), self.function.args(edge).len());
            let args = self
                .code
                .vreg_lists
                .add(core::iter::repeat_n(VReg::NONE, count));
            self.code.edge_args[edge] = args;
            let is_backward = self.cfg.is_backward(self.function, edge);
            for position in 0..count {
                let param = self.function.params(target)[position];
                if !self.is_materialized(param) && (!is_backward || self.tables.uses[param] == 0) {
                    continue;
                }
                let param = self.vreg(param);
                let value = self.function.args(edge)[position];
                let mut arg = self.vreg_to_copy(value);
                if self.code.vregs[arg].is_floating()
                    && let Some(equal) = self.found_equal(block, edge, value)
                    && self.code.vregs[equal].class == self.code.vregs[param].class
                {
                    self.code.edge_equalities[edge] = (equal, arg);
                    arg = equal;
                }
                if self.code.vregs[param].class == Class::Int32
                    && self.code.vregs[arg].class == Class::Int64
                {
                    let extended = self.new_vreg(Class::Int32);
                    self.tables.extensions.push((extended, arg));
                    arg = extended;
                }
                let is_last = self.note_use(arg, Role::LateUse, !self.function.is_rare(edge));
                if (is_last || is_backward) && arg != param && self.ends_at_last_use(arg) {
                    self.appoint_heir(arg, param, is_backward);
                }
                self.code.vreg_lists[args][position] = arg;
            }
        }
    }

    /// The value that the branch at the end of the block has found to equal the constant if it takes the edge.
    fn found_equal(&mut self, block: Block, edge: Edge, constant: Value) -> Option<VReg> {
        let Op::Branch(condition) = self.op(self.function.last(block)) else {
            return None;
        };
        let holds = edge == self.function.successor(block, 0);
        let value = match self.op(condition) {
            Op::Compare(Cond::Eq, [lhs, rhs]) if holds && rhs == constant => lhs,
            Op::Compare(Cond::Ne, [lhs, rhs]) if !holds && rhs == constant => lhs,
            Op::Compare(..) => return None,
            _ if !holds && self.int_constant(constant) == Some(0) => condition,
            _ => return None,
        };
        let has_register = self.is_materialized(value) || matches!(self.op(value), Op::Param(_));
        let is_alike = self.type_of(value) == self.type_of(constant);
        (has_register && is_alike && self.representative(value) == value).then(|| self.vreg(value))
    }

    fn appoint_heir(&mut self, vreg: VReg, heir: VReg, is_final: bool) {
        let VRegData { wish, goal, .. } = self.code.vregs[heir];
        let is_defined_as_often = self.runs_as_often_as_definition(vreg);
        let data = &mut self.code.vregs[vreg];
        (data.heir, data.goal) = (heir, if is_final { heir } else { goal });
        data.wish = match (data.wish, wish) {
            (Wish::None, Wish::Firm(reg) | Wish::Lasting(reg)) if !is_defined_as_often => {
                Wish::Weak(reg)
            }
            (Wish::None, Wish::Lasting(reg)) => Wish::Firm(reg),
            (Wish::None, inherited) => inherited,
            (own, _) => own,
        };
    }

    fn runs_as_often_as_definition(&self, vreg: VReg) -> bool {
        let defined_in = self.code.vregs[vreg].block.expand();
        let defined_in = defined_in.and_then(|block| self.cfg.loop_of(block).expand());
        defined_in.is_none_or(|around| self.cfg.includes(around, self.block))
    }

    /// No loop around this block comes back for the value.
    #[inline]
    fn ends_at_last_use(&self, vreg: VReg) -> bool {
        let data = &self.code.vregs[vreg];
        !data.is_floating()
            && self
                .cfg
                .loop_of(self.block)
                .expand()
                .is_none_or(|own| self.cfg.includes(own, data.block))
    }

    fn define_params(&mut self, block: Block) {
        let vregs = &self.tables.vregs;
        let params = self.code.vreg_lists.add(
            self.function
                .params(block)
                .iter()
                .map(|&param| vregs[param]),
        );
        self.code.blocks[block].params = params;
        // After turning around this is the point at which the first instruction reads.
        let entry = self.reversed_point(Role::Use) - 2;
        for position in 0..params.len() {
            if let Some(param) = self.code.vreg_lists[params][position].expand() {
                self.note_def(param, entry);
            }
        }
    }

    fn turn_around(&mut self) {
        self.instructions.reverse();
        self.code.heads.reverse();
        let count = self.instructions.len() as u32;
        for &block in self.cfg.order() {
            let data = &mut self.code.blocks[block];
            (data.first, data.end) = (count - data.first, count - data.end);
        }
        let turn = |point: Point| {
            if point == NEVER {
                NEVER
            } else {
                count * 2 - 1 - point
            }
        };
        for data in self.code.vregs.values_mut() {
            (data.start, data.end) = (turn(data.start), turn(data.end));
        }
        for foreign in &mut self.code.foreign_uses {
            foreign.first_warm = turn(foreign.first_warm);
        }
    }

    /// Points count from the end while lowering goes on.
    #[inline]
    fn reversed_point(&self, role: Role) -> Point {
        self.instructions.len() as Point * 2
            + Point::from(matches!(role, Role::Use | Role::EarlyDef | Role::Temp))
    }

    fn lower_value(&mut self, value: Value) {
        match *self.function.op(value) {
            Op::Jump => self.finish(I::JUMP),
            Op::Unreachable => self.finish(I::UNREACHABLE),
            Op::Return(_) => self.lower_return(value),
            Op::Patchpoint(patchpoint) => self.lower_patchpoint(value, patchpoint),
            Op::Extract(..) => {}
            _ => I::lower(self, value),
        }
    }

    // Values

    #[inline]
    pub(crate) fn op(&self, value: Value) -> Op {
        *self.function.op(value)
    }

    #[inline]
    pub(crate) fn type_of(&self, value: Value) -> Type {
        self.function.type_of(value)
    }

    #[inline]
    pub(crate) fn int_constant(&self, value: Value) -> Option<i64> {
        self.function.int_constant(value)
    }

    #[inline]
    pub(crate) fn constant_bits(&self, value: Value) -> Option<u64> {
        self.function.constant_bits(value)
    }

    #[inline]
    pub(crate) fn use_count(&self, value: Value) -> u32 {
        self.tables.uses[value]
    }

    /// Some later instruction needs the value in a register of its own.
    #[inline]
    pub(crate) fn is_materialized(&self, value: Value) -> bool {
        !self.tables.vregs[value].is_none()
    }

    /// Some instruction that runs after this one reads the register of the value.
    pub(crate) fn lives_on(&self, value: Value) -> bool {
        let vreg = self.tables.vregs[self.representative(value)].expand();
        match vreg {
            Some(vreg) => self.code.vregs[vreg].end != NEVER || !self.ends_at_last_use(vreg),
            None => !self.is_in_this_block(value) && self.comes_from_outside_loop(value),
        }
    }

    fn comes_from_outside_loop(&self, value: Value) -> bool {
        let home = self.function.block_of(self.representative(value));
        let around = self.cfg.loop_of(self.block).expand();
        home.is_none() || around.is_some_and(|around| !self.cfg.includes(around, home))
    }

    /// Whether the register of `other` is a better one for `result` than that of `operand`.
    pub(crate) fn suits_result_better(
        &mut self,
        other: Value,
        operand: Value,
        result: Value,
    ) -> bool {
        let [other, operand] = [other, operand].map(|value| {
            let vregs = [self.representative(value), result].map(|value| self.tables.vregs[value]);
            let belong_together = !vregs.contains(&VReg::NONE)
                && [vregs[0], self.code.vregs[vregs[0]].goal]
                    .contains(&self.code.vregs[vregs[1]].goal);
            (!self.lives_on(value), belong_together)
        });
        other > operand
    }

    /// For looking at the definition of `value` as its only user would.
    pub(crate) fn as_if_used_once<T>(
        &mut self,
        value: Value,
        look: impl FnOnce(&mut Self) -> T,
    ) -> T {
        let vreg = core::mem::replace(&mut self.tables.vregs[value], VReg::NONE);
        let uses = core::mem::replace(&mut self.tables.uses[value], 1);
        let seen = look(self);
        (self.tables.vregs[value], self.tables.uses[value]) = (vreg, uses);
        seen
    }

    pub(crate) fn slot_offset(&self, slot: Slot) -> i32 {
        self.slot_offsets[slot]
    }

    fn make_room_for(&mut self, value: Value) -> Value {
        self.tables.vregs.grow_to(value.index() + 1, VReg::NONE);
        self.tables.uses.grow_to(value.index() + 1, 0);
        self.tables.is_absorbed.grow_to(value.index() + 1, false);
        value
    }

    pub(crate) fn intern(&mut self, ty: Type, bits: u64) -> Value {
        let value = self.function.constant(ty, bits);
        self.make_room_for(value)
    }

    pub(crate) fn intern_displaced(&mut self, reg: Gpr, offset: i32) -> Value {
        let value = self.function.displaced(reg, offset);
        self.make_room_for(value)
    }

    /// Adds a pure instruction before `next`, which is the current one or has not been lowered yet.
    pub(crate) fn insert_before(&mut self, next: Value, op: Op, ty: Type) -> Value {
        for &operand in op.inline_operands() {
            self.tables.uses[operand] += 1;
        }
        self.insert_replacement(next, op, ty)
    }

    /// For an instruction that takes its operands over from others, which nothing is going to use.
    pub(crate) fn insert_replacement(&mut self, next: Value, op: Op, ty: Type) -> Value {
        let value = self.function.insert_before(next, op, ty, self.origin);
        self.make_room_for(value)
    }

    /// Computing a pure value again here does not move work into a loop.
    #[inline]
    pub(crate) fn is_nearby(&self, value: Value) -> bool {
        let home = self.function.block_of(value);
        home == self.block
            || !home.is_none() && self.cfg.loop_of(home) == self.cfg.loop_of(self.block)
    }

    #[inline]
    pub(crate) fn is_in_loop(&self) -> bool {
        !self.is_cold && !self.cfg.loop_of(self.block).is_none()
    }

    /// The end of the only block from which the loop around here is entered, if `value` has been computed by then.
    pub(crate) fn before_loop(&self, value: Value) -> Option<Value> {
        let (cfg, function) = (self.cfg, &*self.function);
        let around = cfg.loop_of(self.block).expand()?;
        let home = function.block_of(value).expand()?;
        let data = &cfg.loops()[around];
        let edges = cfg.predecessors(data.header).iter();
        let mut entering = edges.filter(|&&edge| !cfg.is_backward(function, edge));
        let last = function.last(function.source(*entering.next()?));
        let is_at_hand = last != value && !cfg.includes(around, home);
        (data.is_natural && entering.next().is_none() && is_at_hand).then_some(last)
    }

    pub(crate) fn is_element_used(&self, tuple: Value, position: u32) -> bool {
        let first = self.tables.vregs[tuple];
        !first.is_none() && self.code.vregs[VReg(first.0 + position)].end != NEVER
    }

    #[inline]
    pub(crate) fn is_in_this_block(&self, value: Value) -> bool {
        self.function.block_of(value) == self.block
    }

    /// Whether a load that has one use can be done as late as `user`.
    pub(crate) fn can_absorb(&self, value: Value, user: Value) -> bool {
        if self.tables.uses[value] != 1
            || !self.is_in_this_block(value)
            || self.is_materialized(value)
        {
            return false;
        }
        let effects = self.function.effects(value);
        if effects.has(EffectFlags::FENCE) {
            return false;
        }
        let mut between = self.function.previous(user);
        for _ in 0..REACH_OF_FUSION {
            if between == value {
                return true;
            }
            if between.is_none() {
                return false;
            }
            let other = self.function.effects(between);
            let keeps_order = if effects.has(EffectFlags::EXITS) {
                other.must_execute() || other.has(EffectFlags::CONTROL_DEPENDENT)
            } else {
                other.has(EffectFlags::FENCE)
                    || self.function.may_alias(effects.reads, other.writes)
            };
            if keeps_order {
                return false;
            }
            between = self.function.previous(between);
        }
        false
    }

    pub(crate) fn is_absorbed(&self, value: Value) -> bool {
        self.tables.is_absorbed[value]
    }

    /// From now on the value is going to have a register of its own.
    pub(crate) fn materialize(&mut self, value: Value) {
        self.vreg(value);
    }

    pub(crate) fn absorb(&mut self, value: Value) {
        self.tables.is_absorbed[value] = true;
        if self.function.effects(value).has(EffectFlags::EXITS) {
            self.origin = self.function.origin(value);
        }
    }

    /// The register of an I32 has its upper half clear.
    pub(crate) fn is_zero_extended(&self, mut value: Value) -> bool {
        loop {
            value = match self.op(value) {
                Op::Unary(Unary::Opaque, inner) | Op::Extract(inner, _) => inner,
                Op::Unary(Unary::Wrap, wide) => return self.fits_in_lower_half(wide),
                Op::Param(_) => {
                    return self.boundary_of(value).is_none_or(|boundary| {
                        self.function.params_are_extended
                            && matches!(boundary, Boundary::Register(_))
                    });
                }
                Op::Patchpoint(patchpoint) => {
                    let data = self.function.patchpoint(patchpoint);
                    // No instruction can follow a call that ends a block, so the emitter extends what it returns.
                    return !data.flags.contains(PatchpointFlags::UNEXTENDED_RESULTS)
                        || data.effects.has(EffectFlags::ENDS_BLOCK);
                }
                op => return !I::fills_upper_half(self.function, op),
            }
        }
    }

    /// For an I64.
    pub(crate) fn fits_in_lower_half(&self, value: Value) -> bool {
        match self.op(value) {
            Op::Const64(bits) => bits.get() >> 32 == 0,
            Op::Binary(Binary::Shr, [_, amount]) => self
                .constant_bits(amount)
                .is_some_and(|amount| amount % 64 >= 32),
            Op::Binary(Binary::And, [_, mask]) => {
                self.constant_bits(mask).is_some_and(|mask| mask >> 32 == 0)
            }
            Op::Unary(op, _) => matches!(
                op,
                Unary::Widen(Sign::Unsigned)
                    | Unary::CountLeadingZeros
                    | Unary::CountTrailingZeros
                    | Unary::CountOnes
            ),
            _ => false,
        }
    }

    /// For a parameter of an entry.
    fn boundary_of(&self, param: Value) -> Option<Boundary> {
        let (Op::Param(position), block) = (self.op(param), self.function.block_of(param)) else {
            return None;
        };
        if !self.cfg.predecessors(block).is_empty() {
            return None;
        }
        let entry = *self
            .function
            .entries()
            .iter()
            .find(|entry| entry.block == block)?;
        Some(self.function.entry_params(entry)[position as usize])
    }

    /// The value whose register already holds the bits of `value`.
    pub(crate) fn representative(&self, mut value: Value) -> Value {
        loop {
            value = match self.op(value) {
                Op::Unary(Unary::Wrap | Unary::Opaque, inner) => inner,
                Op::Unary(Unary::Widen(Sign::Unsigned), inner) if self.is_zero_extended(inner) => {
                    inner
                }
                _ => return value,
            }
        }
    }

    fn new_vreg(&mut self, class: Class) -> VReg {
        self.add_vreg(class, Home::Spill, self.block)
    }

    #[inline]
    fn add_vreg(&mut self, class: Class, home: Home, block: Block) -> VReg {
        let vreg = VReg::from_index(self.code.vregs.len());
        self.code.vregs.push(VRegData {
            class,
            wish: Wish::None,
            home,
            block,
            global: LOCAL,
            start: NEVER,
            end: NEVER,
            heir: VReg::NONE,
            goal: vreg,
            foreign_use: u32::MAX,
        })
    }

    #[inline]
    fn vreg(&mut self, value: Value) -> VReg {
        let value = self.representative(value);
        self.tables.vregs[value]
            .expand()
            .unwrap_or_else(|| self.create_vreg(value))
    }

    /// For a use that moves the value to another place, and so gains nothing from a simple constant in a register.
    fn vreg_to_copy(&mut self, value: Value) -> VReg {
        let value = self.representative(value);
        let ty = self.type_of(value);
        match self.constant_bits(value) {
            Some(bits) if I::is_as_cheap_as_a_move(ty, bits) => {
                let class = if bits >> 32 == 0 && ty.is_int() {
                    Class::Int32
                } else {
                    Class::of(ty)
                };
                self.add_vreg(class, Home::Constant(value), Block::NONE)
            }
            _ => match self.op(value) {
                Op::Pinned(_) | Op::SlotAddress(_) | Op::Displaced(..) => {
                    self.add_vreg(Class::Int64, self.home_of_floating(value), Block::NONE)
                }
                _ => self.vreg(value),
            },
        }
    }

    fn home_of_floating(&self, value: Value) -> Home {
        match self.op(value) {
            Op::SlotAddress(slot) => Home::Displaced(I::FRAME_POINTER, self.slot_offsets[slot]),
            Op::Pinned(reg) if reg == I::FRAME_POINTER => Home::Displaced(reg, 0),
            Op::Displaced(reg, offset) => Home::Displaced(reg, offset),
            _ => Home::Constant(value),
        }
    }

    fn create_vreg(&mut self, value: Value) -> VReg {
        let ty = self.type_of(value);
        let class = match ty {
            Type::I32 if !self.is_zero_extended(value) => Class::Int64,
            Type::I64 if self.fits_in_lower_half(value) => Class::Int32,
            _ => Class::of(ty),
        };
        let block = self.function.block_of(value);
        let vreg = match self.op(value) {
            Op::Extract(tuple, position) => VReg(self.tuple_vregs(tuple).0 + position),
            Op::Param(_) => match self.boundary_of(value) {
                Some(Boundary::Frame(offset)) => {
                    self.add_vreg(class, Home::Incoming(offset), block)
                }
                _ => self.add_vreg(class, Home::Spill, block),
            },
            op if op.is_floating() => self.add_floating(value, class, self.home_of_floating(value)),
            _ => self.add_vreg(class, Home::Spill, block),
        };
        self.tables.vregs[value] = vreg;
        vreg
    }

    fn add_floating(&mut self, value: Value, class: Class, home: Home) -> VReg {
        self.tables.floating.push(value);
        let region = self.region.expand();
        let header = region.map_or(Block::NONE, |region| self.cfg.loops()[region].header);
        self.add_vreg(class, home, header)
    }

    /// The first of those for the elements, which are consecutive.
    fn tuple_vregs(&mut self, tuple: Value) -> VReg {
        if let Some(first) = self.tables.vregs[tuple].expand() {
            return first;
        }
        let first = VReg::from_index(self.code.vregs.len());
        let (block, is_extended) = (self.function.block_of(tuple), self.is_zero_extended(tuple));
        let mut position = 0;
        while let Some(ty) = self.function.tuple_element_type(tuple, position) {
            self.add_vreg(
                if ty == Type::I32 && !is_extended {
                    Class::Int64
                } else {
                    Class::of(ty)
                },
                Home::Spill,
                block,
            );
            position += 1;
        }
        self.tables.vregs[tuple] = first;
        first
    }

    fn result_vreg(&mut self, value: Value, position: usize) -> VReg {
        if self.type_of(value) == Type::Tuple {
            VReg(self.tuple_vregs(value).0 + position as u32)
        } else {
            self.tables.vregs[value]
                .expand()
                .unwrap_or_else(|| self.create_vreg(value))
        }
    }

    /// Returns whether this is the last use.
    #[inline]
    fn note_use(&mut self, vreg: VReg, role: Role, is_warm: bool) -> bool {
        let point = self.reversed_point(role);
        let data = &mut self.code.vregs[vreg];
        let is_last = data.end == NEVER;
        data.end = data.end.min(point);
        let (bank, is_floating) = (data.class.bank() as usize, data.is_floating());
        let is_foreign = data.block != self.block || is_floating;
        if is_foreign {
            self.note_foreign_use(vreg, if is_warm { point } else { NEVER });
        }
        if is_last && (!is_foreign || self.ends_at_last_use(vreg)) {
            self.live[bank] += 1;
            self.most_live[bank] = self.most_live[bank].max(self.live[bank]);
        }
        is_last
    }

    fn note_foreign_use(&mut self, vreg: VReg, warm_point: Point) {
        let data = &mut self.code.vregs[vreg];
        match self.code.foreign_uses.get_mut(data.foreign_use as usize) {
            Some(known) if known.block == self.block => {
                if warm_point != NEVER {
                    known.first_warm = warm_point;
                }
            }
            _ if data.block.is_none() => {}
            _ => {
                if data.global == LOCAL {
                    data.global = 0;
                    self.code.globals.push((vreg, self.block));
                }
                data.foreign_use = self.code.foreign_uses.len() as u32;
                self.code.foreign_uses.push(ForeignUse {
                    block: self.block,
                    vreg,
                    first_warm: warm_point,
                });
            }
        }
    }

    #[inline]
    fn note_def(&mut self, vreg: VReg, point: Point) {
        let data = &mut self.code.vregs[vreg];
        data.start = point;
        self.live[data.class.bank() as usize] -= i32::from(data.end != NEVER);
    }

    // Operands. Results come first.

    #[inline]
    fn push_def(&mut self, operand: Operand) {
        self.note_def(operand.vreg, self.reversed_point(operand.role));
        self.code.operands.push(operand);
    }

    #[inline]
    fn push_use(&mut self, vreg: VReg, role: Role, place: Place) {
        let is_last = self.note_use(vreg, role, place != Place::ColdAnywhere);
        if is_last && let Some(&result) = self.code.operands.get(self.first_operand) {
            let position = self.code.operands.len() - self.first_operand;
            let is_tied = result.role == Role::Def && result.place == Place::Register;
            if is_tied && result.ties().next() == Some(position) && self.ends_at_last_use(vreg) {
                self.appoint_heir(vreg, result.vreg, false);
            }
        }
        self.code.operands.push(Operand::new(vreg, role, place));
    }

    fn claim(&mut self, registers: RegisterSet) {
        self.claimed_here |= registers;
        self.is_constrained = true;
    }

    #[inline]
    pub(crate) fn def(&mut self, value: Value) {
        let vreg = self.result_vreg(value, 0);
        self.push_def(Operand::new(vreg, Role::Def, Place::Register));
    }

    /// The code is shorter if the result is in the register of the operand at one of the positions.
    #[inline]
    pub(crate) fn def_tied(&mut self, value: Value, first: u8, second: Option<u8>) {
        let vreg = self.result_vreg(value, 0);
        self.push_def(Operand::tied(vreg, first, second));
    }

    pub(crate) fn def_early(&mut self, value: Value, position: usize) {
        let vreg = self.result_vreg(value, position);
        self.push_def(Operand::new(vreg, Role::EarlyDef, Place::Register));
    }

    pub(crate) fn def_element(&mut self, tuple: Value, position: usize) {
        let vreg = self.result_vreg(tuple, position);
        self.push_def(Operand::new(vreg, Role::Def, Place::Register));
    }

    pub(crate) fn def_fixed(&mut self, value: Value, position: usize, reg: impl Into<Reg>) {
        let (vreg, reg) = (self.result_vreg(value, position), reg.into());
        self.claim(RegisterSet::EMPTY.with(reg));
        self.push_def(Operand::fixed(vreg, Role::Def, reg));
    }

    pub(crate) fn def_fixed_early(&mut self, value: Value, reg: impl Into<Reg>) {
        let (vreg, reg) = (self.result_vreg(value, 0), reg.into());
        self.claim(RegisterSet::EMPTY.with(reg));
        self.push_def(Operand::fixed(vreg, Role::EarlyDef, reg));
    }

    /// A result that is of no use.
    pub(crate) fn overwrite(&mut self, reg: Gpr) {
        let vreg = self.new_vreg(Class::Int64);
        self.claim(RegisterSet::EMPTY.with(reg.into()));
        self.push_def(Operand::fixed(vreg, Role::Def, reg.into()));
    }

    pub(crate) fn temp(&mut self, bank: Bank) {
        let most_live = &mut self.most_live[bank as usize];
        *most_live = (*most_live).max(self.live[bank as usize] + 1);
        self.code.operands.push(Operand::temp(bank));
    }

    pub(crate) fn temp_fixed(&mut self, reg: impl Into<Reg>) {
        let reg = reg.into();
        self.claim(RegisterSet::EMPTY.with(reg));
        self.code
            .operands
            .push(Operand::fixed(VReg::NONE, Role::Temp, reg));
    }

    /// The zero register and the like have an index that no allocatable register has.
    pub(crate) fn given(&mut self, reg: u8) {
        self.code.operands.push(Operand::given(reg));
    }

    #[inline]
    pub(crate) fn use_value(&mut self, value: Value, role: Role, place: Place) {
        let is_copied = matches!(place, Place::Anywhere | Place::ColdAnywhere);
        self.use_or_copy(value, role, place, is_copied);
    }

    fn use_to_store(&mut self, value: Value) {
        let place = if self.type_of(value).is_int() {
            I::place_to_store_from(self.constant_bits(self.representative(value)))
        } else {
            Place::Anywhere
        };
        self.use_or_copy(value, Role::Use, place, true);
    }

    #[inline]
    fn use_or_copy(&mut self, value: Value, role: Role, place: Place, is_copied: bool) {
        let value = self.representative(value);
        match self.op(value) {
            Op::Pinned(reg) => return self.given(reg.number()),
            Op::Const64(bits)
                if let Some((reg, _)) = self.function.pinned_near(bits.get(), 0..=0) =>
            {
                return self.given(reg.number());
            }
            _ => {}
        }
        let vreg = if is_copied {
            self.vreg_to_copy(value)
        } else {
            let known = self.tables.vregs[value].expand();
            known.unwrap_or_else(|| self.create_vreg(value))
        };
        self.push_use(vreg, role, place);
    }

    #[inline]
    pub(crate) fn use_register(&mut self, value: Value) {
        self.use_value(value, Role::Use, Place::Register);
    }

    #[inline]
    pub(crate) fn use_late(&mut self, value: Value) {
        self.use_value(value, Role::LateUse, Place::Register);
    }

    pub(crate) fn use_fixed(&mut self, value: Value, role: Role, reg: impl Into<Reg>) {
        let vreg = self.vreg_to_copy(value);
        self.push_fixed_use(vreg, role, reg.into());
    }

    fn push_fixed_use(&mut self, vreg: VReg, role: Role, reg: Reg) {
        self.claim(RegisterSet::EMPTY.with(reg));
        let is_last = self.note_use(vreg, role, true);
        let lasts = role == Role::LateUse && !(is_last && self.ends_at_last_use(vreg));
        if (is_last || lasts) && (!self.is_cold || self.code.vregs[vreg].block == self.block) {
            let number = reg.index() as u8;
            self.code.vregs[vreg].wish = if !self.runs_as_often_as_definition(vreg) {
                Wish::Weak(number)
            } else if lasts {
                Wish::Lasting(number)
            } else {
                Wish::Firm(number)
            };
        }
        self.code.operands.push(Operand::fixed(vreg, role, reg));
    }

    /// For an instruction that exits to the state of `value`. Follows the operands.
    pub(crate) fn exit_of(&mut self, value: Value, recoverable: Option<Value>) {
        let recoverable = recoverable.map_or(VReg::NONE, |operand| self.vreg(operand));
        self.add_site(value, recoverable, [RegisterSet::EMPTY; 3]);
    }

    fn add_site(
        &mut self,
        value: Value,
        recoverable: VReg,
        [early, late, upper_halves]: [RegisterSet; 3],
    ) {
        let state = self.function.state_of(value);
        let state_vregs = if state.is_none() {
            Span::default()
        } else {
            self.use_state(state, recoverable)
        };
        let is_wanted =
            !recoverable.is_none() && self.code.vreg_lists[state_vregs].contains(&recoverable);
        let recoverable = if is_wanted { recoverable } else { VReg::NONE };
        if !(early | late | upper_halves).is_empty() {
            self.claim(early | late);
            for bank in [Bank::Gpr, Bank::Fpr] {
                if (self.allocatable - early - late).in_bank(bank).is_empty() {
                    self.barrier[bank as usize] = Some(self.instructions.len() as u32);
                    self.lost_here |= self.allocatable.in_bank(bank);
                }
            }
        }
        self.site = self.code.sites.push(SiteData {
            value,
            is_exit: !matches!(self.function.op(value), Op::Patchpoint(_)),
            state,
            state_vregs,
            recoverable,
            clobbers_early: early,
            clobbers_late: late,
            clobbers_upper_halves: upper_halves,
            state_assigned: Span::default(),
            live_registers: RegisterSet::EMPTY,
            live_vectors: RegisterSet::EMPTY,
        });
    }

    fn use_state(&mut self, state: State, recoverable: VReg) -> Span<VReg> {
        let (mut vregs, noted_in) = self.tables.states[state];
        if noted_in == self.block {
            return vregs;
        }
        let count = self.function.state(state).len();
        if noted_in.is_none() {
            vregs = self
                .code
                .vreg_lists
                .add(core::iter::repeat_n(VReg::NONE, count));
            for position in 0..count {
                self.code.vreg_lists[vregs][position] =
                    self.vreg(self.function.state(state)[position]);
            }
        }
        for position in 0..count {
            let vreg = self.code.vreg_lists[vregs][position];
            if !self.code.vregs[vreg].is_floating() {
                self.note_use(
                    vreg,
                    if vreg == recoverable {
                        Role::Use
                    } else {
                        Role::LateUse
                    },
                    false,
                );
            }
        }
        self.tables.states[state] = (vregs, self.block);
        vregs
    }

    /// Ends the instruction whose operands have been given. The next one precedes it.
    #[inline]
    pub(crate) fn finish(&mut self, instruction: I) {
        let end = self.code.operands.len();
        let (mut result_count, mut has_late_uses, mut writes_early) = (0, false, false);
        for operand in &self.code.operands[self.first_operand..] {
            result_count += u8::from(!operand.is_use());
            has_late_uses |= operand.role == Role::LateUse;
            writes_early |= matches!(operand.role, Role::EarlyDef | Role::Temp);
        }
        debug_assert!(
            self.code.operands[self.first_operand..].is_sorted_by_key(|operand| operand.is_use())
        );
        let is_constrained = core::mem::take(&mut self.is_constrained);
        if is_constrained {
            self.claimed |=
                core::mem::take(&mut self.claimed_here) - core::mem::take(&mut self.lost_here);
        }
        self.code.heads.push(Head {
            first_operand: self.first_operand as u32,
            operand_count: (end - self.first_operand) as u16,
            is_constrained,
            result_count,
            is_plain: !is_constrained && !has_late_uses && !writes_early,
            has_late_uses,
            site: core::mem::replace(&mut self.site, Site::NONE),
            origin: self.origin,
        });
        self.instructions.push(instruction);
        self.first_operand = end;
    }

    /// `value = source`, for an operation that turns out to do nothing.
    pub(crate) fn copy(&mut self, value: Value, source: Value) {
        let vreg = self.result_vreg(value, 0);
        self.copy_vreg(vreg, source);
    }

    /// `value` is the low half of `source`.
    pub(crate) fn zero_extend(&mut self, value: Value, source: Value) {
        self.def(value);
        self.use_value(source, Role::Use, Place::Anywhere);
        self.finish(I::ZERO_EXTEND);
    }

    /// The last operand is an I32 in a register whose upper half is clear.
    pub(crate) fn finish_with_extended_use(&mut self, value: Value, instruction: I) {
        if self.is_zero_extended(value) {
            self.use_register(value);
            return self.finish(instruction);
        }
        let copy = self.new_vreg(Class::Int32);
        self.push_use(copy, Role::Use, Place::Register);
        self.finish(instruction);
        self.copy_vreg(copy, value);
    }

    /// A value that the next instruction, which has been lowered already, reads from `copy`.
    fn copy_vreg(&mut self, copy: VReg, source: Value) {
        let is_narrow = match self.type_of(source) {
            Type::I32 => self.is_zero_extended(source),
            _ => self.fits_in_lower_half(source),
        };
        let narrows = self.code.vregs[copy].class == Class::Int32 && !is_narrow;
        self.push_def(if narrows {
            Operand::new(copy, Role::Def, Place::Register)
        } else {
            Operand::tied(copy, 1, None)
        });
        self.use_value(source, Role::Use, Place::Anywhere);
        self.finish(if narrows { I::ZERO_EXTEND } else { I::COPY });
    }

    fn lower_return(&mut self, value: Value) {
        let count = self.function.results().len();
        let overwrites_params = self
            .function
            .results()
            .iter()
            .any(|result| matches!(result, Boundary::Frame(_)));
        self.tables.scratch.clear();
        for position in 0..count {
            let result = self.function.operands(value)[position];
            let vreg = self.vreg(result);
            let data = &self.code.vregs[vreg];
            let needs_extension = self.type_of(result) == Type::I32 && data.class == Class::Int64;
            let needs_copy =
                needs_extension || overwrites_params && matches!(data.home, Home::Incoming(_));
            let class = Class::of(self.type_of(result));
            let used = if needs_copy {
                self.new_vreg(class)
            } else {
                vreg
            };
            self.tables.scratch.push(used);
            if let Boundary::Register(reg) = self.function.results()[position] {
                self.push_fixed_use(used, Role::Use, reg);
            }
        }
        self.finish(I::RETURN);
        for position in 0..count {
            if let Boundary::Frame(offset) = self.function.results()[position] {
                self.push_use(self.tables.scratch[position], Role::Use, Place::Anywhere);
                self.finish(I::store_result(
                    offset,
                    self.type_of(self.function.operands(value)[position]),
                ));
            }
        }
        for position in 0..count {
            let (used, result) = (
                self.tables.scratch[position],
                self.function.operands(value)[position],
            );
            if used != self.vreg(result) {
                self.copy_vreg(used, result);
            }
        }
    }

    fn lower_patchpoint(&mut self, value: Value, patchpoint: Patchpoint) {
        let data = *self.function.patchpoint(patchpoint);
        let result_count = self.function.outputs(patchpoint).len();
        for position in (0..result_count).rev() {
            if let (ty, Output::Outgoing(offset)) = self.function.outputs(patchpoint)[position] {
                self.code.outgoing_bytes = self
                    .code
                    .outgoing_bytes
                    .max(offset as u32 + ty.bytes().max(8));
                let vreg = self.result_vreg(value, position);
                if self.code.vregs[vreg].end != NEVER {
                    self.push_def(Operand::new(vreg, Role::Def, Place::Register));
                    self.finish(I::load_outgoing(offset, ty));
                }
            }
        }

        for position in 0..result_count {
            match self.function.outputs(patchpoint)[position].1 {
                Output::Register => self.def_element(value, position),
                Output::EarlyRegister => self.def_early(value, position),
                Output::Fixed(reg) => self.def_fixed(value, position, reg),
                Output::Outgoing(_) => {}
            }
        }
        (0..data.scratch_gprs).for_each(|_| self.temp(Bank::Gpr));
        (0..data.scratch_fprs).for_each(|_| self.temp(Bank::Fpr));
        self.add_site(
            value,
            VReg::NONE,
            [
                data.clobbers_early,
                data.clobbers_late,
                data.clobbers_upper_halves,
            ],
        );
        self.tables.scratch.clear();
        let operand_count = self.function.inputs(patchpoint).len();
        let extends = !data.flags.contains(PatchpointFlags::UNEXTENDED_OPERANDS);
        for position in 0..operand_count {
            let (operand, input) = (
                self.function.operands(value)[position],
                self.function.inputs(patchpoint)[position],
            );
            let is_in_register = !matches!(
                input,
                Input::Anywhere | Input::ColdAnywhere | Input::LateAnywhere | Input::Outgoing(_)
            );
            let needs_extension = extends
                && is_in_register
                && self.type_of(operand) == Type::I32
                && !self.is_zero_extended(operand);
            let copy = if input == Input::ConsumedRegister || needs_extension {
                self.new_vreg(Class::of(self.type_of(operand)))
            } else {
                VReg::NONE
            };
            self.tables.scratch.push(copy);
            let (role, place) = match input {
                Input::Anywhere if position == 0 && data.action == Action::CallIndirect => {
                    (Role::Use, Place::RegisterOrMemory)
                }
                Input::Anywhere => (Role::Use, Place::Anywhere),
                Input::ColdAnywhere => (Role::Use, Place::ColdAnywhere),
                Input::LateAnywhere => (Role::LateUse, Place::Anywhere),
                Input::Register => (Role::Use, Place::Register),
                Input::LateRegister | Input::ConsumedRegister => (Role::LateUse, Place::Register),
                Input::Fixed(reg) | Input::LateFixed(reg) => {
                    let role = if input == Input::Fixed(reg) {
                        Role::Use
                    } else {
                        Role::LateUse
                    };
                    if copy.is_none() {
                        self.use_fixed(operand, role, reg);
                    } else {
                        self.push_fixed_use(copy, role, reg);
                    }
                    continue;
                }
                Input::Outgoing(_) => continue,
            };
            if copy.is_none() {
                self.use_value(operand, role, place);
            } else {
                self.note_use(copy, role, true);
                self.code.operands.push(Operand::new(copy, role, place));
            }
        }
        self.finish(I::PATCHPOINT);

        for position in (0..operand_count).rev() {
            let (operand, copy) = (
                self.function.operands(value)[position],
                self.tables.scratch[position],
            );
            if let Input::Outgoing(offset) = self.function.inputs(patchpoint)[position] {
                let ty = self.type_of(operand);
                self.code.outgoing_bytes = self
                    .code
                    .outgoing_bytes
                    .max(offset as u32 + ty.bytes().max(8));
                self.use_to_store(operand);
                self.finish(I::store_outgoing(offset, ty));
            } else if !copy.is_none() {
                self.copy_vreg(copy, operand);
            }
        }
    }
}
