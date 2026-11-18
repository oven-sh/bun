//! Calls, and functions that are translated in place of a call.

use bun_engine_bytecode::{MetadataKind, Register};
use bun_engine_codegen::ir::{Origin, State, Value as Ssa};
use bun_engine_vm::code::metadata::{Call, SuperConstruct};
use bun_engine_vm::{CodeBlock, Executable, FunctionExecutable, Gc, SpeculatedType as T};
use smallvec::SmallVec;

use super::frame::{ArgumentCount, Frame, Junction};
use super::{Builder, Built};
use crate::graph::{CallKind, ExitKind, Kind, Profile};

#[derive(Clone, Copy)]
pub(super) struct CallSite<'a> {
    pub(super) kind: CallKind,
    /// `None` for a setter.
    pub(super) dst: Option<Register>,
    pub(super) callee: Ssa,
    /// `this` or `new.target`, and the arguments.
    pub(super) arguments: &'a [Ssa],
    /// Starts with the profile of the result.
    pub(super) metadata: u32,
}

impl Builder<'_> {
    pub(super) fn outgoing_arguments(
        &self,
        this: Ssa,
        frame: u32,
        count: u32,
    ) -> SmallVec<[Ssa; 8]> {
        let arguments =
            (0..count - 1).map(|index| self.frame().get(Register::outgoing_argument(frame, index)));
        core::iter::once(this).chain(arguments).collect()
    }

    pub(super) fn call(&mut self, mut site: CallSite<'_>, kind: MetadataKind) -> Built {
        let code_block = self.frame().code_block;
        let code_block = code_block.anchor();
        let profile = match kind {
            MetadataKind::Call => {
                &code_block
                    .checked_metadata::<Call>(kind, site.metadata)
                    .profile
            }
            _ => {
                let entry = code_block.checked_metadata::<SuperConstruct>(kind, site.metadata);
                &entry.call.profile
            }
        };
        if !profile.has_run() && !self.has_exited(ExitKind::NeverExecuted) {
            self.force_exit(ExitKind::NeverExecuted);
            return Ok(());
        }
        if let Some((dst, made)) = site.dst.zip(self.construct_in_place(&site)) {
            self.set(dst, made);
            return Ok(());
        }
        let result = if let Some(methods) = self.methods_to_tell_apart(&site) {
            self.call_method(&site, &methods)?
        } else {
            let executable = (self.proven_executable(site.callee))
                .or_else(|| self.only_executable(&mut site.callee, profile));
            match executable {
                Some(_) => self.call_executable(&site, executable)?,
                None => self.call_one_of_several(&site, profile)?,
            }
        };
        if let Some((dst, result)) = site.dst.zip(result) {
            self.set(dst, result);
        }
        Ok(())
    }

    /// `executable` is that of the callee, if it is known. Gives nothing if control does not go on.
    pub(super) fn call_executable(
        &mut self,
        site: &CallSite<'_>,
        executable: Option<Gc<Executable>>,
    ) -> Built<Option<Ssa>> {
        if let Some(result) = executable.and_then(|it| self.intrinsic(it, site)) {
            return Ok(Some(result));
        }
        let script = executable.and_then(Gc::downcast::<FunctionExecutable>);
        if let Some(target) = script.and_then(|script| self.inlinable_code(script, site)) {
            return self.inline(site, target);
        }
        if let Some((callee, arguments)) = self.unbind(site) {
            let (executable, arguments) = (self.proven_executable(callee), &arguments);
            let site = CallSite {
                callee,
                arguments,
                ..*site
            };
            return self.call_executable(&site, executable);
        }
        if let Some(result) = self.call_wasm(site) {
            return Ok(Some(result));
        }
        Ok(self.call_as_usual(site, executable))
    }

    pub(super) fn call_as_usual(
        &mut self,
        site: &CallSite<'_>,
        executable: Option<Gc<Executable>>,
    ) -> Option<Ssa> {
        let mut operands: SmallVec<[Ssa; 12]> = SmallVec::new();
        let kinds = if let Some(native) = self.native_function(site) {
            operands.extend(native);
            [
                Kind::NativeCall,
                Kind::NativeConstruct,
                Kind::NativeTailCall,
            ]
        } else if let Some(executable) = executable {
            operands.push(self.cell(executable.cell()));
            [
                Kind::DirectCall,
                Kind::DirectConstruct,
                Kind::DirectTailCall,
            ]
        } else {
            [Kind::Call, Kind::Construct, Kind::TailCall]
        };
        let rest = core::iter::once(&site.callee).chain(site.arguments);
        operands.extend(rest.map(|&operand| self.graph.root(operand)));
        let result = self.make_call(site, executable.is_some(), kinds, &operands, 0);
        let is_script = executable.is_some_and(|it| it.is::<FunctionExecutable>());
        if let Some(object) = result.filter(|_| is_script && site.kind == CallKind::Construct) {
            self.graph.declare(object, T::OBJECT);
        }
        result
    }

    /// With the kind for a call, for `new` or for a tail call.
    pub(super) fn make_call(
        &mut self,
        site: &CallSite<'_>,
        is_callable: bool,
        [call, construct, tail_call]: [Kind; 3],
        operands: &[Ssa],
        data: u32,
    ) -> Option<Ssa> {
        let is_tail_call = site.kind == CallKind::TailCall;
        if self.leaves_for_good(site) {
            self.node(tail_call, operands, data);
            self.end_block();
            return None;
        }
        let returns_to = self.returns_to(site);
        let prediction = match returns_to {
            Some((position, metadata)) if is_tail_call => {
                let seen = self.frames[position].code_block.prediction(metadata).get();
                if seen.is_empty() { T::HEAP_TOP } else { seen }
            }
            Some(_) => self.prediction_or_exit(site.metadata)?,
            None => T::HEAP_TOP,
        };
        let kind = if site.kind == CallKind::Construct {
            construct
        } else {
            call
        };
        let make = |this: &mut Self, replaces_frame| {
            let result = this.profiled_node(kind, operands, data, prediction);
            if replaces_frame {
                this.attribute_to_caller(result);
            }
            this.note_result_of(site, result);
            Some(result)
        };
        if !is_tail_call || is_callable {
            return make(self, is_tail_call);
        }
        if T::FUNCTION.contains(self.expected(site.callee)) && !self.has_exited(ExitKind::BadType) {
            self.check_type(site.callee, T::FUNCTION);
            return make(self, true);
        }
        // What cannot be called throws while the frame is still there.
        let (is_callable, mut fork) = (self.is_callable(site.callee), self.fork());
        let function = &mut self.graph.function;
        let (callable, other) = (function.new_block(), function.new_block());
        self.ir().branch(is_callable, callable, other.rare());
        for (block, replaces_frame) in [(callable, true), (other, false)] {
            self.take_way(&fork, block);
            let result = make(self, replaces_frame);
            self.end_way(&mut fork, result);
        }
        self.end_fork(&fork)
    }

    pub(super) fn returns_to(&self, site: &CallSite<'_>) -> Option<(usize, u32)> {
        if site.kind == CallKind::TailCall {
            self.frame().returns_to
        } else {
            site.dst.map(|_| (self.frames.len() - 1, site.metadata))
        }
    }

    /// Whether the call takes the place of the frame of the machine.
    pub(super) fn leaves_for_good(&self, site: &CallSite<'_>) -> bool {
        site.kind == CallKind::TailCall && self.frames.iter().all(|it| self.is_in_tail_position(it))
    }

    pub(super) fn note_result_of(&mut self, site: &CallSite<'_>, result: Ssa) {
        if let Some((position, metadata)) = self.returns_to(site) {
            let profile = Profile::Result(self.frames[position].index, metadata);
            self.graph.set_profile(result, profile);
        }
    }

    /// The frames that a tail call would have replaced are gone for those who walk the stack.
    pub(super) fn attribute_to_caller(&mut self, call: Ssa) {
        let position = (self.frames.iter()).rposition(|it| !self.is_in_tail_position(it));
        let position = position.expect("or the call would not return");
        let called = &self.frames[position];
        let origin = self.graph.frames[called.index.index()].caller;
        let state = if called.caller_has_handler {
            let values = called.caller_values.iter().copied();
            (self.graph.function).add_described_state(values, called.caller_layout)
        } else {
            self.frames[position - 1].walk.state
        };
        self.graph.function.set_state_of(call, state);
        self.graph.function.set_origin(call, origin);
    }

    fn is_in_tail_position(&self, frame: &Frame) -> bool {
        frame.is_root() || self.graph.frames[frame.index.index()].kind == CallKind::TailCall
    }

    fn inline(&mut self, site: &CallSite<'_>, target: Gc<CodeBlock>) -> Built<Option<Ssa>> {
        self.inlined_size += target.body().instructions().len() as u32;
        self.state_for_walks(self.origin);
        let caller_layout = self.describe_waiting_caller(site.dst);
        let count = site.arguments.len() as u32;
        let info = self.describe_frame(target, site.kind, count.max(target.parameters()));
        let mut frame = Frame::new(
            &mut self.graph,
            info,
            target,
            count.max(info.parameters),
            ArgumentCount::Known(count),
        )?;
        (frame.caller_layout, frame.caller_has_handler) =
            (caller_layout, self.frame().has_handler());
        frame.returns_to = self.returns_to(site);
        frame.caller_values.clone_from(&self.scratch);
        frame.set(Register::CALLEE, site.callee);
        // It knows better than what serves everyone.
        let is_callback = self.graph.frame_at(self.origin).is_builtin && !info.is_builtin;
        let undefined = self.undefined();
        for (position, register) in frame.argument_registers().enumerate() {
            frame.set(
                register,
                site.arguments.get(position).copied().unwrap_or(undefined),
            );
        }
        for (position, &argument) in site
            .arguments
            .iter()
            .enumerate()
            .take(info.parameters as usize)
        {
            let root = self.graph.root(argument);
            let (here, there) = (
                self.graph.prediction(root),
                target.argument_prediction(position as u32).get(),
            );
            if here.is_empty() {
                self.graph.predict(root, there);
            } else if is_callback && here.intersects(there) && !there.contains(self.expected(root))
            {
                let register = Register::from_offset(Register::THIS.offset() + position as i32);
                frame.set(register, self.expecting(root, here & there));
            }
        }

        let origin = self.origin;
        self.frames.push(frame);
        let state = self.state_for_walks(Origin(self.graph.sites.len() as u32));
        let entry = self.insert_node(Kind::InlineEntry, &[], 0, state);
        self.graph.frames.last_mut().unwrap().entry = entry;
        self.build_blocks(bun_engine_bytecode::BlockIndex(0))?;
        let mut frame = self.frames.pop().unwrap();
        self.origin = origin;
        let result = match frame.returned_in_place {
            Some((block, result)) => {
                (self.block, self.is_cut_off) = (block, false);
                Some(result)
            }
            None => self.enter(&core::mem::take(&mut frame.continuation)),
        };
        // The state from before the call is as good as it was if the function did nothing but compute.
        self.has_had_effect = self.checkpoint.is_none();
        Ok(result)
    }

    pub(super) fn leave_with(&mut self, value: Ssa) {
        if self.frame().is_root() {
            if !self.is_full() {
                self.node(Kind::TierUpAtReturn, &[], 0);
            }
            let value = self.graph.root(value);
            self.ir().ret(&[value]);
            self.block = bun_engine_codegen::ir::Block::NONE;
        } else if self.frame().is_last_way_out() {
            let block = core::mem::replace(&mut self.block, bun_engine_codegen::ir::Block::NONE);
            self.frame_mut().returned_in_place = Some((block, value));
        } else {
            let mut continuation = core::mem::take(&mut self.frame_mut().continuation);
            self.leave_for(&mut continuation, Some(value));
            self.frame_mut().continuation = continuation;
        }
    }

    /// Jumps to a junction that carries one value or none.
    pub(super) fn leave_for(&mut self, junction: &mut Junction, value: Option<Ssa>) {
        self.leave_with_values(junction, value.as_slice());
    }

    pub(super) fn leave_with_values(&mut self, junction: &mut Junction, values: &[Ssa]) {
        let block = *junction
            .block
            .get_or_insert_with(|| self.graph.function.new_block());
        self.ir().jump(block, &[]);
        self.scratch.clear();
        (self.scratch).extend(values.iter().map(|&value| self.graph.root(value)));
        let edge = self.graph.function.successor(self.block, 0);
        self.join(junction, edge, self.frame().may_be_in_loop(), true);
        self.block = bun_engine_codegen::ir::Block::NONE;
    }

    /// Gives the value, which is `NONE` if the junction carries none, or nothing if no way leads there.
    pub(super) fn enter(&mut self, junction: &Junction) -> Option<Ssa> {
        if junction.edges.is_empty() {
            return None;
        }
        (self.block, self.is_cut_off) = (junction.block.unwrap(), !junction.is_reached);
        self.knowledge.restore(&junction.knowledge);
        self.needs_invalidation_point = junction.follows_effect;
        self.checkpoint = junction.checkpoint.unwrap_or(State::NONE);
        Some(junction.values.first().copied().unwrap_or(Ssa::NONE))
    }
}

impl Frame {
    /// Nothing has returned yet, and nothing is waiting to be translated.
    fn is_last_way_out(&self) -> bool {
        self.continuation.edges.is_empty()
            && self
                .junctions
                .iter()
                .all(|junction| junction.is_entered || junction.edges.is_empty())
    }
}
