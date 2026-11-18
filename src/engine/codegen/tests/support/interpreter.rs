//! Runs functions, either to find all that they may do or to do one of those things.

use std::ops::Range;

use bun_engine_asm::{AtomicOp, Relaxed, Sign, Size, lanes};
use bun_engine_codegen::Target;
use bun_engine_codegen::ir::{
    Access, AccessFlags, Binary, Block, EffectFlags, Effects, Entity, Function, Heap, HeapRange,
    Lanes, Load, Op, Origin, Store, Token, Type, Unary, Value,
};

use super::datum::{self, Datum, Kind, Open, Partial};
use super::memory::{
    FRAME_POINTER, Fault, IN_OBJECT, Input, Layout, Memory, Place, Region, Segment, slot_address,
};
use super::promises::{Promise, Step, promises};
use super::random::{Random, mix};
use super::vocabulary::{NOT_CELL_MASK, NUMBER_TAG, registers, result_types};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Mode {
    /// Leaves open what the function does not determine.
    Reference,
    /// Decides what the function does not determine, by this seed.
    Concrete(u64),
}

#[derive(Clone, Copy)]
pub(crate) struct Options {
    pub(crate) mode: Mode,
    pub(crate) relaxed: Relaxed,
    /// Fences and atomic accesses are events, after which memory changes. Not for comparing with machine code.
    pub(crate) other_threads: bool,
    /// The number of instructions that may run.
    pub(crate) fuel: u64,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum Outcome {
    Return(Vec<Datum>),
    Exit(Token, Vec<Datum>),
    Trap(Origin),
    /// The function has broken a promise.
    Undefined(&'static str),
    /// What happens next depends on what is left open.
    Indeterminate,
    OutOfFuel,
}

pub(crate) enum Stop {
    With(Outcome),
    Undefined(&'static str),
}

impl From<Open> for Stop {
    fn from(Open: Open) -> Self {
        Self::With(Outcome::Indeterminate)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Source {
    Site(Token),
    Fence(Origin),
}

/// Hashes are `None` where open bits went into them.
#[derive(Clone, Debug)]
pub(crate) struct Event {
    pub(crate) source: Source,
    /// In `Trace::observed`.
    pub(crate) uses: Range<usize>,
    pub(crate) data: Option<u64>,
    pub(crate) frame: Option<u64>,
    pub(crate) unordered: Option<u64>,
}

#[derive(Clone, Default)]
pub(crate) struct Trace {
    pub(crate) events: Vec<Event>,
    pub(crate) observed: Vec<Datum>,
    /// Of the patchpoints that must run but have no order except relative to exits.
    pub(crate) unordered: Option<u64>,
}

impl Trace {
    pub(crate) fn add_unordered(&mut self, hash: Option<u64>) {
        self.unordered = self
            .unordered
            .zip(hash)
            .map(|(sum, hash)| sum.wrapping_add(hash));
    }
}

/// What patchpoints and calls act on.
pub(crate) struct Machine<'a> {
    pub(crate) layout: &'a Layout,
    pub(crate) target: Target,
    pub(crate) memory: Memory,
    pub(crate) trace: Trace,
    tracks_frame: bool,
    identities: u64,
}

impl<'a> Machine<'a> {
    pub(crate) fn new(layout: &'a Layout, target: Target) -> Self {
        Self {
            layout,
            target,
            memory: Memory::default(),
            trace: Trace::default(),
            tracks_frame: false,
            identities: 0,
        }
    }

    /// Without `garbage` to fill the frame, for a reference run.
    pub(crate) fn reset(
        &mut self,
        function: &Function,
        input: &Input,
        garbage: Option<&mut Random>,
    ) {
        self.tracks_frame = garbage.is_none();
        self.memory.reset(function, input, garbage);
        self.trace.events.clear();
        self.trace.observed.clear();
        self.trace.unordered = Some(0);
    }

    pub(crate) fn new_identity(&mut self) -> Datum {
        self.identities += 1;
        Datum {
            kind: Kind::Identity,
            ..self.identities.into()
        }
    }

    pub(crate) fn locate(
        &self,
        function: &Function,
        instruction: Value,
        address: (Datum, i32),
        size: u32,
        access: Access,
        writes: bool,
    ) -> Result<Place, Stop> {
        let (layout, tracks_frame) = (self.layout, self.tracks_frame);
        self.memory
            .locate(
                layout,
                function,
                address,
                size,
                access,
                writes,
                tracks_frame,
            )
            .map_err(|fault| match fault {
                Fault::Trap => Stop::With(Outcome::Trap(function.origin(instruction))),
                Fault::Undefined(reason) => Stop::Undefined(reason),
                Fault::Open => Open.into(),
            })
    }

    pub(crate) fn record(
        &mut self,
        function: &Function,
        source: Source,
        effects: Effects,
        first_observed: usize,
    ) {
        let exits = effects.has(EffectFlags::EXITS);
        let visible = if exits {
            HeapRange::ALL
        } else {
            function.heap_range(effects.reads)
        };
        self.trace.events.push(Event {
            source,
            uses: first_observed..self.trace.observed.len(),
            data: self.memory.hash_data(visible),
            frame: self.memory.hash_frame(visible),
            unordered: self.trace.unordered.filter(|_| exits),
        });
    }

    pub(crate) fn exit(&self, function: &Function, token: Token, state: &[Datum]) -> Stop {
        let seen = |&value: &Datum| match value.kind {
            Kind::FrameAddress(_) if Memory::is_inside(self.layout, function, value) => value,
            _ => value.as_bits(),
        };
        Stop::With(Outcome::Exit(token, state.iter().map(seen).collect()))
    }

    pub(crate) fn finish(&self, outcome: Outcome, steps: u64) -> Run {
        Run {
            outcome,
            trace: self.trace.clone(),
            memory: self.memory.clone(),
            steps,
        }
    }
}

#[derive(Clone)]
pub(crate) struct Run {
    pub(crate) outcome: Outcome,
    pub(crate) trace: Trace,
    pub(crate) memory: Memory,
    pub(crate) steps: u64,
}

fn allow_all(allowed: &[Datum], actual: &[Datum]) -> bool {
    allowed.len() == actual.len() && allowed.iter().zip(actual).all(|(a, b)| a.allows(b.bits))
}

fn agree(allowed: Option<u64>, actual: Option<u64>) -> bool {
    allowed.is_none() || allowed == actual
}

impl Run {
    pub(crate) fn is_complete(&self) -> bool {
        matches!(
            self.outcome,
            Outcome::Return(_) | Outcome::Exit(..) | Outcome::Trap(_)
        )
    }

    /// Whether what a concrete run did is among what this reference run leaves open.
    pub(crate) fn check(
        &self,
        outcome: &Outcome,
        trace: &Trace,
        memory: &Memory,
    ) -> Result<(), String> {
        for (index, (a, b)) in self.trace.events.iter().zip(&trace.events).enumerate() {
            let (allowed, actual) = (
                &self.trace.observed[a.uses.clone()],
                &trace.observed[b.uses.clone()],
            );
            let difference = if a.source != b.source {
                "source"
            } else if !allow_all(allowed, actual) {
                "operands"
            } else if !agree(a.data, b.data) {
                "data"
            } else if !agree(a.frame, b.frame) {
                "frame"
            } else if !agree(a.unordered, b.unordered) {
                "patchpoints that ran before"
            } else {
                continue;
            };
            return Err(format!(
                "event {index} differs in {difference}: expected {:?} {allowed:?}, got {:?} {actual:?}",
                a.source, b.source
            ));
        }
        if !self.is_complete() {
            return Ok(());
        }
        let same_outcome = match (&self.outcome, outcome) {
            (Outcome::Return(a), Outcome::Return(b)) => allow_all(a, b),
            (Outcome::Exit(first, a), Outcome::Exit(second, b)) => {
                first == second && allow_all(a, b)
            }
            (a, b) => a == b,
        };
        if !same_outcome {
            return Err(format!("expected {:?}, got {outcome:?}", self.outcome));
        }
        let (expected, actual) = (self.trace.events.len(), trace.events.len());
        if expected != actual {
            return Err(format!("expected {expected} events, got {actual}"));
        }
        if !agree(self.trace.unordered, trace.unordered) {
            return Err("other patchpoints ran".into());
        }
        if let Some(offset) = self.memory.data.first_conflict(&memory.data.bits) {
            return Err(format!("data differs at offset {offset}"));
        }
        if !matches!(outcome, Outcome::Return(_))
            && let Some(offset) = self.memory.frame.first_conflict(&memory.frame.bits)
        {
            return Err(format!("frame differs at offset {offset}"));
        }
        Ok(())
    }
}

/// Keeps its buffers from one run to the next.
pub(crate) struct Interpreter<'a> {
    pub(crate) machine: Machine<'a>,
    values: Vec<Datum>,
    variables: Vec<Datum>,
    /// Where the elements of a tuple start in `elements`.
    first_element: Vec<u32>,
    elements: Vec<Datum>,
    uses: Vec<Datum>,
    results: Vec<Datum>,
    promises: Vec<Promise>,
    makes_promises_due: Vec<bool>,
    random: Option<Random>,
    pub(crate) steps: u64,
    /// The instructions that have run since `load`.
    pub(crate) has_run: Vec<bool>,
    /// The sum has been outside the arrays since it started there.
    has_strayed: Vec<bool>,
}

fn lane_size(lanes: Lanes) -> Size {
    match lanes {
        Lanes::Int(size) => size,
        Lanes::Float(width) => width.width().size(),
    }
}

fn bytes_loaded(kind: Load, ty: Type) -> u32 {
    match kind {
        Load::Narrow(size, _) | Load::VectorSplat(size) | Load::VectorZero(size) => {
            size.bytes().into()
        }
        Load::Full => ty.bytes(),
        Load::VectorExtend(..) => 8,
    }
}

fn low_bytes(size: Size) -> u128 {
    u128::MAX >> (128 - size.bits())
}

impl<'a> Interpreter<'a> {
    pub(crate) fn new(layout: &'a Layout, target: Target) -> Self {
        Self {
            machine: Machine::new(layout, target),
            values: Vec::new(),
            variables: Vec::new(),
            first_element: Vec::new(),
            elements: Vec::new(),
            uses: Vec::new(),
            results: Vec::new(),
            promises: Vec::new(),
            makes_promises_due: Vec::new(),
            random: None,
            steps: 0,
            has_run: Vec::new(),
            has_strayed: Vec::new(),
        }
    }

    /// Before the first run of a function, which is valid.
    pub(crate) fn load(&mut self, function: &Function) {
        let registers = registers(self.machine.target);
        let pinned = [self.machine.layout.data_start(), NUMBER_TAG, NOT_CELL_MASK];
        let (count, mut elements) = (function.value_count(), 0);
        self.values.clear();
        self.first_element.clear();
        for value in (0..count).map(Value::from_index) {
            self.first_element.push(elements);
            elements += match *function.op(value) {
                Op::Wide(..) | Op::MulWide(..) => 2,
                Op::Patchpoint(_) | Op::Node { .. } | Op::WideNode { .. } => {
                    result_types(function, value).count() as u32
                }
                _ => 0,
            };
            self.values.push(match *function.op(value) {
                Op::ConstV128(constant) => function.vector_constant(constant).into(),
                Op::Pinned(reg) if reg == registers.frame_pointer => {
                    Datum::frame_address(Segment::AroundFramePointer, FRAME_POINTER)
                }
                Op::Pinned(reg) => pinned[registers
                    .pinned
                    .iter()
                    .position(|&known| known == reg)
                    .unwrap()]
                .into(),
                Op::SlotAddress(slot) => {
                    Datum::frame_address(Segment::Slot(slot), slot_address(function, slot))
                }
                _ => function.constant_bits(value).unwrap_or(0).into(),
            });
        }
        self.elements.clear();
        self.elements.resize(elements as usize, Datum::new(0, 0));
        self.promises = promises(function);
        self.makes_promises_due.clear();
        self.makes_promises_due.resize(count, false);
        for after in self
            .promises
            .iter()
            .filter_map(|promise| promise.after.expand())
        {
            self.makes_promises_due[after.index()] = true;
        }
        self.has_run.clear();
        self.has_run.resize(count, false);
        self.has_strayed.clear();
        self.has_strayed.resize(count, false);
    }

    /// The trace and the memory are left in `machine`.
    pub(crate) fn run(&mut self, function: &Function, input: &Input, options: Options) -> Outcome {
        self.random = match options.mode {
            Mode::Reference => None,
            Mode::Concrete(seed) => Some(Random::new(seed)),
        };
        self.machine.reset(function, input, self.random.as_mut());
        self.variables.clear();
        for variable in 0..function.variable_count() {
            let ty = function.variable_type(Entity::from_index(variable));
            let initial = self.decide(Datum::anything(ty));
            self.variables.push(initial);
        }
        self.steps = 0;
        let mut block = function.entries()[input.entry].block;
        for (&param, &arg) in function.params(block).iter().zip(&input.args) {
            self.values[param.index()] = arg.into();
        }
        loop {
            match self.run_block(function, block, options) {
                Ok(next) => block = next,
                Err(Stop::With(outcome)) => return outcome,
                Err(Stop::Undefined(reason)) => return Outcome::Undefined(reason),
            }
        }
    }

    pub(crate) fn run_to_end(
        &mut self,
        function: &Function,
        input: &Input,
        options: Options,
    ) -> Run {
        let outcome = self.run(function, input, options);
        self.machine.finish(outcome, self.steps)
    }

    #[inline]
    fn decide(&mut self, value: Datum) -> Datum {
        match &mut self.random {
            Some(random) => value.choose(random),
            None => value,
        }
    }

    #[inline]
    fn get(&self, value: Value) -> Datum {
        let datum = self.values[value.index()];
        if self.random.is_some() {
            datum.bits.into()
        } else {
            datum
        }
    }

    fn gather(&mut self, lists: [&[Value]; 2]) {
        self.uses.clear();
        for &value in lists.into_iter().flatten() {
            self.uses.push(self.get(value));
        }
    }

    fn run_block(
        &mut self,
        function: &Function,
        block: Block,
        options: Options,
    ) -> Result<Block, Stop> {
        let last = function.last(block);
        let mut value = function.first(block);
        if self.steps == 0 {
            self.check_promises(function, Value::NONE, options)?;
        }
        for &param in function.params(block) {
            if self.makes_promises_due[param.index()] {
                self.check_promises(function, param, options)?;
            }
        }
        loop {
            if self.steps == options.fuel {
                return Err(Stop::With(Outcome::OutOfFuel));
            }
            self.steps += 1;
            self.has_run[value.index()] = true;
            if value == last {
                break;
            }
            let result = self.execute(function, value, options)?;
            self.values[value.index()] = self.decide(result);
            self.follow_address(function, value)?;
            if self.makes_promises_due[value.index()] {
                self.check_promises(function, value, options)?;
            }
            value = function.next(value);
        }
        let edge = function.successor(block, self.choose_successor(function, last)?);
        self.gather([function.args(edge), &[]]);
        let target = function.target(edge);
        for (&param, &arg) in function.params(target).iter().zip(&self.uses) {
            self.values[param.index()] = arg;
        }
        let args = function.args(edge).iter();
        let passed: Vec<bool> = args.map(|arg| self.has_strayed[arg.index()]).collect();
        for (&param, has_strayed) in function.params(target).iter().zip(passed) {
            self.has_strayed[param.index()] = has_strayed;
        }
        Ok(target)
    }

    fn is_in_arrays(&self, function: &Function, address: Value) -> bool {
        let start = self.machine.layout.start_of(function, Region::Arrays);
        let arrays = start..start + u64::from(Region::Arrays.size(function));
        (self.get(address).known()).is_ok_and(|bits| arrays.contains(&bits))
    }

    fn follow_address(&mut self, function: &Function, value: Value) -> Result<(), Stop> {
        match *function.op(value) {
            Op::Binary(op @ (Binary::Add | Binary::Sub), [a, b])
                if function.type_of(value) == Type::I64 =>
            {
                let bases = if op == Binary::Add { &[a, b][..] } else { &[a] };
                let strays = |&base: &Value| {
                    self.has_strayed[base.index()]
                        || self.is_in_arrays(function, base) && !self.is_in_arrays(function, value)
                };
                self.has_strayed[value.index()] = bases.iter().any(strays);
            }
            Op::Load { address, .. }
                if function.origin(value).0 & IN_OBJECT != 0
                    && self.has_strayed[address.index()] =>
            {
                return Err(Stop::Undefined("an address has been outside its object"));
            }
            _ => {}
        }
        Ok(())
    }

    fn check_promises(
        &mut self,
        function: &Function,
        after: Value,
        options: Options,
    ) -> Result<(), Stop> {
        let promises = std::mem::take(&mut self.promises);
        let mut due = promises.iter().filter(|promise| promise.after == after);
        let result = due.try_for_each(|promise| {
            let mut overwritten = Vec::new();
            for step in &promise.steps {
                let first = overwritten.len();
                match step {
                    &Step::Compute(value) => {
                        overwritten.push((value, self.execute(function, value, options)?));
                    }
                    Step::Pass(pairs) => {
                        let pairs = pairs.iter();
                        overwritten
                            .extend(pairs.map(|&(to, from)| (to, self.values[from.index()])));
                    }
                }
                for (value, result) in &mut overwritten[first..] {
                    *result = self.decide(*result);
                    std::mem::swap(&mut self.values[value.index()], result);
                }
            }
            let (address, offset, size, access) = match *function.op(promise.load) {
                Op::Load {
                    kind,
                    address,
                    offset,
                    access,
                } => {
                    let size = bytes_loaded(kind, function.type_of(promise.load));
                    (address, offset, size, access)
                }
                Op::LoadLane {
                    lanes,
                    args: [_, address],
                    offset,
                    access,
                    ..
                } => (address, offset, lanes.bytes().into(), access),
                _ => unreachable!("not a load"),
            };
            let address = (self.get(address), offset);
            for (value, old) in overwritten.into_iter().rev() {
                self.values[value.index()] = old;
            }
            match self
                .machine
                .locate(function, promise.load, address, size, access, false)
            {
                Err(Stop::Undefined(_)) => Err(Stop::Undefined("a load is not always readable")),
                _ => Ok(()),
            }
        });
        self.promises = promises;
        result
    }

    fn invoke(&mut self, function: &Function, site: Value) -> Result<usize, Stop> {
        self.gather([
            function.operands(site),
            function.state(function.state_of(site)),
        ]);
        let successor = self
            .machine
            .invoke(function, site, &self.uses, &mut self.results)?;
        let first = self.first_element[site.index()] as usize;
        self.elements[first..first + self.results.len()].copy_from_slice(&self.results);
        if let [result] = self.results[..] {
            self.values[site.index()] = self.decide(result);
        }
        Ok(successor)
    }

    fn choose_successor(&mut self, function: &Function, last: Value) -> Result<usize, Stop> {
        Ok(match *function.op(last) {
            Op::Jump => 0,
            Op::Branch(condition) => usize::from(!self.get(condition).is_not_zero()?),
            Op::Switch(value, cases) => {
                let bits = self.get(value).known()?;
                let key = if function.type_of(value) == Type::I32 {
                    (bits as i32).into()
                } else {
                    bits as i64
                };
                let cases = function.cases(cases);
                let found = cases.iter().position(|&case| case == key);
                found.unwrap_or(cases.len())
            }
            Op::JumpTable(index, cases) => {
                let entry = function.cases(cases).get(self.get(index).known()? as usize);
                *entry.ok_or(Stop::Undefined("index outside a jump table"))? as usize
            }
            Op::Return(_) => {
                let results = function.operands(last).iter();
                let results = results.map(|&result| self.get(result).as_bits()).collect();
                return Err(Stop::With(Outcome::Return(results)));
            }
            Op::Unreachable => return Err(Stop::Undefined("reached what cannot be")),
            Op::Patchpoint(_) | Op::Node { .. } | Op::WideNode { .. } => {
                self.invoke(function, last)?
            }
            ref op => unreachable!("{op:?} does not end a block"),
        })
    }

    fn exit(&mut self, function: &Function, value: Value) -> Stop {
        let exit = function.op(value).exit().unwrap();
        self.gather([function.state(exit.state), &[]]);
        self.machine.exit(function, exit.token, &self.uses)
    }

    fn set_elements(&mut self, tuple: Value, elements: &[Datum; 2]) -> Datum {
        let first = self.first_element[tuple.index()] as usize;
        self.elements[first..first + 2].copy_from_slice(elements);
        Datum::new(0, 0)
    }

    /// What other threads see before the instruction.
    fn before_fence(&mut self, function: &Function, value: Value, options: Options) {
        if options.other_threads {
            let first = self.machine.trace.observed.len();
            let source = Source::Fence(function.origin(value));
            self.machine
                .record(function, source, function.effects(value), first);
        }
    }

    /// What this thread sees of other threads after the instruction.
    fn after_fence(&mut self, function: &Function, value: Value, options: Options) {
        let writes = function.effects(value).writes;
        if options.other_threads && writes != Heap::NOTHING {
            let seed = mix(
                function.origin(value).0.into(),
                self.machine.trace.events.len() as u64,
            );
            let (layout, range) = (self.machine.layout, function.heap_range(writes));
            self.machine.memory.scramble(layout, range, Some(seed), 8);
        }
    }

    fn access(
        &mut self,
        function: &Function,
        value: Value,
        (address, offset): (Value, i32),
        size: u32,
        options: Options,
        change: Option<&dyn Fn(Datum) -> Result<Datum, Open>>,
    ) -> Result<Datum, Stop> {
        let access = function.op(value).access().unwrap();
        let is_atomic = access.has(AccessFlags::ATOMIC);
        if is_atomic {
            self.before_fence(function, value, options);
        }
        let address = (self.get(address), offset);
        let place =
            self.machine
                .locate(function, value, address, size, access, change.is_some())?;
        let old = self.machine.memory.read(place, size);
        if let Some(change) = change {
            self.machine.memory.write(place, size, change(old)?);
        }
        if is_atomic {
            self.after_fence(function, value, options);
        }
        Ok(old)
    }

    fn execute(
        &mut self,
        function: &Function,
        value: Value,
        options: Options,
    ) -> Result<Datum, Stop> {
        const NOTHING: Datum = Datum::new(0, 0);
        let (ty, quiets, relaxed) = (
            function.type_of(value),
            function.quiets_nans,
            options.relaxed,
        );
        Ok(match *function.op(value) {
            Op::Unary(Unary::FitsIn(count), a) => {
                let Datum { bits, unknown, .. } = self.get(a).as_bits();
                if (bits & !unknown) >> count != 0 {
                    return Err(Stop::Undefined("does not fit"));
                }
                if unknown >> count != 0 {
                    return Err(Open.into());
                }
                self.get(a)
            }
            Op::Unary(op, a) => datum::unary(op, function.type_of(a), ty, self.get(a), quiets),
            Op::Binary(op, [a, b]) => datum::binary(op, ty, self.get(a), self.get(b), quiets)
                .map_err(|partial| match partial {
                    Partial::Undefined => Stop::Undefined("division without a quotient"),
                    Partial::Open => Open.into(),
                })?,
            Op::Compare(cond, [a, b]) => {
                datum::compare(cond, function.type_of(a), self.get(a), self.get(b))
            }
            Op::FloatCompare(cond, [a, b]) => {
                datum::float_compare(cond, function.type_of(a), self.get(a), self.get(b))
            }
            Op::Select([condition, then, or]) => match self.get(condition).is_not_zero() {
                Ok(true) => self.get(then),
                Ok(false) => self.get(or),
                Err(Open) => self.get(then).join(self.get(or)),
            },
            Op::Wide(op, args) => {
                let halves = datum::wide(op, &args.map(|arg| self.get(arg)));
                self.set_elements(value, &halves)
            }
            Op::MulWide(sign, [a, b]) => {
                let halves = datum::mul_wide(sign, self.get(a), self.get(b));
                self.set_elements(value, &halves)
            }
            Op::Extract(tuple, position) => {
                self.elements[(self.first_element[tuple.index()] + position) as usize]
            }
            Op::Load {
                kind,
                address,
                offset,
                ..
            } => {
                let size = bytes_loaded(kind, ty);
                let loaded =
                    self.access(function, value, (address, offset), size, options, None)?;
                match kind {
                    Load::Narrow(size, Sign::Signed) => {
                        datum::unary(Unary::SignExtend(size), ty, ty, loaded, quiets)
                    }
                    Load::Narrow(_, Sign::Unsigned) | Load::Full | Load::VectorZero(_) => loaded,
                    Load::VectorExtend(size, sign) => {
                        loaded.map(|bits| lanes::extend(size, sign, bits as u64))
                    }
                    Load::VectorSplat(size) => loaded.map(|bits| lanes::splat(size, bits as u64)),
                }
            }
            Op::Store {
                kind,
                args: [stored, address],
                offset,
                ..
            } => {
                let size = match kind {
                    Store::Narrow(size) => size.bytes().into(),
                    Store::Full => function.type_of(stored).bytes(),
                };
                let stored = self.get(stored);
                let change = |_| Ok(stored);
                self.access(
                    function,
                    value,
                    (address, offset),
                    size,
                    options,
                    Some(&change),
                )?;
                NOTHING
            }
            Op::LoadLane {
                lanes: size,
                lane,
                args: [vector, address],
                offset,
                ..
            } => {
                let bytes = size.bytes().into();
                let loaded =
                    self.access(function, value, (address, offset), bytes, options, None)?;
                replace_lane(size, self.get(vector), lane, loaded)
            }
            Op::StoreLane {
                lanes: size,
                lane,
                args: [vector, address],
                offset,
                ..
            } => {
                let extract = |bits| lanes::extract(size, Sign::Unsigned, bits, lane).into();
                let stored = self.get(vector).map(extract);
                let (bytes, change) = (size.bytes().into(), |_| Ok(stored));
                self.access(
                    function,
                    value,
                    (address, offset),
                    bytes,
                    options,
                    Some(&change),
                )?;
                NOTHING
            }
            Op::AtomicUpdate {
                op,
                size,
                args: [operand, address],
                ..
            } => {
                let operand = self.get(operand);
                let change = |old| {
                    let op = match op {
                        AtomicOp::Add => Binary::Add,
                        AtomicOp::Sub => Binary::Sub,
                        AtomicOp::And => Binary::And,
                        AtomicOp::Or => Binary::Or,
                        AtomicOp::Xor => Binary::Xor,
                        AtomicOp::Exchange => return Ok(operand),
                    };
                    datum::binary(op, ty, old, operand, quiets).map_err(|_| Open)
                };
                let bytes = size.bytes().into();
                self.access(function, value, (address, 0), bytes, options, Some(&change))?
            }
            Op::AtomicCompareExchange {
                size,
                args: [expected, replacement, address],
                ..
            } => {
                let expected = self.get(expected).map(|bits| bits & low_bytes(size));
                let replacement = self.get(replacement);
                let change = |old: Datum| {
                    let matches = old.known()? == expected.known()?;
                    Ok(if matches { replacement } else { old })
                };
                let bytes = size.bytes().into();
                self.access(function, value, (address, 0), bytes, options, Some(&change))?
            }
            Op::Fence { .. } => {
                self.before_fence(function, value, options);
                self.after_fence(function, value, options);
                NOTHING
            }
            Op::Check(condition, _) => {
                if self.get(condition).is_not_zero()? {
                    return Err(self.exit(function, value));
                }
                NOTHING
            }
            Op::Checked(op, [a, b], _) => match datum::checked(op, ty, self.get(a), self.get(b))? {
                Some(result) => result,
                None => return Err(self.exit(function, value)),
            },
            Op::Patchpoint(_) | Op::Node { .. } | Op::WideNode { .. } => {
                self.invoke(function, value)?;
                self.values[value.index()]
            }
            Op::VectorUnary(op, a) => datum::vector_unary(op, relaxed, self.get(a)),
            Op::VectorBinary(op, [a, b]) => {
                datum::vector_binary(op, relaxed, self.get(a), self.get(b))
            }
            Op::VectorTernary(op, args) => {
                datum::vector_ternary(op, relaxed, args.map(|arg| self.get(arg)))
            }
            Op::VectorShift(op, [a, amount]) => {
                datum::vector_shift(op, self.get(a), self.get(amount))
            }
            Op::VectorReduce(op, a) => datum::vector_reduce(op, self.get(a)),
            Op::Shuffle([a, b], pattern) => {
                let pattern = function.vector_constant(pattern).to_le_bytes();
                let (a, b) = (self.get(a), self.get(b));
                Datum::new(
                    lanes::shuffle(a.bits, b.bits, pattern),
                    lanes::shuffle(a.unknown, b.unknown, pattern),
                )
            }
            Op::Splat(lanes, scalar) => {
                let splat = |bits| lanes::splat(lane_size(lanes), bits as u64);
                self.get(scalar).map(splat)
            }
            Op::ExtractLane {
                lanes,
                sign,
                lane,
                vector,
            } => {
                let extract = |bits| lanes::extract(lane_size(lanes), sign, bits, lane).into();
                self.get(vector).map(extract)
            }
            Op::ReplaceLane {
                lanes,
                lane,
                args: [vector, scalar],
            } => replace_lane(lane_size(lanes), self.get(vector), lane, self.get(scalar)),
            Op::GetVariable(variable) => self.variables[variable.index()],
            Op::SetVariable(variable, stored) => {
                self.variables[variable.index()] = self.get(stored);
                NOTHING
            }
            ref op => unreachable!("{op:?} is not in the middle of a block"),
        })
    }
}

fn replace_lane(size: Size, vector: Datum, lane: u8, scalar: Datum) -> Datum {
    let scalar = scalar.as_bits();
    Datum::new(
        lanes::replace(size, vector.bits, lane, scalar.bits as u64),
        lanes::replace(size, vector.unknown, lane, scalar.unknown as u64),
    )
}
