//! Checks, patchpoints and calls.

use bun_engine_asm::{Bank, Cond, Reg, RegisterSet, Sign};
use bun_engine_codegen::ir::{
    Action, Binary, Checked, EffectFlags, Effects, Exit, Heap, Input, NodeKind, Op, Output,
    PatchpointData, PatchpointFlags, State, Successor, Token, Type, Unary, Value,
};

use super::{Class, Generator, KnownState};
use crate::support::nodes::{behaviour_of, kind_named};
use crate::support::vocabulary::{
    Behaviour, SIGNATURE_COUNT, SIGNATURES_FOR_HANDLERS, bank_of, result_types, signature, token,
};

pub(super) type Site = (Value, Behaviour);

/// Hands out registers, so that the constraints of a patchpoint can be met.
struct Witness {
    free: Vec<Reg>,
    /// Hold operands that are not late.
    read_early: Vec<Reg>,
    outgoing_end: u32,
}

impl Witness {
    fn take(&mut self, bank: Bank) -> Option<Reg> {
        let index = self.free.iter().position(|reg| reg.bank() == bank)?;
        Some(self.free.swap_remove(index))
    }

    fn take_outgoing(&mut self, ty: Type) -> i32 {
        let size = ty.bytes().max(8);
        self.outgoing_end = self.outgoing_end.next_multiple_of(size) + size;
        (self.outgoing_end - size) as i32
    }
}

impl Generator<'_> {
    fn token(&mut self, behaviour: Behaviour) -> Token {
        self.next_token += 1;
        token(self.next_token, behaviour)
    }

    fn operand(&mut self) -> Value {
        if self.random.one_in(8)
            && let Some((found, class)) = self.find(|known| matches!(known, Class::Pointer(_)))
            && self.can_be_shown(class)
        {
            return found;
        }
        let ty = self.data_type();
        self.data(ty)
    }

    fn state(&mut self, wants_determined_bits: bool, extra: &[Value]) -> State {
        if extra.is_empty() && self.random.percent(40) {
            let suits = |known: &&KnownState| known.has_determined_bits || !wants_determined_bits;
            let skipped = self.random.below(2);
            if let Some(known) = self.scope.states.iter().rev().filter(suits).nth(skipped) {
                return known.state;
            }
        }
        if extra.is_empty() && self.random.one_in(10) {
            return State::NONE;
        }
        let mut values = extra.to_vec();
        if !self.random.one_in(5) {
            values.push(self.get_sum());
        }
        for _ in 0..self.random.pick(&[0, 1, 2, 4, 8]) {
            let value = if wants_determined_bits || self.random.flip() {
                self.operand()
            } else {
                let ty = self.data_type();
                self.loose(ty).0
            };
            values.push(value);
        }
        self.random.shuffle(&mut values);
        let state = self.function.add_state(&values);
        self.scope.states.push(KnownState {
            state,
            has_determined_bits: wants_determined_bits,
        });
        state
    }

    fn exit(&mut self, extra: &[Value]) -> Exit {
        Exit {
            token: self.token(Behaviour::empty()),
            state: self.state(false, extra),
        }
    }

    pub(super) fn check(&mut self, condition: Value) {
        let exit = self.exit(&[]);
        if self.shape.folds {
            self.builder().check(condition, exit);
        } else {
            self.emit(Op::Check(condition, exit), Type::Void);
        }
    }

    /// With just these values in the state.
    pub(super) fn check_keeping(&mut self, condition: Value, values: &[Value]) {
        let state = self.function.add_state(values);
        self.check_with(condition, state);
    }

    pub(super) fn check_with(&mut self, condition: Value, state: State) {
        let token = self.token(Behaviour::empty());
        self.builder().check(condition, Exit { token, state });
    }

    pub(super) fn checked_with(&mut self, op: Checked, a: Value, b: Value, state: State) -> Value {
        let token = self.token(Behaviour::empty());
        self.builder().checked(op, a, b, Exit { token, state })
    }

    pub(super) fn checked(&mut self, op: Checked, a: Value, b: Value) -> Value {
        let extra: &[Value] = match self.random.below(4) {
            0 => &[],
            1 => &[a],
            2 => &[b],
            _ => &[a, b],
        };
        let exit = self.exit(extra);
        if self.shape.folds {
            self.builder().checked(op, a, b, exit)
        } else {
            self.emit(Op::Checked(op, [a, b], exit), self.type_of(a))
        }
    }

    /// A condition, and what is known of a value where it holds.
    pub(super) fn guard(&mut self) -> (Value, Value, Class) {
        let ty = self.int_type();
        let any = self.known_int(ty);
        if self.random.one_in(3) {
            let value = if self.random.flip() {
                any
            } else {
                self.binary_constant(Binary::And, any, 15)
            };
            let holds = if self.random.flip() {
                self.compare_constant(Cond::Gt, value, 0)
            } else {
                let moved = self.binary_constant(Binary::Add, value, 1);
                self.compare_constant(Cond::Above, moved, 1)
            };
            return (holds, value, Class::Divisor(ty));
        }
        let below = self.random.pick(&[3, 4, 7, 8, 14, 16, 30]);
        let mask = i64::from(u32::next_power_of_two(below)) - 1;
        let value = if self.random.one_in(4) {
            any
        } else {
            self.binary_constant(Binary::And, any, mask)
        };
        let holds = match self.random.below(4) {
            0 => {
                let is_positive = self.compare_constant(Cond::Ge, value, 0);
                let is_small = self.compare_constant(Cond::Lt, value, below.into());
                self.commutative(Binary::And, is_positive, is_small)
            }
            1 => self.compare_constant(Cond::BelowEq, value, i64::from(below) - 1),
            2 => {
                let limit = self.value_of(Class::Index {
                    ty,
                    below: below + 1,
                    is_guarded: true,
                });
                let limit =
                    self.binary_constant(Binary::Or, limit, i64::from(below) & -i64::from(below));
                let is_allowed = self.compare_constant(Cond::BelowEq, limit, below.into());
                let most = self.constant(ty, below.into());
                let limit = self.select(is_allowed, limit, most);
                self.compare(Cond::Below, value, limit)
            }
            _ => self.compare_constant(Cond::Below, value, below.into()),
        };
        (
            holds,
            value,
            Class::Index {
                ty,
                below,
                is_guarded: true,
            },
        )
    }

    pub(super) fn check_statement(&mut self) {
        match self.random.below(16) {
            0..4 => {
                let condition = self.unlikely_condition();
                self.check(condition);
                if self.random.one_in(3) {
                    self.body(1);
                    self.check(condition);
                }
            }
            4..7 => {
                let (holds, value, class) = self.guard();
                let fails = self.negate(holds);
                self.check(fails);
                self.learn(value, class);
            }
            7 if self.nesting != 0 => {
                let condition = self.condition();
                self.check(condition);
            }
            8 if self.shape.weights.floats != 0 => {
                let (from, to) = (self.float_type(), self.int_type());
                let float = self.float(from).0;
                let fails = self.does_not_fit_in_i32(float);
                self.check(fails);
                let int = self.unary(Unary::FloatToInt(Sign::Signed), to, float);
                self.keep(int, Class::Data(to));
            }
            _ => {
                let (ty, op) = (
                    self.int_type(),
                    self.random
                        .pick(&[Checked::Add, Checked::Sub, Checked::Mul]),
                );
                let [a, b] = [(); 2].map(|()| match self.random.below(8) {
                    0 => self.int(ty),
                    1 | 2 => {
                        let number = self.random.pick(&[0, 1, -1, 2, 3, 4, 100]);
                        self.constant(ty, number)
                    }
                    _ => {
                        let any = self.known_int(ty);
                        self.narrowed(any)
                    }
                });
                let b = if self.random.one_in(10) { a } else { b };
                let result = self.checked(op, a, b);
                self.keep(result, Class::Data(ty));
                if self.random.one_in(6) {
                    let again = if self.random.flip() {
                        self.checked(op, a, b)
                    } else {
                        let plain = [Binary::Add, Binary::Sub, Binary::Mul][op as usize];
                        self.binary(plain, a, b)
                    };
                    self.keep(again, Class::Data(ty));
                }
            }
        }
    }

    fn input(&mut self, ty: Type, witness: &mut Witness, may_use_stack: bool) -> Input {
        let kind = self.random.below(9);
        let reg = if kind >= 4 {
            witness.take(bank_of(ty))
        } else {
            None
        };
        match (kind, reg) {
            (4, Some(reg)) => {
                witness.read_early.push(reg);
                Input::Fixed(reg)
            }
            (5, Some(reg)) => Input::LateFixed(reg),
            (6, Some(_)) => Input::LateRegister,
            (7, Some(_)) => Input::ConsumedRegister,
            (8, Some(_)) => Input::Register,
            (3, _) if may_use_stack => Input::Outgoing(witness.take_outgoing(ty)),
            _ => self
                .random
                .pick(&[Input::Anywhere, Input::ColdAnywhere, Input::LateAnywhere]),
        }
    }

    fn output(&mut self, ty: Type, witness: &mut Witness, may_use_stack: bool) -> Output {
        let kind = self.random.between(i64::from(!may_use_stack), 7);
        let reusable = witness
            .read_early
            .iter()
            .position(|reg| reg.bank() == bank_of(ty));
        if let (1, Some(index)) = (kind, reusable) {
            return Output::Fixed(witness.read_early.swap_remove(index));
        }
        match (kind, witness.take(bank_of(ty))) {
            (0, _) | (_, None) => Output::Outgoing(witness.take_outgoing(ty)),
            (2, Some(reg)) => Output::Fixed(reg),
            (3 | 4, _) => Output::EarlyRegister,
            _ => Output::Register,
        }
    }

    fn some_of(&mut self, registers: impl IntoIterator<Item = Reg>) -> RegisterSet {
        let percent = self.random.pick(&[0, 0, 0, 20, 60, 100]);
        registers
            .into_iter()
            .filter(|_| self.random.percent(percent))
            .collect()
    }

    fn constrain(
        &mut self,
        data: &mut PatchpointData,
        operands: &[Value],
        results: &[Type],
    ) -> (Vec<(Value, Input)>, Vec<(Type, Output)>) {
        let mut witness = Witness {
            free: self.usable.into_iter().collect(),
            read_early: Vec::new(),
            outgoing_end: 0,
        };
        self.random.shuffle(&mut witness.free);
        let may_use_stack = self.random.flip();
        let inputs: Vec<_> = operands
            .iter()
            .map(|&operand| {
                (
                    operand,
                    self.input(self.type_of(operand), &mut witness, may_use_stack),
                )
            })
            .collect();
        if self.random.flip() {
            witness.outgoing_end = 0;
        }
        let ends_block = data.effects.has(EffectFlags::ENDS_BLOCK);
        let outputs: Vec<_> = results
            .iter()
            .map(|&ty| (ty, self.output(ty, &mut witness, !ends_block)))
            .collect();
        for (count, bank) in [
            (&mut data.scratch_gprs, Bank::Gpr),
            (&mut data.scratch_fprs, Bank::Fpr),
        ] {
            let wanted = self.random.pick(&[0, 0, 0, 1, 2, 3]);
            *count = (0..wanted).map_while(|_| witness.take(bank)).count() as u8;
        }
        let fixed_results = outputs.iter().filter_map(|&(_, output)| match output {
            Output::Fixed(reg) => Some(reg),
            _ => None,
        });
        let scratch = self.registers.scratch - self.function.pinned;
        let unused = || witness.free.iter().copied().chain(scratch);
        let (early, late): (Vec<_>, Vec<_>) = (
            unused().collect(),
            unused()
                .chain(witness.read_early.iter().copied())
                .chain(fixed_results)
                .collect(),
        );
        data.clobbers_early = self.some_of(early.iter().copied());
        data.clobbers_late = self.some_of(late);
        data.clobbers_upper_halves = self.some_of(early).in_bank(Bank::Fpr) - data.clobbers_late;
        data.flags
            .set(PatchpointFlags::UNIQUE, self.random.one_in(4));
        data.flags
            .set(PatchpointFlags::UNEXTENDED_RESULTS, self.random.one_in(4));
        data.flags
            .set(PatchpointFlags::UNEXTENDED_OPERANDS, self.random.one_in(4));
        data.flags
            .set(PatchpointFlags::MOVES_STACK_POINTER, self.random.one_in(10));
        (inputs, outputs)
    }

    /// Below the site.
    pub(super) fn keep_results(&mut self, (site, behaviour): Site) {
        let results: Vec<Type> = result_types(&self.function, site).collect();
        let class_of = |ty: Type| match ty {
            Type::I32 | Type::I64 if behaviour.contains(Behaviour::SMALL_RESULTS) => Class::Index {
                ty,
                below: 16,
                is_guarded: false,
            },
            _ => Class::Data(ty),
        };
        if let [ty] = *results {
            self.keep(site, class_of(ty));
            return;
        }
        for (position, &ty) in results.iter().enumerate() {
            for _ in 0..self.random.pick(&[0, 1, 1, 1, 1, 2]) {
                let element = self.builder().extract(site, position as u32);
                self.keep(element, class_of(ty));
            }
        }
    }

    fn some_heap(&mut self) -> Heap {
        self.random.pick(&self.heaps).1
    }

    /// Chooses what it does, and adds the first operand if that has a role.
    fn character(&mut self, operands: &mut Vec<Value>) -> (Effects, Behaviour) {
        let mut effects = Effects::NONE;
        let mut behaviour = Behaviour::empty();
        behaviour.set(Behaviour::SMALL_RESULTS, self.random.flip());
        match self.random.below(12) {
            0 | 1 => {}
            2 => {
                let ty = self.int_type();
                operands.push(self.value_of(Class::Divisor(ty)));
                effects.flags |= EffectFlags::CONTROL_DEPENDENT;
                behaviour |= Behaviour::NEEDS_NONZERO;
            }
            3 | 4 => {
                let (reads, writes) =
                    self.random
                        .pick(&[(true, false), (false, true), (true, true)]);
                let (address, heap) = self.word_address(writes);
                operands.push(address);
                effects.reads = if reads { heap } else { Heap::NOTHING };
                effects.writes = if writes { heap } else { Heap::NOTHING };
                effects.flags |= EffectFlags::CONTROL_DEPENDENT;
                behaviour |= Behaviour::THROUGH_POINTER;
            }
            5 => effects.reads = self.some_heap(),
            6 => effects.writes = self.some_heap(),
            7 => (effects.reads, effects.writes) = (self.some_heap(), self.some_heap()),
            8 => effects.flags |= self.random.pick(&[EffectFlags::KEPT, EffectFlags::FENCE]),
            9 => {
                let ty = self.int_type();
                operands.push(self.known_int(ty));
                effects.flags |= EffectFlags::EXITS;
                behaviour |= Behaviour::EXITS_BY_OPERAND;
            }
            10 => {
                effects.flags |= EffectFlags::EXITS;
                behaviour.set(Behaviour::EXITS_BY_CHANCE, self.random.flip());
            }
            _ => {
                effects = Effects::CALL;
                behaviour.set(Behaviour::EXITS_BY_CHANCE, self.random.flip());
            }
        }
        (effects, behaviour)
    }

    pub(super) fn patchpoint_statement(&mut self) {
        let mut operands = Vec::new();
        let (effects, behaviour) = self.character(&mut operands);
        for _ in 0..self.random.pick(&[0, 1, 2, 3, 5, 9]) {
            let operand = match operands.last() {
                Some(&last) if self.random.one_in(8) => last,
                _ => self.operand(),
            };
            operands.push(operand);
        }
        let results: Vec<Type> = (0..self.random.pick(&[0, 1, 1, 1, 2, 4]))
            .map(|_| self.data_type())
            .collect();
        let action = if self.random.one_in(6) {
            Action::CustomCall
        } else {
            Action::Custom
        };
        let mut data = PatchpointData::new(action, self.token(behaviour), effects);
        if effects.has(EffectFlags::EXITS) || self.random.one_in(4) {
            data.state = self.state(true, &[]);
        }
        let (inputs, outputs) = self.constrain(&mut data, &operands, &results);
        let site = self.builder().patchpoint(&data, &inputs, &outputs);
        self.keep_results((site, behaviour));
    }

    pub(super) fn object_from_patchpoint(&mut self) -> Value {
        let operands = [self.known_int(Type::I64)];
        let flags = self
            .random
            .pick(&[EffectFlags::empty(), EffectFlags::EXITS]);
        let token = self.token(Behaviour::GIVES_OBJECT);
        let mut data = PatchpointData::new(Action::Custom, token, Effects::with_flags(flags));
        let (inputs, outputs) = self.constrain(&mut data, &operands, &[Type::I64]);
        self.builder().patchpoint(&data, &inputs, &outputs)
    }

    /// The trace tells exactly which bits are wrong.
    pub(super) fn observe(&mut self, values: &[Value]) {
        let flags = self.random.pick(&[EffectFlags::FENCE, EffectFlags::EXITS]);
        let token = self.token(Behaviour::empty());
        let mut data = PatchpointData::new(Action::Custom, token, Effects::with_flags(flags));
        let (operands, rest) = values.split_at(self.random.below(values.len().min(6) + 1));
        data.state = self.function.add_state(rest);
        let (inputs, _) = self.constrain(&mut data, operands, &[]);
        self.builder().patchpoint(&data, &inputs, &[]);
    }

    pub(super) fn terminal_patchpoint(
        &mut self,
        successors: &[Successor<'_>],
        chooser: Value,
    ) -> Site {
        let mut behaviour = Behaviour::empty();
        behaviour.set(Behaviour::SMALL_RESULTS, self.random.flip());
        behaviour.set(Behaviour::GOES_BY_OPERAND, self.random.flip());
        let mut effects = self
            .random
            .pick(&[Effects::NONE, Effects::NONE, Effects::CALL]);
        effects.flags |= EffectFlags::ENDS_BLOCK;
        let mut results = Vec::new();
        if successors.is_empty() {
            effects.flags |= EffectFlags::EXITS;
        } else {
            for _ in 0..self.random.pick(&[0, 1, 1, 1, 2, 3]) {
                results.push(self.data_type());
            }
        }
        let mut operands = vec![chooser];
        for _ in 0..self.random.below(3) {
            operands.push(self.operand());
        }
        let mut data = PatchpointData::new(Action::Custom, self.token(behaviour), effects);
        if effects.has(EffectFlags::EXITS) {
            data.state = self.state(true, &[]);
        }
        let (inputs, outputs) = self.constrain(&mut data, &operands, &results);
        data.flags -= PatchpointFlags::UNEXTENDED_RESULTS | PatchpointFlags::MOVES_STACK_POINTER;
        let mut builder = self.builder();
        let site = builder.terminal_patchpoint(&data, &inputs, &outputs, successors);
        (site, behaviour)
    }

    fn node(&mut self, kind: NodeKind, ty: Type, operands: &[Value], data: u32) -> Value {
        let effects = self.function.node_info(kind).effects;
        let state = if effects.has(EffectFlags::EXITS) || self.random.one_in(6) {
            self.state(false, &[])
        } else {
            State::NONE
        };
        self.builder().node(kind, ty, operands, data, state)
    }

    pub(super) fn node_statement(&mut self) {
        if !self.scope.nodes.is_empty() && self.random.percent(40) {
            let recent = self.random.pick(&[1, 3, 100]);
            let recent = self.scope.nodes.len().saturating_sub(recent);
            let model = self.random.pick(&self.scope.nodes[recent..]);
            let (kind, data) = self.function.op(model).node().unwrap();
            let data = data ^ u32::from(self.random.one_in(8));
            let operands = self.function.operands(model).to_vec();
            let again = self.node(kind, self.type_of(model), &operands, data);
            return self.keep_results((again, behaviour_of(kind)));
        }
        if self.random.one_in(8) {
            let (a, b) = (
                self.value_of(Class::Identity),
                self.value_of(Class::Identity),
            );
            let cond = self.random.pick(&[Cond::Eq, Cond::Ne]);
            let result = self.compare(cond, a, b);
            self.keep(result, Class::BOOLEAN);
            return;
        }
        let kind = NodeKind(self.random.below(kind_named("New").0.into()) as u16);
        let (info, behaviour) = (self.function.node_info(kind), behaviour_of(kind));
        let int = self.int_type();
        let mut operands = Vec::new();
        if behaviour.contains(Behaviour::NEEDS_NONZERO) {
            operands.push(self.value_of(Class::Divisor(int)));
        } else if behaviour.contains(Behaviour::THROUGH_POINTER) {
            operands.push(self.word_address(info.effects.writes_memory()).0);
        } else if behaviour.intersects(Behaviour::GIVES_OPERAND | Behaviour::EXITS_BY_OPERAND) {
            operands.push(self.known_int(int));
        }
        for _ in 0..self.random.pick(&[0, 0, 1, 1, 2, 4]) {
            operands.push(self.operand());
        }
        let ty = match self.data_type() {
            _ if !info.elements.is_empty() => Type::Tuple,
            _ if behaviour.contains(Behaviour::GIVES_OPERAND) => int,
            _ if info.effects.must_execute() && self.random.flip() => Type::Void,
            ty => ty,
        };
        let data = self.random.below(2) as u32;
        let node = self.node(kind, ty, &operands, data);
        self.scope.nodes.push(node);
        self.keep_results((node, behaviour));
    }

    pub(super) fn fresh_identity(&mut self) -> Value {
        let node = self.node(kind_named("New"), Type::I64, &[], 0);
        self.learn(node, Class::Identity);
        node
    }

    pub(super) fn terminal_node(&mut self, successors: &[Successor<'_>], chooser: Value) -> Site {
        let (kind, ty) = (kind_named("Choose"), self.data_type());
        let ty = if self.random.flip() { ty } else { Type::Void };
        let node = self.node(kind, ty, &[chooser], 0);
        self.function.set_successors(self.block, successors);
        (node, behaviour_of(kind))
    }

    /// At most `index`, and computed by an instruction that cannot move above the branches and checks before it.
    pub(super) fn pinned(&mut self, index: Value, how: usize, divisor: Value) -> Value {
        let ty = self.type_of(index);
        match how {
            0 if self.shape.weights.nodes != 0 => self.node(kind_named("Pin"), ty, &[index], 0),
            1 if self.shape.weights.nodes != 0 => self.node(kind_named("Cast"), ty, &[index], 0),
            2 => {
                let (zero, exit) = (self.constant(ty, 0), self.exit(&[]));
                self.emit(Op::Checked(Checked::Add, [index, zero], exit), ty)
            }
            _ => self.emit(Op::Binary(Binary::UnsignedDiv, [index, divisor]), ty),
        }
    }

    pub(super) fn signature_index(&mut self) -> usize {
        let has_vectors = self.shape.weights.vectors != 0;
        self.random
            .below(SIGNATURE_COUNT - usize::from(!has_vectors))
    }

    pub(super) fn call_statement(&mut self) {
        let index = self.signature_index();
        let site = self.call(index, None);
        self.keep_results(site);
    }

    pub(super) fn terminal_call(&mut self, successors: &[Successor<'_>]) -> Site {
        let index = self.random.pick(&SIGNATURES_FOR_HANDLERS);
        self.call(index, Some(successors))
    }

    fn call(&mut self, index: usize, successors: Option<&[Successor<'_>]>) -> Site {
        let signature = signature(self.target, index);
        let callee = 2 * index + self.random.below(2);
        let mut operands = Vec::new();
        let action = match self.random.below(5) {
            4 => Action::CustomCall,
            0 => Action::Call(bun_engine_asm::Target::Symbol(callee as u32)),
            1 => Action::Call(bun_engine_asm::Target::Address(
                self.layout.callees[callee] as usize,
            )),
            _ => {
                let is_free = |&reg: &Reg| {
                    signature
                        .params
                        .iter()
                        .all(|&(_, input)| input != Input::Fixed(reg))
                };
                let free: Vec<Reg> = self
                    .usable
                    .in_bank(Bank::Gpr)
                    .into_iter()
                    .filter(is_free)
                    .collect();
                let fixed = Input::Fixed(self.random.pick(&free));
                let input = self.random.pick(&[Input::Anywhere, Input::Register, fixed]);
                operands.push((self.value_of(Class::Callee(index)), input));
                Action::CallIndirect
            }
        };
        for &(ty, input) in &signature.params {
            let operand = match ty {
                Type::I64 if self.random.one_in(4) => {
                    Some(self.operand()).filter(|&any| self.type_of(any) == ty)
                }
                _ => None,
            };
            operands.push((operand.unwrap_or_else(|| self.data(ty)), input));
        }
        let mut behaviour = Behaviour::empty();
        behaviour.set(Behaviour::SMALL_RESULTS, self.random.flip());
        let effects = match self.random.below(6) {
            0 if successors.is_none() => Effects::NONE,
            1 if successors.is_none() => Effects {
                reads: self.some_heap(),
                writes: self.some_heap(),
                flags: EffectFlags::empty(),
            },
            _ => {
                behaviour.set(Behaviour::EXITS_BY_CHANCE, self.random.one_in(3));
                Effects::CALL
            }
        };
        let mut data = PatchpointData::new(action, self.token(behaviour), effects);
        data.clobbers_late = signature.clobbers - self.function.pinned;
        data.clobbers_upper_halves = signature.clobbers_upper_halves - self.function.pinned;
        data.flags = signature.flags;
        if effects.has(EffectFlags::EXITS) {
            data.state = self.state(true, &[]);
        }
        let (mut builder, results) = (self.builder(), &signature.results);
        let site = match successors {
            Some(successors) => builder.terminal_patchpoint(&data, &operands, results, successors),
            None => builder.patchpoint(&data, &operands, results),
        };
        (site, behaviour)
    }
}
