//! From bytecode and profiles to a graph. This is the part that reads the heap.

mod arguments;
mod arithmetic;
mod arrays;
mod caches;
mod calls;
mod cells;
mod comparisons;
mod control;
mod conversions;
mod elements;
mod emit;
mod exceptions;
mod for_in;
mod fork;
mod frame;
mod globals;
mod inlining;
mod instructions;
mod interpret;
mod intrinsics;
mod iteration;
mod objects;
mod private_names;
mod probes;
mod promises;
mod properties;
mod queries;
mod regexps;
mod scopes;
mod states;
mod steps;
mod suspension;
mod switches;
mod targets;
mod varargs;
mod wasm;

use std::collections::VecDeque;
use std::rc::Rc;

use bun_engine_asm::abi;
use bun_engine_bytecode::{BlockIndex, CodeFlags, Register, Walk};
use bun_engine_codegen::ir::{Block, Boundary, Heap, Origin, State, Type, Value as Ssa};
use bun_engine_codegen::passes::Level;
use bun_engine_text::names;
use bun_engine_vm::{
    CodeBlock, FastHashMap, Gc, IterationMode, RootVec, ShapeId, SpeculatedType as T, Vm, root_vec,
};
use frame::{ArgumentCount, Frame};

use crate::graph::{
    CallKind, Entry, ExitKind, FrameInfo, Graph, Knowledge, Profile, ShapeIndex, heaps,
};
use crate::runtime::cells::Dependencies;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Refusal {
    TooLarge,
    Unsupported,
}

pub(crate) type Built<T = ()> = Result<T, Refusal>;

pub(crate) struct Builder<'a> {
    vm: &'a Vm,
    graph: Graph,
    dependencies: Dependencies,
    /// The innermost is last.
    frames: RootVec<Frame>,
    /// `NONE` where control does not get.
    block: Block,
    /// Nothing leads to the block. The rest of the instruction is translated all the same, to be thrown away.
    is_cut_off: bool,
    origin: Origin,
    knowledge: Knowledge,
    /// Where to exit to, as long as nothing has happened that cannot be done again.
    checkpoint: State,
    /// The instruction that is being translated has had an effect, so there is nothing to exit to until the next.
    has_had_effect: bool,
    /// How many there have been.
    effects: u32,
    needs_invalidation_point: bool,
    shape_indices: FastHashMap<ShapeId, ShapeIndex>,
    heap_members: FastHashMap<(heaps::Family, usize), Heap>,
    /// In the frame that has asked for the code, with `this`.
    argument_count_seen: u32,
    /// With the elements that they have been given.
    arrays_made: Vec<(Ssa, arrays::Values)>,
    inlined_size: u32,
    /// The latest few.
    choices: VecDeque<targets::Choice>,
    resumptions: Option<suspension::Resumptions>,
    /// So far, by the point where the code suspends and the word.
    types_saved: FastHashMap<(u32, u32), T>,
    walk: Walk,
    scratch: Vec<Ssa>,
}

/// The frame that has asked for the code.
pub(crate) struct Running<'a> {
    /// With `this`.
    pub(crate) argument_count: u32,
    /// If it is at the head of a loop.
    pub(crate) value_in: &'a ValueIn<'a>,
}

/// The bits, and the type.
pub(crate) type ValueIn<'a> = dyn Fn(Register) -> (u64, T) + 'a;

pub(crate) fn build(
    vm: &Vm,
    code_block: Gc<CodeBlock>,
    level: Level,
    entry: Entry,
    running: &Running<'_>,
    seed: u32,
) -> Built<(Graph, Dependencies)> {
    let _defer = vm.heap.defer_collection();
    let mut builder = Builder {
        vm,
        graph: Graph::new(level, entry, seed),
        dependencies: Dependencies::default(),
        frames: root_vec(),
        block: Block::NONE,
        is_cut_off: false,
        origin: Origin::default(),
        knowledge: Knowledge::default(),
        checkpoint: State::NONE,
        has_had_effect: false,
        effects: 0,
        needs_invalidation_point: false,
        shape_indices: FastHashMap::default(),
        heap_members: FastHashMap::default(),
        argument_count_seen: running.argument_count,
        arrays_made: Vec::new(),
        inlined_size: 0,
        choices: VecDeque::new(),
        resumptions: None,
        types_saved: FastHashMap::default(),
        walk: Walk::default(),
        scratch: Vec::new(),
    };
    let last_index = (heaps::Family::Named, names::lastIndex.address());
    builder.heap_members.insert(last_index, heaps::LAST_INDEX);
    builder.build_root(code_block, running.value_in)?;
    builder.graph.function.resolve_aliases();
    Ok((builder.graph, builder.dependencies))
}

impl Builder<'_> {
    #[inline]
    fn frame(&self) -> &Frame {
        self.frames.last().unwrap()
    }

    #[inline]
    fn frame_mut(&mut self) -> &mut Frame {
        self.frames.last_mut().unwrap()
    }

    fn is_full(&self) -> bool {
        self.graph.level == Level::Full
    }

    /// `slots` is the number of arguments that have a register, including `this`.
    fn describe_frame(
        &mut self,
        code_block: Gc<CodeBlock>,
        kind: CallKind,
        slots: u32,
    ) -> FrameInfo {
        let distance = self.frames.last().map_or(0, |caller| {
            let caller = &self.graph.frames[caller.index.index()];
            let between = caller.frame_words + Register::HEADER_WORDS + slots;
            caller.distance + between.next_multiple_of(2)
        });
        let least = &mut self.graph.function.least_frame_bytes;
        *least = (*least).max((distance + code_block.locals() + 2) * 8);
        code_block.update_predictions();
        self.make_up_profiles(&code_block);
        self.dependencies.keep(code_block.cell());
        self.note_realm(code_block.global());
        FrameInfo {
            code_block: code_block.address(),
            global: code_block.global().address(),
            caller: self.origin,
            kind,
            is_builtin: code_block.body().flags().contains(CodeFlags::BUILTIN),
            frame_words: code_block.locals(),
            parameters: code_block.parameters(),
            distance,
            entry: Ssa::NONE,
            shows: states::shown_by(&code_block),
        }
    }

    fn build_root(&mut self, code_block: Gc<CodeBlock>, running: &ValueIn<'_>) -> Built {
        if !bun_engine_vm::is_optimizable(code_block.body()) {
            return Err(Refusal::TooLarge);
        }
        let info = self.describe_frame(code_block, CallKind::Call, code_block.parameters());
        let frame = Frame::new(
            &mut self.graph,
            info,
            code_block,
            info.parameters,
            ArgumentCount::InFrame,
        )?;
        let start = match self.graph.entry {
            Entry::Function => 0,
            Entry::Loop(offset) => offset,
        };
        let first = frame.liveness.graph().block_at(start);
        let assigned = frame.assigned_arguments();
        let (mut loaded, mut fixed): (Vec<_>, Vec<_>) =
            (frame.argument_registers()).partition(|argument| assigned.contains(argument));
        fixed.push(Register::CALLEE);
        if let Entry::Loop(_) = self.graph.entry {
            loaded.extend(frame.liveness.live_in(first).iter());
            self.graph.function.reserved_frame_bytes = code_block.locals() * 8;
        }
        let params: Vec<_> = (fixed.iter())
            .map(|register| (Type::I64, Boundary::Frame(register.offset() * 8)))
            .collect();
        self.block = self.graph.function.add_entry(&params);
        let result = Boundary::Register(abi::RETURN_GPRS[0].into());
        self.graph.function.set_results(&[result]);
        self.frames.push(frame);
        self.set_origin(start);
        for (position, &register) in fixed.iter().enumerate() {
            let param = self.graph.function.params(self.block)[position];
            self.start_with(register, param, running);
        }
        // An instruction that is interpreted may overwrite these slots.
        let frame_pointer = self.frame_pointer();
        for register in loaded {
            let offset = register.offset() * 8;
            let value = (self.ir()).load(Type::I64, frame_pointer, offset, heaps::FRAME);
            self.start_with(register, value, running);
        }
        self.frame_mut().in_place = fixed;
        if let Entry::Loop(_) = self.graph.entry {
            self.check_values_at_entry(first, running);
        }
        if self.graph.entry == Entry::Function {
            self.frame_mut().separates_resumptions = self.is_worth_separating_resumptions();
        }
        self.build_blocks(first)?;
        self.build_resumptions()
    }

    /// Once, so that no turn of the loop has to.
    fn check_values_at_entry(&mut self, header: BlockIndex, running: &ValueIn<'_>) {
        if self.has_exited(ExitKind::BadRepresentation) {
            return;
        }
        let liveness = Rc::clone(&self.frame().liveness);
        let live = liveness.live_in(header);
        self.frame_mut().live_before.extend_from_slice(live.words());
        for register in self.frame().carried(live) {
            let value = self.frame().get(register);
            if let Some(mode) = IterationMode::of_marker(running(register).0) {
                let marker = self.value(mode.marker());
                let differs = self.ir().not_equal(value, marker);
                self.exit_if(differs, ExitKind::BadRepresentation);
                self.set(register, marker);
                continue;
            }
            let expected = self.graph.prediction(value);
            let mut fitting = [T::OBJECT, T::STRING, T::CELL, T::HEAP_TOP].into_iter();
            if let Some(ty) = fitting.find(|it| it.contains(expected)) {
                self.check_type_or(value, ty, ExitKind::BadRepresentation);
            }
        }
    }

    fn start_with(&mut self, register: Register, value: Ssa, running: &ValueIn<'_>) {
        self.frame_mut().set(register, value);
        let code_block = self.frame().code_block;
        let is_at_loop = self.graph.entry != Entry::Function;
        let mut prediction = T::empty();
        if register == Register::CALLEE {
            self.graph.declare(value, T::OBJECT);
            prediction = T::FUNCTION;
        } else if let Ok(index) = u32::try_from(register.offset() - Register::THIS.offset()) {
            // A constructor of a derived class has no `this` for a while.
            if index != 0 || !is_at_loop {
                self.graph.declare(value, T::HEAP_TOP);
            }
            self.graph.set_profile(value, Profile::Argument(index));
            prediction = code_block.argument_prediction(index).get();
        }
        if is_at_loop {
            prediction |= running(register).1;
        }
        self.graph.predict(value, prediction);
    }
}
