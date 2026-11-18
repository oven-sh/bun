//! Code that leaves its frame and is entered again.

use bun_engine_asm::Size;
use bun_engine_bytecode::{
    BlockIndex, Instruction, MetadataKind, RawInstruction, Register, ResumeMode, SavedRegister,
    SuspendKind, SuspendPointIndex, op,
};
use bun_engine_codegen::ir::{Access, AccessFlags, Block, State, Successor, Type, Value as Ssa};
use bun_engine_vm::code::metadata::{Call, WeakCell};
use bun_engine_vm::{
    CallFrame, CellType, Coroutine, CoroutineState, Gc, JsAsyncFunctionGenerator, JsAsyncGenerator,
    JsFunction, Shape, SpeculatedType as T, Value,
};
use smallvec::SmallVec;

use super::fork::{Fork, Odds};
use super::frame::Junction;
use super::{Builder, Built};
use crate::graph::{ExitKind, Kind, heaps};

const VALUE: Register = Register::argument(0);
const MODE: Register = Register::argument(1);
/// How many times the size of the function the ways on from all points may have together.
const MOST_COPIES: usize = 3;
const MOST_BLOCKS_LOOKED_AT: usize = 1 << 18;

/// The ways on from where the code has suspended, each of which is translated by itself.
pub(super) struct Resumptions {
    fork: Fork,
    offset: u32,
    registers: Vec<Ssa>,
    ways: Vec<(Block, BlockIndex)>,
}

fn state_value(state: CoroutineState) -> Value {
    Value::int32(state as i32)
}

impl Builder<'_> {
    /// The points to provide for, with the offsets at which they go on.
    fn points_in_use(&self) -> SmallVec<[(i64, u32); 8]> {
        let code_block = self.frame().code_block;
        let takes_all = code_block.exits_anywhere().contains(ExitKind::NeverResumed);
        let has_been_used = |resume| {
            let read = |offset| RawInstruction::read(code_block.body().instructions(), offset);
            let next = read(resume).and_then(|it| read(resume + u32::from(it.size)));
            next.is_none_or(|it| {
                !(it.opcode.metadata()).is_some_and(MetadataKind::has_value_profile)
                    || !self.prediction_at(it.metadata).is_empty()
            })
        };
        let points = (0..).zip(
            code_block
                .body()
                .suspend_points()
                .iter()
                .map(|it| it.resume),
        );
        points
            .filter(|it| takes_all || has_been_used(it.1))
            .collect()
    }

    /// That makes loops natural which a resumption enters in the middle.
    pub(super) fn is_worth_separating_resumptions(&self) -> bool {
        let (graph, points) = (self.frame().liveness.graph(), self.points_in_use());
        if points.is_empty() || points.len() * graph.len() > MOST_BLOCKS_LOOKED_AT {
            return false;
        }
        let size_from = |&(_, resume): &(i64, u32)| -> usize {
            let blocks = self.order_from(graph.block_at(resume));
            blocks.iter().map(|&it| graph.range(it).len()).sum()
        };
        let size = self.frame().code_block.body().instructions().len();
        points.iter().map(size_from).sum::<usize>() <= MOST_COPIES * size
    }

    fn coroutine_of_frame(&mut self) -> Ssa {
        let coroutine = self.get(Register::THIS);
        self.assume_type(coroutine, T::OTHER_OBJECT);
        self.tie_down(coroutine)
    }

    pub(super) fn resume_dispatch(&mut self, next: u32) {
        let (frame_pointer, offset) = (self.frame_pointer(), CallFrame::OFFSET_OF_ARGUMENT_COUNT);
        let count = self.load_immutable(Type::I32, frame_pointer, offset);
        let (fork, mut called) = (self.fork_later(), Junction::default());
        self.leave_if(count, Odds::Even, &mut called);
        let (coroutine, offset) = (self.coroutine_of_frame(), Coroutine::OFFSET_OF_POINT as i32);
        let point = self.load(Type::I32, coroutine, offset, heaps::SAVED_REGISTERS);
        let (points, body) = (self.points_in_use(), self.frame().code_block.body());
        let are_all = points.len() == body.suspend_points().len();
        let blocks: SmallVec<[Block; 8]> = (0..points.len() + usize::from(!are_all))
            .map(|_| self.graph.function.new_block())
            .collect();
        let resumed = self.fork();
        if let Some((&last, others)) = blocks.split_last() {
            let cases: SmallVec<[(i64, Successor<'_>); 8]> = (points.iter().zip(others))
                .map(|(&(point, _), &block)| (point, block.into()))
                .collect();
            self.ir().switch(point, &cases, last.into());
            if !are_all {
                self.take_way(&resumed, last);
                self.force_exit(ExitKind::NeverResumed);
            }
        } else {
            self.ir().unreachable();
            self.end_block();
        }
        let ways = (blocks.iter().zip(&points))
            .map(|(&block, &(_, resume))| (block, self.target_at(resume)))
            .collect::<Vec<_>>();
        if self.frame().separates_resumptions {
            self.resumptions = Some(Resumptions {
                fork: resumed,
                offset: self.frame().offset,
                registers: self.frame().all_registers().to_vec(),
                ways,
            });
        } else {
            for (block, target) in ways {
                self.take_way(&resumed, block);
                self.goto(target);
            }
        }
        self.resume_at(&fork, &called);
        self.goto(self.target_at(next));
    }

    pub(super) fn build_resumptions(&mut self) -> Built {
        let Some(resumptions) = self.resumptions.take() else {
            return Ok(());
        };
        for &(block, target) in &resumptions.ways {
            self.frame_mut().start_over(&resumptions.registers);
            self.set_origin(resumptions.offset);
            self.take_way(&resumptions.fork, block);
            self.build_blocks(target)?;
        }
        Ok(())
    }

    fn offset_of_saved(&self, word: u32) -> i32 {
        let first = Coroutine::offset_of_registers(self.frame().code_block.coroutine_type());
        (first + word as usize * size_of::<u64>()) as i32
    }

    pub(super) fn resume(&mut self, op: op::Resume) {
        let (coroutine, code_block) = (self.coroutine_of_frame(), self.frame().code_block);
        let access = Access::new(heaps::SAVED_REGISTERS, AccessFlags::ALWAYS_READABLE);
        for &SavedRegister { register, word } in code_block.body().saved_registers(op.point) {
            let offset = self.offset_of_saved(word);
            let value = self.ir().load(Type::I64, coroutine, offset, access);
            let seen = self.types_saved.get(&(op.point.0, word)).copied();
            self.graph.predict(value, seen.unwrap_or_default());
            self.graph.restored.push((op.point.0, word, value));
            self.set(register, value);
        }
        self.set(op.generator, coroutine);
    }

    fn passed_on_resumption(&mut self, register: Register, ty: T, prediction: T) -> Ssa {
        let (frame_pointer, offset) = (self.frame_pointer(), register.offset() * 8);
        let value = (self.ir()).load(Type::I64, frame_pointer, offset, heaps::FRAME);
        self.graph.declare(value, ty);
        self.graph.predict(value, prediction);
        value
    }

    fn value_of_resumption(&mut self, metadata: u32) -> Ssa {
        let value = self.passed_on_resumption(VALUE, T::HEAP_TOP, self.prediction_at(metadata));
        self.note_profile(value, metadata);
        value
    }

    /// Goes on if the mode is another.
    fn throw_on_request(&mut self, mode: Ssa, value: Ssa) {
        let throws = self.ir().equal(mode, ResumeMode::Throw as i32);
        self.choose(throws, Odds::Low, |this, throws| {
            if throws {
                this.throw(value);
            }
            None
        });
    }

    /// An I32, which is `Normal` unless something else has come up before.
    fn mode_of_resumption(&mut self) -> Ssa {
        let mode = self.passed_on_resumption(MODE, T::INT32, T::INT32);
        let mode = self.ir().wrap(mode);
        if self.has_exited(ExitKind::AbruptResumption) {
            return mode;
        }
        let is_abrupt = self.ir().not_equal(mode, ResumeMode::Normal as i32);
        self.exit_if(is_abrupt, ExitKind::AbruptResumption);
        self.int32(ResumeMode::Normal as i32)
    }

    pub(super) fn resume_after_await(&mut self, op: op::ResumeAfterAwait) {
        let (mode, value) = (
            self.mode_of_resumption(),
            self.value_of_resumption(op.metadata),
        );
        self.throw_on_request(mode, value);
        self.set(op.dst, value);
    }

    pub(super) fn resume_after_yield(&mut self, op: op::ResumeAfterYield, next: u32) {
        let (mode, value) = (
            self.mode_of_resumption(),
            self.value_of_resumption(op.metadata),
        );
        self.throw_on_request(mode, value);
        self.set(op.dst, value);
        let is_normal = self.ir().equal(mode, ResumeMode::Normal as i32);
        self.branch(is_normal, true, op.normal.from(self.frame().offset), next);
    }

    pub(super) fn resume_after_delegate(&mut self, op: op::ResumeAfterDelegate) {
        let (mode, value) = (
            self.mode_of_resumption(),
            self.value_of_resumption(op.metadata),
        );
        let mode = self.box_int32(mode);
        self.set(op.value, value);
        self.set(op.mode, mode);
    }

    fn set_state(&mut self, coroutine: Ssa, state: CoroutineState) {
        let (state, offset) = (
            self.value(state_value(state)),
            Coroutine::OFFSET_OF_STATE as i32,
        );
        self.store(coroutine, offset, heaps::INTERNAL_FIELDS, state);
    }

    fn save(&mut self, coroutine: Ssa, point: SuspendPointIndex, kind: SuspendKind) {
        let code_block = self.frame().code_block;
        let mut for_barrier: SmallVec<[Ssa; 8]> = smallvec::smallvec![coroutine];
        for &SavedRegister { register, word } in code_block.body().saved_registers(point) {
            let (value, offset) = (
                self.graph.root(self.frame().get(register)),
                self.offset_of_saved(word),
            );
            self.graph.saved.push((point.0, word, value));
            *self.types_saved.entry((point.0, word)).or_default() |= self.graph.prediction(value);
            if !self.graph.is_saved_in(value, coroutine, offset) {
                (self.ir()).store(value, coroutine, offset, heaps::SAVED_REGISTERS);
                if self.is(value, !T::CELL) {
                    self.graph.note_as_no_cell(value, self.origin);
                } else {
                    for_barrier.push(value);
                }
            }
        }
        let (point, offset) = (
            self.int32(point.0 as i32),
            Coroutine::OFFSET_OF_POINT as i32,
        );
        (self.ir()).store(point, coroutine, offset, heaps::SAVED_REGISTERS);
        self.set_state(coroutine, kind.into());
        if for_barrier.len() > 1 {
            self.insert_node(Kind::StoreBarrier, &for_barrier, 0, State::NONE);
        }
    }

    fn coroutine_in(&mut self, value: Ssa) -> Ssa {
        self.assume_type(value, T::OTHER_OBJECT);
        self.alias(value)
    }

    pub(super) fn suspend(&mut self, op: op::Suspend) {
        let (coroutine, value) = (self.get(op.generator), self.get(op.value));
        let coroutine = self.coroutine_in(coroutine);
        self.save(coroutine, op.point, op.kind);
        self.leave_with(value);
    }

    pub(super) fn complete(&mut self, coroutine: Ssa) {
        let coroutine = self.coroutine_in(coroutine);
        self.set_state(coroutine, CoroutineState::Completed);
        let (none, offset) = (self.int32(0), Coroutine::OFFSET_OF_SAVED_COUNT as i32);
        (self.ir()).store_sized(Size::S32, none, coroutine, offset, heaps::SAVED_REGISTERS);
    }

    pub(super) fn generator_return(&mut self, op: op::GeneratorReturn) {
        let (coroutine, value) = (self.get(op.generator), self.get(op.value));
        self.complete(coroutine);
        self.leave_with(value);
    }

    // Making them

    fn coroutine_allocation(&mut self, shape: Gc<Shape>) -> Option<u32> {
        let size = self.offset_of_saved(self.frame().code_block.saved_words());
        self.allocation(shape, size as usize)
    }

    /// The caller initializes what only that kind has, and the words in `left_out`.
    fn new_coroutine(&mut self, allocation: u32, left_out: &[SavedRegister]) -> Ssa {
        let (code_block, coroutine) = (self.frame().code_block, self.new_instance(allocation));
        let callee = self.graph.root(self.frame().get(Register::CALLEE));
        let fields = [
            (
                Coroutine::OFFSET_OF_STATE,
                heaps::INTERNAL_FIELDS,
                self.value(state_value(CoroutineState::Executing)),
            ),
            (
                Coroutine::OFFSET_OF_POINT,
                heaps::SAVED_REGISTERS,
                self.word((code_block.saved_words() as usize) << 32),
            ),
            (Coroutine::OFFSET_OF_CALLEE, heaps::OTHER_FIELDS, callee),
            (
                Coroutine::OFFSET_OF_EXECUTABLE,
                heaps::OTHER_FIELDS,
                self.cell(code_block.executable().cell()),
            ),
        ];
        for (offset, heap, value) in fields {
            self.ir().store(value, coroutine, offset as i32, heap);
        }
        let empty = self.empty();
        for word in 0..code_block.saved_words() {
            if !left_out.iter().any(|it| it.word == word) {
                let offset = self.offset_of_saved(word);
                (self.ir()).store(empty, coroutine, offset, heaps::SAVED_REGISTERS);
            }
        }
        coroutine
    }

    fn shape_of_generators(&mut self, function: Gc<JsFunction>) -> Option<Gc<Shape>> {
        let wanted = self.frame().code_block.coroutine_type();
        let rare_data = function.rare_data()?;
        let shape = (rare_data.subclass_shape()).filter(|it| it.instance_type() == wanted)?;
        (self.watch(rare_data.allocation_watchpoints())).then_some(shape)
    }

    pub(super) fn create_generator(&mut self, dst: Register, metadata: u32, next: u32) {
        let (code_block, callee) = (self.frame().code_block, self.get(Register::CALLEE));
        let seen = code_block.checked_metadata::<WeakCell>(MetadataKind::CachedCallee, metadata);
        let function = (seen.get().and_then(Gc::downcast::<JsFunction>))
            .filter(|_| !self.has_exited(ExitKind::BadIdentity));
        let known = function.and_then(|function| {
            let shape = self.shape_of_generators(function)?;
            Some((function, self.coroutine_allocation(shape)?))
        });
        let is_async = code_block.coroutine_type() == CellType::AsyncGenerator;
        let Some((function, allocation)) = known else {
            let (kind, frame_pointer) = (Kind::CreateGenerator, self.frame_pointer());
            let generator = self.node(kind, &[frame_pointer], is_async.into());
            return self.set(dst, generator);
        };
        let expected = self.cell(function.cell());
        self.check_identical(callee, expected);
        let anchored = code_block.anchor();
        let start = match Instruction::read(anchored.body().instructions(), next).0 {
            Instruction::Suspend(op) if op.generator == dst => Some(op),
            _ => None,
        };
        let left_out = start.map_or_default(|it| anchored.body().saved_registers(it.point));
        let generator = self.new_coroutine(allocation, left_out);
        if is_async {
            for (offset, value) in JsAsyncGenerator::INITIAL_FIELDS {
                let value = self.value_or_empty(value);
                (self.ir()).store(value, generator, offset as i32, heaps::OTHER_FIELDS);
            }
        }
        self.set(dst, generator);
        start.inspect(|&op| self.suspend(op));
    }

    pub(super) fn async_function_allocation(&mut self) -> Option<u32> {
        self.coroutine_allocation(self.global().async_function_generator_shape(self.vm))
    }

    fn new_async_function_generator(&mut self, allocation: u32, left_out: &[SavedRegister]) -> Ssa {
        let promise = self.new_promise(0, None);
        let generator = self.new_coroutine(allocation, left_out);
        let offset = JsAsyncFunctionGenerator::OFFSET_OF_PROMISE as i32;
        (self.ir()).store(promise, generator, offset, heaps::OTHER_FIELDS);
        (self.knowledge).learn_field(
            generator,
            offset,
            bun_engine_codegen::ir::Heap::NOTHING,
            promise,
        );
        generator
    }

    /// The one in the register, or a new one if that is empty.
    pub(super) fn ensure_coroutine(&mut self, existing: Ssa, allocation: u32) -> Ssa {
        let is_missing = self.is_type(existing, T::EMPTY);
        let coroutine = self.choose(is_missing, Odds::Even, |this, is_missing| {
            Some(if is_missing {
                this.new_async_function_generator(allocation, &[])
            } else {
                existing
            })
        });
        self.coroutine_in(coroutine.expect("nothing ends"))
    }

    pub(super) fn promise_of(&mut self, generator: Ssa) -> Ssa {
        let offset = JsAsyncFunctionGenerator::OFFSET_OF_PROMISE;
        let promise = self.load_immutable(Type::I64, generator, offset);
        self.assume_type(promise, T::PROMISE);
        promise
    }

    pub(super) fn await_value(&mut self, op: op::Await) {
        let Some(allocation) = self.async_function_allocation() else {
            return self.interpret();
        };
        let (existing, value) = (self.get(op.generator), self.get_value(op.value));
        let (code_block, kind) = (self.frame().code_block, SuspendKind::Await);
        let generator = if self.is(existing, T::EMPTY) {
            // Nothing knows of it before it is subscribed.
            let anchored = code_block.anchor();
            let registers = anchored.body().saved_registers(op.point);
            let generator = self.new_async_function_generator(allocation, registers);
            self.save(generator, op.point, kind);
            self.subscribe(generator, value);
            generator
        } else {
            let generator = self.ensure_coroutine(existing, allocation);
            self.subscribe(generator, value);
            self.save(generator, op.point, kind);
            generator
        };
        let promise = self.promise_of(generator);
        self.leave_with(promise);
    }

    pub(super) fn resume_generator(&mut self, op: op::ResumeGenerator) {
        let code_block = self.frame().code_block;
        let entry = code_block.checked_metadata::<Call>(MetadataKind::Call, op.metadata);
        if !self.has_run_or_exit(entry.profile.has_run()) {
            return;
        }
        let Some(prediction) = self.prediction_or_exit(op.metadata) else {
            return;
        };
        let (generator, value, mode) = (
            self.get_value(op.generator),
            self.get_value(op.value),
            self.get_value(op.mode),
        );
        let generator = self.coroutine_in(generator);
        let (callee, offset) = (
            self.load_immutable(Type::I64, generator, Coroutine::OFFSET_OF_CALLEE),
            Coroutine::OFFSET_OF_EXECUTABLE as i32,
        );
        let executable = self.load(Type::I64, generator, offset, heaps::OTHER_FIELDS);
        self.set_state(generator, CoroutineState::Executing);
        let operands = [executable, callee, generator, value, mode].map(|it| self.graph.root(it));
        let result = self.profiled_node(Kind::ResumeGenerator, &operands, 0, prediction);
        self.note_profile(result, op.metadata);
        self.set(op.dst, result);
    }
}

const _: () = assert!(Coroutine::OFFSET_OF_SAVED_COUNT == Coroutine::OFFSET_OF_POINT + 4);
