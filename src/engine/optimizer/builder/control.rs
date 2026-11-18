//! Blocks, edges and the parameters where ways meet.

use std::rc::Rc;

use bun_engine_bytecode::{BlockIndex, EdgeKind, Instruction, Register};
use bun_engine_codegen::ir::{Block, Edge, State, Successor, Type, Value as Ssa};
use smallvec::SmallVec;

use super::frame::Junction;
use super::interpret::part_that_stays;
use super::{Builder, Built, Refusal};
use crate::graph::{ExitKind, Kind, Known, implied_by_end, type_of_param, without_negation};

const MAX_VALUES: usize = 400_000;
const MAX_VALUES_IN_STATES: usize = 1_000_000;
const MOST_TESTS_SKIPPED: usize = 4;

impl Builder<'_> {
    /// Translates the innermost frame, which control enters at `first`.
    pub(super) fn build_blocks(&mut self, first: BlockIndex) -> Built {
        let liveness = Rc::clone(&self.frame().liveness);
        let order = self.order_from(first);
        let junctions = &mut self.frame_mut().junctions;
        junctions
            .iter_mut()
            .for_each(|junction| junction.is_done = true);
        order
            .iter()
            .for_each(|block| junctions[block.index()].is_done = false);
        let is_reducible = self.frame_mut().find_cycles(&order);
        self.frame_mut().is_reducible = is_reducible;
        if !liveness.graph().predecessors(first).is_empty() {
            self.goto(first);
        }
        let mut made_progress = true;
        while core::mem::take(&mut made_progress) {
            for (position, &block) in order.iter().enumerate() {
                if self.frame().junctions[block.index()].is_done {
                    continue;
                }
                let is_reached = !self.block.is_none() || self.enter_junction(block);
                if is_reached {
                    self.translate_block(block)?;
                }
                // Another way into a cycle may yet lead there.
                self.frame_mut().junctions[block.index()].is_done = is_reached || is_reducible;
                made_progress |= is_reached && !is_reducible;
                let next = BlockIndex(block.0 + 1);
                if !self.block.is_none()
                    && (order.get(position + 1) != Some(&next)
                        || liveness.graph().predecessors(next).len() != 1)
                {
                    self.goto(next);
                }
            }
        }
        Ok(())
    }

    /// Reverse postorder, which follows the code where it can.
    pub(super) fn order_from(&self, first: BlockIndex) -> Vec<BlockIndex> {
        let graph = self.frame().liveness.graph();
        let mut is_seen = vec![false; graph.len()];
        let separates_resumptions = self.frame().separates_resumptions;
        let with_successors = |block: BlockIndex| {
            let edges = graph.successors(block).iter();
            let resumes = separates_resumptions && block == BlockIndex(0);
            let taken = edges.filter(|edge| match edge.kind {
                EdgeKind::FallThrough => true,
                EdgeKind::Jump => !resumes,
                EdgeKind::Throw => false,
            });
            let mut successors: SmallVec<[BlockIndex; 4]> = taken.map(|edge| edge.block).collect();
            successors.sort_unstable_by_key(|successor| successor.0);
            (block, successors)
        };
        let (mut order, mut stack) = (Vec::new(), vec![with_successors(first)]);
        is_seen[first.index()] = true;
        while let Some((_, successors)) = stack.last_mut() {
            match successors.pop() {
                Some(next) if core::mem::replace(&mut is_seen[next.index()], true) => {}
                Some(next) => stack.push(with_successors(next)),
                None => order.push(stack.pop().unwrap().0),
            }
        }
        order.reverse();
        order
    }

    fn translate_block(&mut self, block: BlockIndex) -> Built {
        let frame = self.frames.last_mut().unwrap();
        let (code_block, liveness) = (frame.code_block, Rc::clone(&frame.liveness));
        frame.current = block;
        frame.live_before.clear();
        liveness.walk_backwards(code_block.body(), block, &mut self.walk, |_, _, live| {
            frame.live_before.extend_from_slice(live.words());
        });
        let range = liveness.graph().range(block);
        let mut offset = range.start;
        while offset < range.end && !self.block.is_none() {
            let (instruction, size) = Instruction::read(code_block.body().instructions(), offset);
            self.begin_instruction(offset);
            self.translate(instruction, offset + size)?;
            if core::mem::take(&mut self.is_cut_off) {
                self.block = Block::NONE;
            }
            let frame = self.frame_mut();
            frame
                .live_before
                .truncate(frame.live_before.len() - frame.words);
            offset += size;
            if self.graph.function.value_count() > MAX_VALUES
                || self.graph.layout_registers.len() > MAX_VALUES_IN_STATES
            {
                return Err(Refusal::TooLarge);
            }
        }
        Ok(())
    }

    fn block_of(&mut self, target: BlockIndex) -> Block {
        let junction = &mut self.frames.last_mut().unwrap().junctions[target.index()];
        *junction
            .block
            .get_or_insert_with(|| self.graph.function.new_block())
    }

    pub(super) fn target_at(&self, offset: u32) -> BlockIndex {
        self.frame().liveness.graph().block_at(offset)
    }

    /// Where the instruction at `offset` leads, if it does nothing but jump on what is known.
    fn outcome_of_test(&self, offset: u32) -> Option<u32> {
        let (frame, code_block) = (self.frame(), self.frame().code_block);
        let (instruction, size) = Instruction::read(code_block.body().instructions(), offset);
        let (value, target, jumps_on) = match instruction {
            Instruction::JumpIfTrue(op) => (op.value, op.target, true),
            Instruction::JumpIfFalse(op) => (op.value, op.target, false),
            _ => return None,
        };
        let truth = self.truth_of_constant(frame.get(value.as_register()?))?;
        Some(if truth == jumps_on {
            target.from(offset)
        } else {
            offset + size
        })
    }

    /// Goes on at `offset` with these values in the registers, which other ways through the instruction do not see.
    /// False, having done nothing, unless a block starts there or there is no need to run what is there.
    pub(super) fn try_goto_with(&mut self, values: &[(Register, Ssa)], offset: u32) -> bool {
        let old: SmallVec<[Ssa; 4]> = values.iter().map(|it| self.frame().get(it.0)).collect();
        values
            .iter()
            .for_each(|&(register, value)| self.set(register, value));
        let start = self
            .frame()
            .liveness
            .graph()
            .range(self.target_at(offset))
            .start;
        let offset = (start == offset)
            .then_some(offset)
            .or_else(|| self.outcome_of_test(offset));
        offset.inspect(|&offset| self.goto(self.target_at(offset)));
        (values.iter().zip(old).rev()).for_each(|(it, old)| self.frame_mut().set(it.0, old));
        offset.is_some()
    }

    pub(super) fn goto_with(&mut self, values: &[(Register, Ssa)], offset: u32) {
        let did_go = self.try_goto_with(values, offset);
        assert!(did_go);
    }

    pub(super) fn goto(&mut self, mut target: BlockIndex) {
        for _ in 0..MOST_TESTS_SKIPPED {
            let frame = self.frame();
            if !frame.is_reducible || frame.junctions[target.index()].heads_cycle {
                break;
            }
            match self.outcome_of_test(frame.liveness.graph().range(target).start) {
                Some(offset) => target = self.target_at(offset),
                None => break,
            }
        }
        let block = self.block_of(target);
        self.ir().jump(block, &[]);
        self.arrive(self.graph.function.successor(self.block, 0), target, true);
        self.block = Block::NONE;
    }

    /// Goes to `target` if the I32 `condition` is `expected`, and otherwise on to the instruction at `next`.
    pub(super) fn branch(&mut self, condition: Ssa, expected: bool, target: u32, next: u32) {
        let (condition, expected) = without_negation(&self.graph, condition, expected);
        let (taken, other) = (self.target_at(target), self.target_at(next));
        let (then, or) = if expected {
            (taken, other)
        } else {
            (other, taken)
        };
        if let Some(constant) = self.graph.function.int_constant(condition) {
            return self.goto(if constant != 0 { then } else { or });
        }
        let blocks = [then, or].map(|target| self.block_of(target));
        self.ir().branch(condition, blocks[0], blocks[1]);
        for (target, holds) in [(taken, expected), (other, !expected)] {
            let undo = self.assume_condition(condition, holds);
            let edge = (self.graph.function).successor(self.block, usize::from(!holds));
            let is_last = holds != expected;
            self.arrive(edge, target, is_last);
            if !is_last {
                self.undo_assumption(undo);
            }
        }
        self.block = Block::NONE;
    }

    pub(super) fn switch(&mut self, value: Ssa, cases: &[(i64, u32)], default: u32) {
        self.switch_with(value, cases, default, |_, _| {});
    }

    /// `prepare` sets the registers for the way at a position.
    pub(super) fn switch_with(
        &mut self,
        value: Ssa,
        cases: &[(i64, u32)],
        default: u32,
        prepare: impl Fn(&mut Self, usize),
    ) {
        if let Some(constant) = self.graph.function.int_constant(value) {
            let found = cases.iter().position(|&(key, _)| key == constant);
            prepare(self, found.unwrap_or(cases.len()));
            return self.goto(self.target_at(found.map_or(default, |it| cases[it].1)));
        }
        let targets: SmallVec<[BlockIndex; 16]> = cases
            .iter()
            .map(|&(_, offset)| offset)
            .chain([default])
            .map(|offset| self.target_at(offset))
            .collect();
        let blocks: SmallVec<[Block; 16]> = targets
            .iter()
            .map(|&target| self.block_of(target))
            .collect();
        let successors: SmallVec<[(i64, Successor<'_>); 16]> = cases
            .iter()
            .zip(&blocks)
            .map(|(&(key, _), &block)| (key, block.into()))
            .collect();
        self.ir()
            .switch(value, &successors, blocks[cases.len()].into());
        for (position, &target) in targets.iter().enumerate() {
            prepare(self, position);
            let undo = self.assume(implied_by_end(&self.graph, self.block, position));
            let edge = self.graph.function.successor(self.block, position);
            self.arrive(edge, target, false);
            self.undo_assumption(undo);
        }
        self.block = Block::NONE;
    }

    pub(super) fn force_exit(&mut self, kind: ExitKind) {
        let state = self.state();
        self.insert_node(Kind::ForceExit, &[], kind as u32, state);
        self.end_block();
    }

    /// In place of a check that cannot pass.
    pub(super) fn cut_off(&mut self, kind: ExitKind) {
        self.force_exit(kind);
        (self.block, self.is_cut_off) = (self.graph.function.new_block(), true);
    }

    /// After a node that ends the block and has no successors.
    pub(super) fn end_block(&mut self) {
        self.graph.function.clear_successors(self.block);
        self.block = Block::NONE;
    }

    fn arrive(&mut self, edge: Edge, target: BlockIndex, is_last: bool) {
        if self.is_cut_off {
            return;
        }
        let frame = self.frames.last_mut().unwrap();
        let leaves_loop = frame.header_around(frame.current) != frame.header_around(target);
        let mut junction = core::mem::take(&mut frame.junctions[target.index()]);
        self.scratch.clear();
        self.scratch.extend(
            frame
                .carried(frame.liveness.live_in(target))
                .map(|register| self.graph.root(frame.get(register))),
        );
        self.join(&mut junction, edge, leaves_loop, is_last);
        self.frame_mut().junctions[target.index()] = junction;
    }

    /// The values that the edge brings are in `scratch`. After the last edge of a block its knowledge is gone.
    pub(super) fn join(
        &mut self,
        junction: &mut Junction,
        edge: Edge,
        leaves_loop: bool,
        is_last: bool,
    ) {
        let graph = &mut self.graph;
        junction.is_reached |= !self.is_cut_off;
        junction.follows_effect |= self.needs_invalidation_point;
        // What the last turn started with is not to outlive the loop.
        let checkpoint = self.checkpoint.expand().filter(|_| !leaves_loop);
        if junction.edges.is_empty() || junction.checkpoint != checkpoint {
            junction.checkpoint = checkpoint.filter(|_| junction.edges.is_empty());
        }
        for &position in &junction.params {
            graph
                .function
                .push_arg(edge, self.scratch[position as usize]);
        }
        if junction.is_entered {
            debug_assert!(junction.values.iter().zip(&self.scratch).enumerate().all(
                |(position, (old, new))| {
                    old == new || junction.params.contains(&(position as u32))
                }
            ));
            return;
        }
        if junction.edges.is_empty() {
            junction.values.clone_from(&self.scratch);
            junction.knowledge = if is_last {
                self.knowledge.hand_over()
            } else {
                self.knowledge.save()
            };
            return junction.edges.push(edge);
        }
        let block = junction.block.unwrap();
        let mut about_params: SmallVec<[_; 8]> = SmallVec::new();
        for (position, (old, &new)) in junction.values.iter_mut().zip(&self.scratch).enumerate() {
            if *old == new {
                continue;
            }
            let earlier = (self.knowledge.find_saved(&junction.knowledge, *old)).copied();
            let is_param = graph.function.block_of(*old) == block;
            let param = if is_param {
                *old
            } else {
                graph.function.add_param(block, Type::I64)
            };
            let mut known = self.knowledge.passed_on(graph, new, param);
            known.widen(
                graph,
                &earlier.unwrap_or_else(|| Known::inherent(graph, *old)),
            );
            (known.alias, known.ty) = (param, type_of_param(known.ty));
            about_params.push(known);
            let seen = graph.prediction(*old) | graph.prediction(new);
            graph.predict(param, seen);
            if !is_param {
                junction
                    .edges
                    .iter()
                    .for_each(|&earlier| graph.function.push_arg(earlier, *old));
                graph.function.push_arg(edge, new);
                junction.params.push(position as u32);
                *old = param;
            }
        }
        self.knowledge.merge_into(graph, &junction.knowledge);
        (self.knowledge).add_to_saved(&junction.knowledge, &about_params);
        junction.edges.push(edge);
    }

    /// Returns false if nothing leads there.
    fn enter_junction(&mut self, target: BlockIndex) -> bool {
        let frame = self.frames.last_mut().unwrap();
        if !frame.junctions[target.index()].is_reached {
            return false;
        }
        let mut junction = core::mem::take(&mut frame.junctions[target.index()]);
        let block = junction.block.expect("the target of an edge");
        let liveness = Rc::clone(&frame.liveness);
        let is_translated =
            |edge: &bun_engine_bytecode::Edge| frame.junctions[edge.block.index()].is_done;
        let is_reached_again = !liveness
            .graph()
            .predecessors(target)
            .iter()
            .all(is_translated);
        self.knowledge.take_back(&mut junction.knowledge);
        if is_reached_again {
            (junction.checkpoint, junction.header) = (None, Some(target));
            self.add_loop_params(&mut junction, target);
            if !self.frame().is_reducible {
                self.knowledge.clear();
            }
            self.knowledge
                .enter_loop(&self.graph, self.graph.function.params(block));
        }
        let frame = self.frames.last_mut().unwrap();
        for (register, &value) in frame
            .carried(liveness.live_in(target))
            .zip(&junction.values)
        {
            frame.set(register, value);
        }
        self.needs_invalidation_point = junction.follows_effect || is_reached_again;
        junction.is_entered = true;
        let checkpoint = junction.checkpoint.filter(|_| frame.is_reducible);
        self.checkpoint = checkpoint.unwrap_or(State::NONE);
        frame.junctions[target.index()] = junction;
        self.block = block;
        true
    }

    fn add_loop_params(&mut self, junction: &mut Junction, header: BlockIndex) {
        let frame = self.frames.last_mut().unwrap();
        let block = junction.block.unwrap();
        let assigned = frame.enter_loop(header);
        for (position, register) in frame.carried(frame.liveness.live_in(header)).enumerate() {
            let old = junction.values[position];
            if assigned.contains(register) && self.graph.function.block_of(old) != block {
                let param = self.graph.function.add_param(block, Type::I64);
                junction
                    .edges
                    .iter()
                    .for_each(|&edge| self.graph.function.push_arg(edge, old));
                let prediction = self.graph.prediction(old);
                self.graph.predict(param, prediction);
                junction.params.push(position as u32);
                junction.values[position] = param;
            }
        }
    }
}

pub(super) struct Assigned {
    lowest: i32,
    is_assigned: Vec<bool>,
}

impl Assigned {
    fn contains(&self, register: Register) -> bool {
        self.is_assigned[(register.offset() - self.lowest) as usize]
    }
}

impl super::frame::Frame {
    /// Whether each cycle among the blocks has one way in, which it marks.
    fn find_cycles(&mut self, order: &[BlockIndex]) -> bool {
        let graph = self.liveness.graph();
        let mut positions = vec![usize::MAX; graph.len()];
        (order.iter().enumerate())
            .for_each(|(position, block)| positions[block.index()] = position);
        let predecessors = |position: usize| {
            let edges = graph.predecessors(order[position]).iter();
            edges
                .map(|edge| positions[edge.block.index()])
                .filter(|&it| it != usize::MAX)
        };
        // The innermost loops first, each of which then counts as its header.
        let mut headers: Vec<usize> = (0..order.len()).collect();
        let mut pending = Vec::new();
        for header in (0..order.len()).rev() {
            pending.extend(predecessors(header).filter(|&it| it >= header));
            self.junctions[order[header].index()].heads_cycle = !pending.is_empty();
            while let Some(mut member) = pending.pop() {
                while headers[member] != member {
                    headers[member] = headers[headers[member]];
                    member = headers[member];
                }
                if member < header {
                    return false;
                }
                if member != header {
                    headers[member] = header;
                    pending.extend(predecessors(member));
                }
            }
        }
        true
    }

    /// Gives what the blocks write from which `header` is reached without going through code that has been translated.
    fn enter_loop(&mut self, header: BlockIndex) -> Assigned {
        let (graph, body) = (self.liveness.graph(), self.code_block.body());
        let lowest = -(body.locals() as i32);
        let highest = self.argument_registers().last().map_or(0, Register::offset);
        let mut assigned = Assigned {
            lowest,
            is_assigned: vec![!self.is_reducible; (highest - lowest + 1) as usize],
        };
        if !self.is_reducible {
            return assigned;
        }
        let mut is_seen = vec![false; graph.len()];
        let mut pending = vec![header];
        is_seen[header.index()] = true;
        while let Some(block) = pending.pop() {
            for (_, instruction) in graph.instructions(body, block) {
                let stays = part_that_stays(&instruction);
                instruction.for_each_def(body, |run, _| {
                    for register in run.registers().filter(|&it| Some(it) != stays) {
                        assigned.is_assigned[(register.offset() - lowest) as usize] = true;
                    }
                });
            }
            for edge in graph.predecessors(block) {
                if !self.junctions[edge.block.index()].is_done
                    && !core::mem::replace(&mut is_seen[edge.block.index()], true)
                {
                    self.junctions[edge.block.index()].header = Some(header);
                    pending.push(edge.block);
                }
            }
        }
        assigned
    }
}
