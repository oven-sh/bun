//! Picks instructions by what values are expected to be, checks what is not known, and drops the checks of what is.

mod ahead;
mod arithmetic;
mod checks;
mod comparisons;
mod conversions;
mod math;
mod strings;

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{
    self, AccessFlags, Block, Edge, Exit, Function, Heap, Load, Op, Origin, State, Store, Table,
    Type, Value as Ssa,
};
use bun_engine_codegen::passes::Analyses;
use bun_engine_vm::SpeculatedType;
use smallvec::SmallVec;

use super::loop_writes::LoopWrites;
use super::usage::Usage;
use crate::graph::probes::Claim;
use crate::graph::{
    AS_INDEX, ExitKind, Graph, Kind, Knowledge, Known, SavedKnowledge, implied_by_end,
};

struct Specializer<'a> {
    graph: &'a mut Graph,
    usage: &'a Usage,
    knowledge: &'a mut Knowledge,
    /// The instruction that is being replaced.
    at: Ssa,
    origin: Origin,
    state: State,
    put_off: Option<ahead::PutOff>,
    has_unproven: bool,
    /// For blocks that are yet to be put in the middle of the edges.
    checks_on_edges: Vec<(Edge, ahead::Insertion)>,
    /// Otherwise a block may be reached only by way of those that come later.
    may_cut_edges: bool,
    changed_control_flow: bool,
}

type Arrivals = Table<Block, Option<SavedKnowledge>>;

pub(super) fn run(
    graph: &mut Graph,
    analyses: &mut Analyses,
    usage: &Usage,
    knowledge: &mut Knowledge,
) {
    let cfg = analyses.cfg(&mut graph.function);
    let loop_writes = LoopWrites::new(graph, cfg);
    let mut arrivals = Arrivals::default();
    arrivals.reserve(graph.function.block_count());
    (0..graph.function.block_count()).for_each(|_| _ = arrivals.push(None));
    knowledge.reset();
    let mut specializer = Specializer {
        graph,
        usage,
        knowledge,
        at: Ssa::NONE,
        origin: Origin::default(),
        state: State::NONE,
        put_off: None,
        has_unproven: false,
        checks_on_edges: Vec::new(),
        may_cut_edges: cfg.loops().values().all(|it| it.is_natural),
        changed_control_flow: false,
    };
    for &block in cfg.order() {
        match arrivals[block].take() {
            Some(mut arrival) => {
                specializer.knowledge.take_back(&mut arrival);
                specializer.enter(cfg, block, &loop_writes);
            }
            None if cfg.predecessors(block).is_empty() => specializer.knowledge.clear(),
            None => continue,
        }
        specializer.walk(block);
        specializer.leave(cfg, block, &mut arrivals);
    }
    specializer.split_edges();
    if specializer.changed_control_flow {
        analyses.invalidate();
        analyses.cfg(&mut graph.function);
    }
    graph.function.resolve_aliases();
    graph.is_specialized = true;
}

fn is_reached_again(function: &Function, cfg: &Cfg, block: Block) -> bool {
    let last = cfg.predecessors(block).last();
    last.is_some_and(|&edge| cfg.is_backward(function, edge))
}

impl Specializer<'_> {
    fn enter(&mut self, cfg: &Cfg, block: Block, writes: &LoopWrites) {
        if !is_reached_again(&self.graph.function, cfg, block) {
            return;
        }
        match cfg
            .loop_headed_by(block)
            .filter(|&headed| cfg.loops()[headed].is_natural)
        {
            Some(headed) => self.knowledge.enter_known_loop(
                self.graph,
                |heap| writes.may_write(&self.graph.function, headed, heap),
                |shapes| writes.has_transition(self.graph, headed, shapes),
            ),
            None => self.knowledge.clear(),
        }
    }

    fn leave(&mut self, cfg: &Cfg, block: Block, arrivals: &mut Arrivals) {
        let put_off = self.put_off.take();
        // The walk tends to go on with the first.
        for (position, edge) in self.graph.function.successors(block).enumerate().rev() {
            self.graph.function.resolve_args(edge);
            let is_backward = cfg.is_backward(&self.graph.function, edge);
            if is_backward && put_off.is_none() {
                continue;
            }
            let before = implied_by_end(self.graph, block, position).map(|(subject, ty)| {
                let known = self.knowledge.entry(self.graph, subject);
                let before = *known;
                (known.ty, known.alias) = (known.ty & ty, Ssa::NONE);
                before
            });
            let before = before.or_else(|| {
                let function = &self.graph.function;
                let Op::Branch(condition) = *function.op(function.last(block)) else {
                    return None;
                };
                (self.knowledge).assume_modes(self.graph, condition, position == 0)
            });
            if let Some(put_off) = &put_off {
                self.check_along(cfg, put_off, edge, position);
            }
            if !is_backward {
                self.arrive(cfg, edge, arrivals, position == 0);
            }
            if let Some(before) = before.filter(|_| position != 0) {
                *self.knowledge.entry(self.graph, before.root) = before;
            }
        }
    }

    fn arrive(&mut self, cfg: &Cfg, edge: Edge, arrivals: &mut Arrivals, is_last: bool) {
        let (function, knowledge) = (&self.graph.function, &mut *self.knowledge);
        let target = function.target(edge);
        let mut params: SmallVec<[Known; 4]> = SmallVec::new();
        if !function.params(target).is_empty() && !is_reached_again(function, cfg, target) {
            let pairs = function.args(edge).iter().zip(function.params(target));
            let tagged = pairs.filter(|&(_, &param)| {
                function.type_of(param) == Type::I64
                    && self.graph.inherent_type(param) != SpeculatedType::INT52
            });
            params.extend(tagged.map(|(&arg, &param)| knowledge.passed_on(self.graph, arg, param)));
        }
        let arrival = match &mut arrivals[target] {
            Some(arrival) => {
                for known in &mut params {
                    let earlier = knowledge.find_saved(arrival, known.root).copied();
                    known.widen(self.graph, &earlier.expect("from the first way"));
                }
                knowledge.merge_into(self.graph, arrival);
                arrival
            }
            first if is_last => first.insert(knowledge.hand_over()),
            first => first.insert(knowledge.save()),
        };
        knowledge.add_to_saved(arrival, &params);
    }

    fn walk(&mut self, block: Block) {
        let mut value = self.graph.function.first(block);
        while !value.is_none() {
            self.graph.function.resolve_operands(value);
            (self.at, self.origin, self.state) = (
                value,
                self.graph.function.origin(value),
                self.graph.function.state_of(value),
            );
            if self.has_unproven {
                self.tie_to_proofs();
            }
            match self.graph.node(value) {
                Some((Kind::Verify, _)) => self.verify_some_of_what_is_known(),
                Some((kind, data)) => self.visit_node(kind, data),
                None => self.visit_instruction(),
            }
            value = self.graph.function.next(value);
        }
    }

    fn visit_node(&mut self, kind: Kind, data: u32) {
        let operand = |position| {
            self.graph
                .function
                .operands(self.at)
                .get(position)
                .copied()
                .unwrap_or(Ssa::NONE)
        };
        let (first, second) = (operand(0), operand(1));
        let replacement = match kind {
            Kind::AsInt32 if data == AS_INDEX => self.as_index(first),
            Kind::AsInt32 => self.as_int32(first, self.conversion_failure(data)),
            Kind::AsInt52 => self.as_int52(first, self.conversion_failure(data)),
            Kind::AsDouble => self.as_double(first, self.conversion_failure(data)),
            Kind::AsBoolean => self.as_boolean(first, self.conversion_failure(data)),
            Kind::Truncate => self.truncate(first),
            Kind::ToDouble => self.to_double(first),
            Kind::Clamp => self.clamp(first),
            Kind::TruncateInRange => self.truncate_in_range(first, data),
            Kind::UInt32ToNumber => self.uint32_to_number(first),
            Kind::NumberAdd | Kind::NumberSubtract | Kind::NumberMultiply => {
                self.add_or_multiply(kind, first, second)
            }
            Kind::NumberDivide => self.divide(first, second),
            Kind::NumberRemainder => self.remainder(first, second),
            Kind::NumberNegate => self.negate(first),
            Kind::NumberAbs => self.abs(first),
            Kind::NumberMin | Kind::NumberMax => self.min_or_max(kind, first, second),
            Kind::NumberFloor | Kind::NumberCeil | Kind::NumberTrunc | Kind::NumberRound => {
                self.round(kind, first)
            }
            Kind::NumberToNumber => self.check_type(
                first,
                bun_engine_vm::SpeculatedType::BOXED_NUMBER,
                ExitKind::NotANumber,
            ),
            Kind::NumberPower => self.power(first, second),
            Kind::QuietToNumber => self.quiet_to_number(first),
            Kind::ToString => self.to_string(first, self.graph.interned_type(data)),
            Kind::Compare => self.compare(crate::graph::Relation::from_data(data), first, second),
            Kind::LooseEqual => self.loose_equal(first, second),
            Kind::StrictEqual => self.strict_equal(first, second),
            Kind::ToBoolean => self.to_boolean(first),
            Kind::EqualNull => self.equal_null(first),
            _ => return self.refine(kind, data, first, second),
        };
        let replacement = self.as_promised(replacement);
        self.graph.function.replace(self.at, replacement);
    }

    fn visit_instruction(&mut self) {
        match *self.graph.function.op(self.at) {
            Op::Load {
                kind: Load::Full,
                address,
                offset,
                access,
            } if access.has(AccessFlags::ALWAYS_READABLE) && !self.is_element(address) => {
                let heap = if access.has(AccessFlags::IMMUTABLE) {
                    Heap::NOTHING
                } else {
                    access.heap()
                };
                let base = self.graph.holder(address, heap);
                let ty = self.graph.function.type_of(self.at);
                match self
                    .knowledge
                    .field(base, offset, heap)
                    .filter(|&known| self.graph.function.type_of(known) == ty)
                {
                    Some(known) => {
                        self.verify(Claim::Field(offset, ty.bytes(), heap), &[address, known]);
                        self.graph.function.replace(self.at, known);
                    }
                    None => {
                        self.tie_to_check(address, access.heap());
                        self.knowledge.learn_field(base, offset, heap, self.at);
                    }
                }
            }
            Op::Store {
                args: [stored, address],
                offset,
                ..
            } if (self.graph).is_saved_in(self.graph.root(stored), address, offset) => {
                self.graph.function.remove(self.at);
            }
            Op::Store {
                kind,
                args: [stored, address],
                offset,
                access,
            } => {
                self.knowledge.note_write(self.graph, access.heap());
                if kind == Store::Full && !self.is_element(address) {
                    self.knowledge.learn_field(
                        self.graph.holder(address, access.heap()),
                        offset,
                        access.heap(),
                        stored,
                    );
                }
            }
            Op::Branch(condition) if self.may_cut_edges => {
                if let Some(constant) = self.graph.function.int_constant(condition) {
                    let block = self.graph.function.block_of(self.at);
                    self.graph.function.keep_only_successor(
                        self.graph
                            .function
                            .successor(block, usize::from(constant == 0)),
                    );
                    self.changed_control_flow = true;
                }
            }
            Op::Switch(key, cases) if self.may_cut_edges => {
                let function = &mut self.graph.function;
                if let Some(constant) = function.int_constant(key) {
                    let keys = function.cases(cases);
                    let found = keys.iter().position(|&it| it == constant);
                    let (block, position) =
                        (function.block_of(self.at), found.unwrap_or(keys.len()));
                    function.keep_only_successor(function.successor(block, position));
                    self.changed_control_flow = true;
                }
            }
            Op::Compare(cond, [lhs, rhs])
                if self.graph.function.op(lhs).is_constant()
                    && self.graph.function.op(rhs).is_constant() =>
            {
                let folded = self.ir().compare(cond, lhs, rhs);
                self.graph.function.replace(self.at, folded);
            }
            Op::Binary(op, [lhs, rhs])
                if self.graph.function.op(lhs).is_constant()
                    && self.graph.function.op(rhs).is_constant() =>
            {
                let folded = self.ir().binary(op, lhs, rhs);
                self.graph.function.replace(self.at, folded);
            }
            Op::Check(condition, _) if self.graph.function.is_int_constant(condition, 0) => {
                self.graph.function.remove(self.at)
            }
            _ => {
                self.knowledge
                    .note_effects(self.graph, self.graph.function.effects(self.at), false)
            }
        }
    }

    /// The parameter that stood for the checks has given way to its only argument.
    fn tie_to_check(&mut self, address: Ssa, heap: Heap) {
        if self.graph.is_loose(address, heap) {
            let known = self.knowledge.entry(self.graph, address);
            known.ty &= SpeculatedType::CELL;
            known.alias = if known.alias == address {
                Ssa::NONE
            } else {
                known.alias
            };
            let alias = self.alias(address);
            self.graph.function.operands_mut(self.at)[0] = alias;
        }
    }

    // Helpers

    fn is_element(&self, address: Ssa) -> bool {
        matches!(self.graph.function.op(address), Op::Binary(..))
    }

    fn ir(&mut self) -> ir::Builder<'_> {
        ir::Builder::before(&mut self.graph.function, self.at)
    }

    fn node(&mut self, kind: Kind, operands: &[Ssa], data: u32) -> Ssa {
        let state = if kind.can_exit() {
            self.state
        } else if kind.can_throw() {
            self.graph.state_for_unwinding(self.origin)
        } else {
            State::NONE
        };
        let value = self.ir().node(
            kind.id(),
            kind.gives().machine_type(),
            operands,
            data,
            state,
        );
        self.knowledge
            .note_effects(self.graph, kind.effects(), kind.can_collect());
        value
    }

    #[inline(always)]
    #[cfg_attr(debug_assertions, track_caller)]
    fn verify(&mut self, claim: Claim, operands: &[Ssa]) {
        if let Some(data) = self.graph.sample(claim) {
            (self.ir()).node(Kind::Verify.id(), Type::Void, operands, data, State::NONE);
        }
    }

    /// Where no assumption has failed unnoticed.
    fn verify_some_of_what_is_known(&mut self) {
        const ONE_PLACE_IN: u32 = 8;
        if self.graph.random.next_u32().is_multiple_of(ONE_PLACE_IN) {
            for (claim, operands) in self.knowledge.claims() {
                self.verify(claim, &operands);
            }
        }
    }

    #[cfg_attr(debug_assertions, track_caller)]
    fn exit(&mut self, kind: ExitKind) -> Exit {
        self.graph.exit(kind, self.origin, self.state)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    fn exit_if(&mut self, condition: Ssa, kind: ExitKind) {
        if !self.graph.function.is_int_constant(condition, 0) {
            let exit = self.exit(kind);
            self.ir().check(condition, exit);
        }
    }

    fn has_exited(&self, kind: ExitKind) -> bool {
        self.graph.has_exited(self.origin, kind)
    }
}
