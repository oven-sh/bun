//! Blocks, and the edges between them.

use core::ops::Range;

use bun_engine_asm::Cond;
use bun_engine_codegen::ir::{
    Action, Block, Edge, EffectFlags, Effects, Op, PatchpointData, Successor, Value,
};
use bun_engine_wasm_format::{
    BlockType, BrTable, Catches, Flow, FuncIndex, FunctionBody, LoopEffects, RefType, TableIndex,
    TagIndex, TypeIndex, ValType, VisitControl,
};
use smallvec::SmallVec;

use super::calls::CallKind;
use super::casts::Test;
use super::emit::Sites;
use super::locals::{OpenLoop, Snapshot, common_type};
use super::translator::{NONE, Operand, Stop, Translator, Visited, ir_type};
use crate::abi::Trap;
use crate::clauses::Scope;

/// How control leaves a block for a place that has no code yet.
#[derive(Clone, Copy)]
pub(super) enum Way {
    /// The block lacks its last instruction.
    EndOf(Block),
    /// The edge lacks its target.
    Edge(Edge),
}

#[derive(Clone, Copy)]
pub(super) struct Arrival {
    way: Way,
    from: Snapshot,
    first_carried: u32,
    next: u32,
}

/// The arrivals at a place, the earliest first.
#[derive(Clone, Copy)]
pub(super) struct Target {
    first: u32,
    last: u32,
}

impl Target {
    pub(super) const UNREACHED: Self = Self {
        first: NONE,
        last: NONE,
    };

    #[inline]
    pub(super) fn is_reached(self) -> bool {
        self.first != NONE
    }
}

#[derive(Clone, Copy)]
pub(super) struct Header {
    block: Block,
    locals: OpenLoop,
}

#[derive(Clone)]
pub(super) enum Kind {
    Block,
    /// Until `else`.
    If,
    Loop {
        header: Header,
        index: u32,
        outer: (Block, u32),
    },
    /// The code is entered inside the loop, so it has the rest of that turn and then the whole loop.
    FirstTurn {
        index: u32,
        /// The number of loops around it.
        depth: u32,
    },
    /// Until the first `catch`.
    Try,
    Catch {
        exception: Value,
    },
    TryTable {
        catches: Range<u32>,
    },
    Body {
        /// For tail calls that start the function over.
        header: Option<Header>,
        caller: Snapshot,
    },
}

pub(super) struct Control {
    pub(super) kind: Kind,
    pub(super) ty: BlockType,
    /// Of the operand stack, without the parameters.
    pub(super) height: u32,
    /// The position of the block that catches what is thrown directly in this one, or `NONE`.
    pub(super) handler: u32,
    /// Of a block that catches.
    pub(super) scope: Scope,
    pub(super) label: Target,
    /// The `else` of an `if`, the next clause of a `try`, the end of a loop, the start of a body.
    pub(super) other: Target,
    /// From calls that an exception ends.
    pub(super) landing: Target,
    /// With an `exnref`.
    pub(super) thrown: Target,
    /// While a `br_table` is translated.
    case: Block,
}

impl Control {
    pub(super) fn forget_arrivals(&mut self) {
        [self.label, self.other, self.landing, self.thrown] = [Target::UNREACHED; 4];
    }
}

impl<'a> Translator<'a> {
    #[inline]
    pub(super) fn innermost(&mut self) -> &mut Control {
        self.controls.last_mut().expect("the body is open")
    }

    #[inline]
    pub(super) fn handler(&self) -> u32 {
        self.controls.last().map_or(NONE, |control| control.handler)
    }

    pub(super) fn position_of(&self, label: u32) -> usize {
        self.controls.len() - 1 - label as usize
    }

    #[inline]
    pub(super) fn open(&mut self, kind: Kind, ty: BlockType) -> &mut Control {
        let params = self.types.block_type(&ty).params.len();
        self.controls.push(Control {
            kind,
            ty,
            height: (self.stack.len() - params) as u32,
            handler: self.handler(),
            scope: Scope::NONE,
            label: Target::UNREACHED,
            other: Target::UNREACHED,
            landing: Target::UNREACHED,
            thrown: Target::UNREACHED,
            case: Block::NONE,
        });
        self.innermost()
    }

    /// With the `count` values on top of the stack, which stay there.
    pub(super) fn arrive(&mut self, mut target: Target, way: Way, count: usize) -> Target {
        let id = self.arrivals.len() as u32;
        self.arrivals.push(Arrival {
            way,
            from: self.locals.snapshot(),
            first_carried: self.carried.len() as u32,
            next: NONE,
        });
        (self.carried).extend_from_slice(&self.stack[self.stack.len() - count..]);
        match self.arrivals.get_mut(target.last as usize) {
            Some(last) => last.next = id,
            None => target.first = id,
        }
        target.last = id;
        target
    }

    /// `earlier` has the earlier arrivals.
    fn chain(&mut self, earlier: Target, later: Target) -> Target {
        if !earlier.is_reached() || !later.is_reached() {
            return if earlier.is_reached() { earlier } else { later };
        }
        self.arrivals[earlier.last as usize].next = later.first;
        Target {
            first: earlier.first,
            last: later.last,
        }
    }

    pub(super) fn here(&self) -> Way {
        Way::EndOf(self.b.block())
    }

    fn lead(&mut self, way: Way, target: Block, args: &[Value]) -> Edge {
        match way {
            Way::EndOf(block) => {
                self.b.switch_to(block);
                self.b.jump(target, args);
                self.b.successor(block, 0)
            }
            Way::Edge(edge) => {
                self.b.redirect(edge, target, args);
                edge
            }
        }
    }

    fn follow(&mut self, way: Way) {
        let block = match way {
            Way::EndOf(block) => block,
            Way::Edge(edge) => {
                let block = self.b.new_block();
                self.b.redirect(edge, block, &[]);
                block
            }
        };
        self.switch_to(block);
    }

    /// Goes on at the target, and pushes the values that arrive there.
    pub(super) fn meet(&mut self, target: Target, types: &[ValType]) {
        self.is_live = target.is_reached();
        if !self.is_live {
            return;
        }
        let first = self.arrivals[target.first as usize];
        let carried = first.first_carried as usize..first.first_carried as usize + types.len();
        let base = self.stack.len();
        self.stack.extend_from_slice(&self.carried[carried]);
        if target.first == target.last {
            self.locals.restore(first.from);
            return self.follow(first.way);
        }

        let block = self.b.new_block();
        self.meeting.clear();
        let mut id = target.first;
        while let Some(&arrival) = self.arrivals.get(id as usize) {
            let edge = self.lead(arrival.way, block, &[]);
            self.meeting.push((edge, arrival.from));
            id = arrival.next;
        }
        for (position, &bound) in types.iter().enumerate() {
            let next = |arrival: &&Arrival| self.arrivals.get(arrival.next as usize);
            let operands = || {
                core::iter::successors(Some(&first), next)
                    .map(|arrival| self.carried[arrival.first_carried as usize + position])
            };
            let merged = &mut self.stack[base + position];
            let mut differ = false;
            for operand in operands() {
                differ |= operand.value != merged.value;
                merged.ty = common_type(self.types, merged.ty, operand.ty, bound);
            }
            if differ {
                merged.value = self.b.add_param(block, ir_type(bound));
                for (operand, &(edge, _)) in operands().zip(&self.meeting) {
                    self.b.push_arg(edge, operand.value);
                }
            }
        }
        // A merged value is no longer what one arrival read from its local.
        for operand in &mut self.stack[base..] {
            operand.local = NONE;
        }
        self.locals.join(block, &self.meeting);
        self.switch_to(block);
    }

    /// Takes the results of the innermost block to its end, and leaves the stack as it is below the block.
    pub(super) fn fall_to_end(&mut self) {
        let Control {
            ty, label, height, ..
        } = *self.innermost();
        if self.is_live {
            let count = self.types.block_type(&ty).results.len();
            self.innermost().label = self.arrive(label, self.here(), count);
        }
        self.stack.truncate(height as usize);
    }

    /// Goes on after the innermost block, which is not a loop.
    pub(super) fn close(&mut self) {
        if self.innermost().label.is_reached() {
            self.fall_to_end();
            let Control { ty, label, .. } = *self.innermost();
            self.meet(label, self.types.block_type(&ty).results);
        }
        self.controls.pop();
    }

    fn top_values(&self, count: usize) -> SmallVec<[Value; 4]> {
        let operands = &self.stack[self.stack.len() - count..];
        operands.iter().map(|operand| operand.value).collect()
    }

    /// The values that the label takes are on top of the stack. Leaves the builder anywhere.
    pub(super) fn branch_to(&mut self, position: usize, way: Way) {
        let control = &self.controls[position];
        let (ty, label) = (control.ty, control.label);
        let ty = self.types.block_type(&ty);
        let label = match control.kind {
            Kind::Loop { header, .. } => {
                let args = self.top_values(ty.params.len());
                let edge = self.lead(way, header.block, &args);
                self.arrive(label, Way::Edge(edge), 0)
            }
            Kind::FirstTurn { .. } => self.arrive(label, way, ty.params.len()),
            Kind::Body { .. } if self.activation.owns_frame => {
                let results = self.top_values(ty.results.len());
                self.follow(way);
                return self.b.ret(&results);
            }
            _ => self.arrive(label, way, ty.results.len()),
        };
        self.controls[position].label = label;
    }

    pub(super) fn jump_to(&mut self, position: usize) {
        self.branch_to(position, self.here());
        self.is_live = false;
    }

    pub(super) fn return_from_body(&mut self) {
        self.jump_to(self.inlining[self.activation.node].body as usize);
    }

    /// `unused_comparison` says that the operand which was just popped held it alone, and being the last instruction
    /// says that nothing after it reads it.
    fn inverted(&mut self, condition: Value) -> Value {
        if condition == self.unused_comparison && condition == self.b.last(self.b.block()) {
            debug_assert!(!self.stack.iter().any(|operand| operand.value == condition));
            match self.b.op_mut(condition) {
                Op::Compare(cond, _) => *cond = cond.inverted(),
                Op::FloatCompare(cond, _) => *cond = cond.inverted(),
                _ => unreachable!("not a comparison"),
            }
            return condition;
        }
        match *self.b.op(condition) {
            Op::Compare(Cond::Eq, [value, zero]) if self.b.is_int_constant(zero, 0) => value,
            _ => self.b.is_zero(condition),
        }
    }

    #[inline]
    fn learn(&mut self, test: Option<Test>, holds: bool) {
        if let Some(test) = test {
            self.refine(test.outcome(holds));
        }
    }

    /// Whether the condition of this instruction is likely to hold.
    fn hint(&self) -> Option<bool> {
        let hints = self.activation.hints;
        let position = hints.binary_search_by_key(&self.offset, |hint| hint.offset);
        position.ok().map(|position| hints[position].likely)
    }

    /// Goes on where `condition` holds. Returns the other edge.
    pub(super) fn fork(&mut self, condition: Value, is_likely: Option<bool>) -> Edge {
        let (block, next) = (self.b.block(), self.b.new_block());
        let successor = |target: Block, is_rare: bool| Successor {
            is_rare,
            ..target.into()
        };
        let then = successor(next, is_likely == Some(false));
        let or = successor(Block::NONE, is_likely == Some(true));
        self.b.branch_both_ways(condition, then, or);
        self.b.switch_to(next);
        self.unused_comparison = Value::NONE;
        self.b.successor(block, 1)
    }

    /// The code that follows comes first among the successors, and so in the layout.
    pub(super) fn branch_unless(
        &mut self,
        condition: Value,
        position: usize,
        is_likely: Option<bool>,
    ) {
        match self.b.int_constant(condition) {
            Some(0) => self.jump_to(position),
            Some(_) => {}
            None => {
                let edge = self.fork(condition, is_likely);
                let (next, fresh_object) = (self.b.block(), self.fresh_object);
                self.branch_to(position, Way::Edge(edge));
                self.b.switch_to(next);
                self.fresh_object = fresh_object;
            }
        }
    }

    // Loops

    /// The parameters of the loop, which have the `types`, are on top of the stack.
    fn open_header(
        &mut self,
        types: &[ValType],
        assigned: impl FnOnce(&LoopEffects) -> &[u32],
        also_assigned: Range<u32>,
    ) -> Header {
        let (before, block) = (self.b.block(), self.b.new_block());
        let args = self.top_values(types.len());
        self.b.jump(block, &args);
        let first = self.stack.len() - types.len();
        for (operand, &ty) in self.stack[first..].iter_mut().zip(types) {
            *operand = Operand::new(self.b.add_param(block, ir_type(ty)), ty);
        }
        let assigned = assigned(&self.loops[self.activation.depth]);
        let assigned = (assigned.iter().copied().chain(also_assigned))
            .map(|local| self.activation.first_local + local);
        let entry_edge = self.b.successor(before, 0);
        let locals = self.locals.open_loop(block, entry_edge, assigned);
        self.switch_to(block);
        Header { block, locals }
    }

    fn close_header(&mut self, header: Header, back: Target) {
        self.meeting.clear();
        let mut id = back.first;
        while let Some(arrival) = self.arrivals.get(id as usize) {
            let Way::Edge(edge) = arrival.way else {
                unreachable!("the target is known")
            };
            self.meeting.push((edge, arrival.from));
            id = arrival.next;
        }
        (self.locals).close_loop(self.b.function, self.types, header.locals, &self.meeting);
    }

    fn start_loop(&mut self, ty: BlockType, index: u32) -> Kind {
        let params = self.types.block_type(&ty).params;
        let node = self.inlining[self.activation.node];
        let turns = self.feedback.loop_turns(node.code, index);
        self.note_count(turns);
        let header = self.open_header(params, |loops| loops.assigned_locals(index), 0..0);
        if turns >= node.entries {
            self.rarity.note_busy(header.block);
        }
        let inner = (header.block, turns);
        Kind::Loop {
            header,
            index,
            outer: core::mem::replace(&mut self.activation.innermost_loop, inner),
        }
    }

    fn end_loop(&mut self, header: Header, outer: (Block, u32)) {
        self.activation.innermost_loop = outer;
        self.open_loops -= u32::from(self.is_seeking);
        let control = self.innermost();
        let back = core::mem::replace(&mut control.label, control.other);
        self.close_header(header, back);
        self.close();
    }

    fn end_first_turn(&mut self, index: u32, depth: u32) -> Visited {
        let again = core::mem::replace(&mut self.innermost().label, Target::UNREACHED);
        if !again.is_reached() {
            self.controls.pop();
            return Ok(());
        }
        self.fall_to_end();
        let control = self.innermost();
        control.other = core::mem::replace(&mut control.label, Target::UNREACHED);
        let ty = control.ty;
        self.meet(again, self.types.block_type(&ty).params);
        self.innermost().kind = self.start_loop(ty, index);
        Err(Stop::LoopRepeats(depth))
    }

    // Bodies

    /// The activation is that of the body.
    pub(super) fn enter_body(&mut self, body: &FunctionBody<'a>, args: &[Operand]) {
        let depth = self.activation.depth;
        if self.loops.len() <= depth {
            self.loops.resize_with(depth + 1, LoopEffects::default);
        }
        self.loops[depth].scan(body);
        let caller = self.locals.snapshot();
        for (arg, &ty) in args.iter().zip(body.func_type().params) {
            self.locals.declare(1, ty, arg.typed());
        }
        for (count, ty) in body.local_groups() {
            let initial = self.default_value(ty);
            self.locals.declare(count, ty, initial);
        }
        let node = &mut self.inlining[self.activation.node];
        (node.body, node.first_local) = (self.controls.len() as u32, self.activation.first_local);
        let header = node.repeats.then_some(0..args.len() as u32);
        let header = header.map(|params| self.open_header(&[], |_| &[], params));
        let (height, handler) = (self.stack.len() as u32, self.activation.outer_handler);
        let control = self.open(Kind::Body { header, caller }, BlockType::Empty);
        control.ty = BlockType::Func(body.type_index());
        (control.height, control.handler) = (height, handler);
    }

    fn poll(&mut self) {
        let effects = Effects::with_flags(EffectFlags::KEPT | EffectFlags::CONTROL_DEPENDENT);
        let data = PatchpointData::new(Action::Custom, Sites::POLL, effects);
        self.b.patchpoint(&data, &[], &[]);
    }

    /// `first_local` is that of the body at the position.
    pub(super) fn start_over(&mut self, position: usize, first_local: u32, args: &[Operand]) {
        self.poll();
        let Control {
            kind:
                Kind::Body {
                    header: Some(header),
                    ..
                },
            other: back,
            ..
        } = self.controls[position]
        else {
            unreachable!("the body repeats")
        };
        for (local, arg) in (first_local..).zip(args) {
            self.locals.set(local, arg.typed());
        }
        let edge = self.lead(self.here(), header.block, &[]);
        self.controls[position].other = self.arrive(back, Way::Edge(edge), 0);
        self.is_live = false;
    }

    fn end_body(&mut self, header: Option<Header>, caller: Snapshot) {
        if self.is_live && self.activation.owns_frame {
            self.return_from_body();
        }
        if let Some(header) = header {
            let back = self.innermost().other;
            self.close_header(header, back);
        }
        self.fall_to_end();
        self.locals.restore(caller);
        self.locals.truncate(self.activation.first_local);
        let Control {
            ty, label, height, ..
        } = self.controls.pop().expect("the body is open");
        self.meet(label, self.types.block_type(&ty).results);
        for operand in &mut self.stack[height as usize..] {
            operand.local = NONE;
        }
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitControl for Translator<'_> {
    fn unreachable(&mut self) -> Visited {
        self.trap(Trap::Unreachable);
        Ok(())
    }

    fn nop(&mut self) -> Visited {
        Ok(())
    }

    #[inline]
    fn block(&mut self, ty: BlockType) -> Visited {
        self.open(Kind::Block, ty);
        Ok(())
    }

    fn loop_(&mut self, ty: BlockType, index: u32) -> Visited {
        self.check_complexity()?;
        if self.is_seeking {
            self.seek_loop(ty, index);
        }
        let kind = self.start_loop(ty, index);
        self.open(kind, ty);
        if self.is_seeking {
            return Err(Stop::LoopStarts);
        }
        Ok(())
    }

    fn if_(&mut self, ty: BlockType) -> Visited {
        let condition = self.pop_value();
        let params = self.types.block_type(&ty).params.len();
        let otherwise = match self.b.int_constant(condition) {
            Some(0) => {
                self.is_live = false;
                self.arrive(Target::UNREACHED, self.here(), params)
            }
            Some(_) => Target::UNREACHED,
            None => {
                let test = self.test_behind(condition);
                let edge = self.fork(condition, self.hint());
                let otherwise = self.refine_for(test.map(|it| it.outcome(false)), |this| {
                    this.arrive(Target::UNREACHED, Way::Edge(edge), params)
                });
                self.learn(test, true);
                otherwise
            }
        };
        self.open(Kind::If, ty).other = otherwise;
        Ok(())
    }

    fn else_(&mut self, _: Flow) -> Visited {
        self.check_complexity()?;
        self.fall_to_end();
        let control = self.innermost();
        control.kind = Kind::Block;
        let Control { ty, other, .. } = *control;
        self.meet(other, self.types.block_type(&ty).params);
        Ok(())
    }

    fn end(&mut self, _: Flow) -> Visited {
        self.check_complexity()?;
        match self.innermost().kind.clone() {
            Kind::Block => self.close(),
            Kind::If => {
                let Control { other, label, .. } = *self.innermost();
                self.innermost().label = self.chain(other, label);
                self.close();
            }
            Kind::Loop { header, outer, .. } => self.end_loop(header, outer),
            Kind::FirstTurn { index, depth } => self.end_first_turn(index, depth)?,
            Kind::Try => self.end_try(self.controls.len() - 2),
            Kind::Catch { exception } => self.end_catch(exception),
            Kind::TryTable { catches } => self.end_try_table(catches)?,
            Kind::Body { header, caller } => self.end_body(header, caller),
        }
        Ok(())
    }

    fn br(&mut self, label: u32) -> Visited {
        self.jump_to(self.position_of(label));
        Ok(())
    }

    fn br_if(&mut self, label: u32) -> Visited {
        let condition = self.pop_value();
        let test = self.test_behind(condition);
        let inverted = self.inverted(condition);
        let is_likely = self.hint().map(|is_likely| !is_likely);
        self.refine_for(test.map(|it| it.outcome(true)), |this| {
            this.branch_unless(inverted, this.position_of(label), is_likely);
        });
        self.learn(test, false);
        Ok(())
    }

    fn br_table(&mut self, table: BrTable<'_>) -> Visited {
        let (index, default) = (self.pop_value(), table.default_label());
        if let Some(index) = self.b.constant_bits(index) {
            return self.br(table.labels().nth(index as usize).unwrap_or(default));
        }
        if table.labels().all(|label| label == default) {
            return self.br(default);
        }
        let mut case = |label: u32| {
            let position = self.controls.len() - 1 - label as usize;
            let case = &mut self.controls[position].case;
            if case.is_none() {
                *case = self.b.new_block();
            }
            Successor::from(*case)
        };
        self.cases.clear();
        for (key, label) in (0..).zip(table.labels()) {
            if label != default {
                self.cases.push((key, case(label)));
            }
        }
        let otherwise = case(default);
        self.b.switch(index, &self.cases, otherwise);
        for label in table.labels().chain([default]) {
            let position = self.position_of(label);
            let case = core::mem::replace(&mut self.controls[position].case, Block::NONE);
            if !case.is_none() {
                self.check_complexity()?;
                self.branch_to(position, Way::EndOf(case));
            }
        }
        self.is_live = false;
        Ok(())
    }

    fn br_on_null(&mut self, label: u32) -> Visited {
        self.branch_on_null(self.position_of(label));
        Ok(())
    }

    fn br_on_non_null(&mut self, label: u32) -> Visited {
        self.branch_on_non_null(self.position_of(label));
        Ok(())
    }

    fn br_on_cast(&mut self, label: u32, _: RefType, to: RefType) -> Visited {
        self.branch_on_cast(self.position_of(label), to, true);
        Ok(())
    }

    fn br_on_cast_fail(&mut self, label: u32, _: RefType, to: RefType) -> Visited {
        self.branch_on_cast(self.position_of(label), to, false);
        Ok(())
    }

    fn return_(&mut self) -> Visited {
        self.return_from_body();
        Ok(())
    }

    fn call(&mut self, func: FuncIndex, site: u32) -> Visited {
        self.call_function(func, site, CallKind::Plain)
    }

    fn call_indirect(&mut self, ty: TypeIndex, table: TableIndex, site: u32) -> Visited {
        self.call_element(ty, table, site, CallKind::Plain)
    }

    fn call_ref(&mut self, ty: TypeIndex, site: u32) -> Visited {
        self.call_reference(ty, site, CallKind::Plain)
    }

    fn return_call(&mut self, func: FuncIndex, site: u32) -> Visited {
        self.call_function(func, site, CallKind::Tail)
    }

    fn return_call_indirect(&mut self, ty: TypeIndex, table: TableIndex, site: u32) -> Visited {
        self.call_element(ty, table, site, CallKind::Tail)
    }

    fn return_call_ref(&mut self, ty: TypeIndex, site: u32) -> Visited {
        self.call_reference(ty, site, CallKind::Tail)
    }

    fn throw(&mut self, tag: TagIndex) -> Visited {
        self.throw_new(tag);
        Ok(())
    }

    fn throw_ref(&mut self) -> Visited {
        let exception = self.pop();
        self.check_not_null(exception, Trap::NullExnref);
        if self.is_live {
            self.throw_to(self.handler(), exception.value);
        }
        Ok(())
    }

    fn try_table(&mut self, ty: BlockType, catches: Catches<'_>) -> Visited {
        let first = self.catches.len() as u32;
        self.catches.extend(catches);
        let catches = first..self.catches.len() as u32;
        if catches.is_empty() {
            return self.block(ty);
        }
        self.open_try(Kind::TryTable { catches }, ty);
        Ok(())
    }

    fn try_(&mut self, ty: BlockType) -> Visited {
        self.open_try(Kind::Try, ty);
        Ok(())
    }

    fn catch(&mut self, tag: TagIndex, _: Flow) -> Visited {
        self.check_complexity()?;
        self.start_catch(Some(tag));
        Ok(())
    }

    fn catch_all(&mut self, _: Flow) -> Visited {
        self.check_complexity()?;
        self.start_catch(None);
        Ok(())
    }

    fn delegate(&mut self, label: u32, _: Flow) -> Visited {
        self.check_complexity()?;
        self.end_try(self.position_of(label + 1));
        Ok(())
    }

    fn rethrow(&mut self, label: u32) -> Visited {
        let Kind::Catch { exception } = self.controls[self.position_of(label)].kind else {
            unreachable!("the code was validated")
        };
        self.throw_to(self.handler(), exception);
        Ok(())
    }
}
