//! Origins, and the states to exit to.

use bun_engine_bytecode::{CodeFlags, FunctionKind, Register};
use bun_engine_codegen::ir::{Exit, Function, Op, Origin, State, Value as Ssa};
use bun_engine_vm::{CodeBlock, FunctionExecutable, Intrinsic};
use smallvec::SmallVec;

use super::Builder;
use super::frame::{ArgumentCount, Walk};
use crate::graph::{ARGUMENT_COUNT, ExitKind, Kind, Layout, NO_LAYOUT, Position, Shown, Site};

pub(super) fn shown_by(code_block: &CodeBlock) -> Shown {
    let function = code_block.executable().downcast::<FunctionExecutable>();
    if (code_block.body().flags()).intersects(CodeFlags::STRICT | CodeFlags::BUILTIN) {
        Shown::empty()
    } else if function.is_some_and(|it| it.info().kind() == FunctionKind::Normal) {
        Shown::all()
    } else {
        Shown::CALLEE
    }
}

impl Builder<'_> {
    pub(super) fn set_origin(&mut self, offset: u32) {
        let frame = self.frames.last_mut().unwrap();
        frame.offset = offset;
        let (position, has_handler) = (
            Position {
                frame: frame.index,
                offset,
            },
            frame.has_handler(),
        );
        let (own_handler, graph) = (frame.own_handler(), &self.graph);
        let (owner, site) = position.exit_site(&graph.frames, |it| graph.site(it).position);
        let owner = self.frames.iter().rfind(|it| it.index == owner);
        let exits = owner.expect("a caller").code_block.exits_at(site);
        let exits = self.with_made_up_exits(exits);
        self.origin = Origin(self.graph.sites.len() as u32);
        self.graph.sites.push(Site {
            position,
            exits,
            has_handler,
            own_handler,
            state_for_handler: State::NONE,
            intrinsic: Intrinsic::None,
        });
    }

    pub(super) fn begin_instruction(&mut self, offset: u32) {
        self.set_origin(offset);
        self.has_had_effect = false;
        if (!self.graph.function.params(self.block).is_empty() || self.frame().is_in_header())
            && self.graph.function.first(self.block).is_none()
            && self.block != self.graph.function.entries()[0].block
        {
            let state = self.state();
            self.insert_node(Kind::Checkpoint, &[], 0, state);
        }
        if core::mem::take(&mut self.needs_invalidation_point) {
            let state = self.state();
            self.insert_node(Kind::InvalidationPoint, &[], 0, state);
        }
        self.verify_some_of_what_is_known();
    }

    pub(super) fn has_exited(&self, kind: ExitKind) -> bool {
        self.graph.has_exited(self.origin, kind)
    }

    /// Adds a layout for the innermost frame and leaves the values, with those of the callers, in `scratch`.
    fn describe_registers(&mut self, locals: impl Iterator<Item = Register>) -> u32 {
        let first_register = self.graph.layout_registers.len() as u32;
        let frame = self.frames.last().unwrap();
        self.scratch.clone_from(&frame.caller_values);
        if let ArgumentCount::Known(count) = frame.argument_count {
            self.graph
                .layout_registers
                .extend([Register::CALLEE, ARGUMENT_COUNT]);
            self.scratch.extend([
                self.graph.root(frame.get(Register::CALLEE)),
                self.graph.function.const64(count.into()),
            ]);
        }
        for register in (frame.arguments_elsewhere(&self.graph.function)).chain(locals) {
            self.graph.layout_registers.push(register);
            self.scratch.push(self.graph.root(frame.get(register)));
        }
        self.graph.layouts.push(Layout {
            resume: self.origin,
            caller: frame.caller_layout,
            first_register,
            register_count: self.graph.layout_registers.len() as u32 - first_register,
        });
        self.graph.layouts.len() as u32 - 1
    }

    /// From where all that has been translated since can be done again.
    pub(super) fn state(&mut self) -> State {
        debug_assert!(!self.has_had_effect, "there is no way back from here");
        if self.checkpoint.is_none() {
            self.checkpoint = self.describe_start_of_instruction();
        }
        self.checkpoint
    }

    fn describe_start_of_instruction(&mut self) -> State {
        let locals: SmallVec<[Register; 32]> = self.frame().live_locals().collect();
        let layout = self.describe_registers(locals.into_iter());
        (self.graph.function).add_described_state(self.scratch.iter().copied(), layout)
    }

    /// For what may throw.
    pub(super) fn state_for_unwinding(&mut self) -> State {
        if !self.frame().has_handler() {
            return self.state_for_walks(self.origin);
        }
        let (frame, graph) = (self.frame(), &self.graph);
        let (handler, needed) = (frame.own_handler(), frame.locals_for_handler());
        if let Some((_, state)) = frame.state_for_handler.filter(|it| it.0 == handler) {
            let layout = graph.layouts[graph.function.state_layout(state) as usize];
            let registers = &graph.layout_registers[layout.first_register as usize..];
            let held = &graph.function.state(state)[frame.caller_values.len()..];
            let then = registers.iter().copied().zip(held.iter().copied());
            let elsewhere = frame.arguments_elsewhere(&graph.function);
            let now =
                (elsewhere.chain(needed.iter().copied())).map(|it| (it, graph.root(frame.get(it))));
            if now.eq(then.skip(if frame.is_root() { 0 } else { 2 })) {
                return state;
            }
        }
        let layout = self.describe_registers(needed.into_iter());
        let state = (self.graph.function).add_described_state(self.scratch.iter().copied(), layout);
        self.frame_mut().state_for_handler = Some((handler, state));
        state
    }

    /// What those who walk the stack may ask of the innermost frame, which is at `origin`, and of its callers.
    pub(super) fn state_for_walks(&mut self, origin: Origin) -> State {
        let (frame, callers) = self.frames.split_last_mut().unwrap();
        let graph = &mut self.graph;
        let mut own: SmallVec<[(Register, Ssa); 8]> = SmallVec::new();
        if let ArgumentCount::Known(count) = frame.argument_count {
            own.push((Register::CALLEE, graph.root(frame.get(Register::CALLEE))));
            own.push((ARGUMENT_COUNT, graph.function.const64(count.into())));
        }
        if (graph.frames[frame.index.index()].shows).contains(Shown::ARGUMENTS) {
            let arguments = frame.argument_registers().skip(1);
            let elsewhere = arguments.filter(|&it| !frame.is_in_place(it));
            own.extend(elsewhere.map(|it| (it, graph.root(frame.get(it)))));
        }
        if own == frame.walk.own {
            return frame.walk.state;
        }
        let state = if own.is_empty() {
            State::NONE
        } else {
            let caller = callers.last().and_then(|it| it.walk.state.expand());
            graph.layouts.push(Layout {
                resume: origin,
                caller: caller.map_or(NO_LAYOUT, |it| graph.function.state_layout(it)),
                first_register: graph.layout_registers.len() as u32,
                register_count: own.len() as u32,
            });
            (graph.layout_registers).extend(own.iter().map(|it| it.0));
            self.scratch.clear();
            let of_callers = callers.iter().flat_map(|it| &it.walk.own);
            (self.scratch).extend(of_callers.chain(&own).map(|it| it.1));
            let layout = graph.layouts.len() as u32 - 1;
            (graph.function).add_described_state(self.scratch.iter().copied(), layout)
        };
        frame.walk = Walk { own, state };
        state
    }

    /// For a function that is about to be inlined by an instruction that writes `result`. The values are left in
    /// `scratch`.
    pub(super) fn describe_waiting_caller(&mut self, result: Option<Register>) -> u32 {
        let frame = self.frame();
        let before_this = frame.live_before.len() - frame.words;
        let mut live: SmallVec<[u64; 4]> = if before_this == 0 {
            frame.live_at_end().collect()
        } else {
            frame.live_before[before_this - frame.words..before_this].into()
        };
        if let Some(index) = result.and_then(Register::local_index) {
            live[index as usize / 64] &= !(1 << (index % 64));
        }
        if let Some(handler) = frame.liveness.graph().handler(frame.current) {
            live.iter_mut()
                .zip(frame.liveness.live_in(handler).words())
                .for_each(|(live, &more)| *live |= more);
        }
        let locals = (0..live.len() as u32 * 64)
            .filter(move |&index| live[index as usize / 64] >> (index % 64) & 1 != 0);
        self.describe_registers(locals.map(Register::local))
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn exit(&mut self, kind: ExitKind) -> Exit {
        let state = self.state();
        self.graph.exit(kind, self.origin, state)
    }

    /// Than to the start of this instruction.
    pub(super) fn go_back_no_further(&mut self) {
        if !self.checkpoint.is_none() && self.graph.resumes_at(self.checkpoint) != self.origin {
            self.checkpoint = State::NONE;
        }
    }

    /// Whether going back from here means making the object again, so that what has been done to it does not count.
    pub(super) fn is_provisional(&self, object: Ssa) -> bool {
        let (graph, object) = (&self.graph, self.graph.root(object));
        !self.checkpoint.is_none()
            && graph.kind(object).is_some_and(Kind::allocates)
            && graph.makes_again(self.checkpoint, object)
    }

    pub(super) fn note_effect_on(&mut self, object: Ssa) {
        if !self.is_provisional(object) {
            self.note_effect();
        }
    }

    pub(super) fn note_effect(&mut self) {
        self.checkpoint = State::NONE;
        self.has_had_effect = true;
        self.effects += 1;
    }
}

impl super::frame::Frame {
    /// The slot of one that is assigned to may be overwritten while a state is in use.
    fn arguments_elsewhere(&self, function: &Function) -> impl Iterator<Item = Register> {
        let stays = |it| self.is_in_place(it) && matches!(function.op(self.get(it)), Op::Param(_));
        self.argument_registers().filter(move |&it| !stays(it))
    }

    /// They are not all live before an instruction that never gets there.
    fn locals_for_handler(&self) -> SmallVec<[Register; 8]> {
        let needed = self.own_handler().map(|it| self.liveness.live_in(it));
        let is_needed = |&register: &Register| needed.is_some_and(|it| it.contains(register));
        self.live_locals().filter(is_needed).collect()
    }

    fn live_at_end(&self) -> impl Iterator<Item = u64> {
        let successors = self.liveness.graph().successors(self.current);
        (0..self.words).map(move |word| {
            successors.iter().fold(0, |live, edge| {
                live | self.liveness.live_in(edge.block).words()[word]
            })
        })
    }
}
