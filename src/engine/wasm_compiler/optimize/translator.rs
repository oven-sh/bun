//! What the translation of instructions to IR keeps track of.

use bun_engine_asm::RegisterSet;
use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, Block, Boundary, Builder, Edge, EffectFlags, Effects, Exit,
    Function, Heap, Origin, PatchpointData, Slot, State, Successor, Type, Value,
};
use bun_engine_wasm_format::{
    BranchHint, Catch, CodeIndex, Driver, Flow, FunctionBody, HeapType, LoopEffects, Module, Types,
    ValKind, ValType, Visit,
};
use smallvec::SmallVec;

use super::casts::Test;
use super::control::{Arrival, Control};
use super::emit::{Site, Sites};
use super::escape::Escapes;
use super::feedback::Feedback;
use super::heaps::{Heaps, Named};
use super::inlining::{Inlining, Node};
use super::locals::{Locals, Snapshot, Typed};
use super::rarity::{Rarity, is_rare};
use super::references::Facts;
use crate::abi::{self, MemoryMode, Place, Signature, Trap};
use crate::output::Environment;

pub(super) const NONE: u32 = u32::MAX;
const MAX_EFFORT: usize = 20_000_000;
/// Code that is translated twice counts twice.
const MAX_TRANSLATED_BYTES: u32 = 300_000;
/// Values, and those that branches carry. What an instruction adds can grow with a type.
const MAX_SIZE: usize = 1_000_000;

pub(super) enum Stop {
    TooComplex,
    /// The driver may have to come back here.
    LoopStarts,
    /// The driver goes back to the start of the loop that has this many around it.
    LoopRepeats(u32),
}

pub(super) type Visited = Result<(), Stop>;

#[derive(Clone, Copy)]
pub(super) struct Operand {
    pub(super) value: Value,
    pub(super) ty: ValType,
    /// The local that it was read from, or `NONE`.
    pub(super) local: u32,
}

impl Operand {
    #[inline]
    pub(super) fn new(value: Value, ty: ValType) -> Self {
        let local = NONE;
        Self { value, ty, local }
    }

    #[inline]
    pub(super) fn typed(self) -> Typed {
        Typed {
            value: self.value,
            ty: self.ty,
        }
    }
}

pub(super) type Operands = SmallVec<[Operand; 8]>;

#[inline]
pub(super) fn ir_type(ty: ValType) -> Type {
    match ty.kind() {
        ValKind::I32 => Type::I32,
        ValKind::I64 | ValKind::Ref => Type::I64,
        ValKind::F32 => Type::F32,
        ValKind::F64 => Type::F64,
        ValKind::V128 => Type::V128,
    }
}

fn boundary(place: Place) -> Boundary {
    match place {
        Place::Register(reg) => Boundary::Register(reg),
        Place::Stack(offset) => Boundary::Frame(offset),
    }
}

/// A function whose body is being translated.
#[derive(Clone, Copy)]
pub(super) struct Activation<'a> {
    pub(super) node: Node,
    /// The number of bodies that wait for this one to end.
    pub(super) depth: usize,
    pub(super) first_local: u32,
    /// Where an exception goes that leaves the function.
    pub(super) outer_handler: u32,
    pub(super) caller_origin: Origin,
    /// Its results are those of the machine code.
    pub(super) owns_frame: bool,
    pub(super) hints: &'a [BranchHint],
    /// The header of the innermost loop, and how often it was passed.
    pub(super) innermost_loop: (Block, u32),
}

#[derive(Default)]
pub(super) struct Buffers {
    pub(super) sites: Sites,
    stack: Vec<Operand>,
    controls: Vec<Control>,
    arrivals: Vec<Arrival>,
    carried: Vec<Operand>,
    catches: Vec<Catch>,
    meeting: Vec<(Edge, Snapshot)>,
    cases: Vec<(i64, Successor<'static>)>,
    locals: Locals,
    heaps: Heaps,
    facts: Facts,
    escapes: Escapes,
    rarity: Rarity,
    inlining: Inlining,
    loops: Vec<LoopEffects>,
}

pub(super) struct Translator<'a> {
    pub(super) env: &'a Environment<'a>,
    pub(super) module: &'a Module,
    pub(super) types: &'a Types,
    pub(super) feedback: &'a dyn Feedback,
    pub(super) root: FunctionBody<'a>,
    pub(super) signature: Signature,
    pub(super) b: Builder<'a>,
    pub(super) instance: Value,
    /// `NONE` unless memory 0 is guarded.
    pub(super) memory_base: Value,
    pub(super) named: Named,
    pub(super) activation: Activation<'a>,
    pub(super) is_live: bool,
    has_unreached_blocks: bool,
    pub(super) offset: u32,
    pub(super) loop_entry: Option<u32>,
    /// The loop at which the code is entered is still ahead. What is translated meanwhile is dropped.
    pub(super) is_seeking: bool,
    pub(super) sites_seen: u32,
    pub(super) sites_before_loops: u32,
    /// While seeking.
    pub(super) open_loops: u32,
    pub(super) translated_bytes: u32,
    /// A comparison that no local and no edge refers to.
    pub(super) unused_comparison: Value,
    pub(super) last_test: Option<Test>,
    /// What was allocated last, if the collector cannot have run since.
    pub(super) fresh_object: Value,
    pub(super) payload: Option<(Slot, u32)>,

    pub(super) sites: Sites,
    pub(super) stack: Vec<Operand>,
    pub(super) controls: Vec<Control>,
    pub(super) arrivals: Vec<Arrival>,
    /// The values that arrivals take along.
    pub(super) carried: Vec<Operand>,
    pub(super) catches: Vec<Catch>,
    pub(super) meeting: Vec<(Edge, Snapshot)>,
    pub(super) cases: Vec<(i64, Successor<'static>)>,
    pub(super) locals: Locals,
    pub(super) heaps: Heaps,
    pub(super) facts: Facts,
    pub(super) escapes: Escapes,
    pub(super) rarity: Rarity,
    pub(super) inlining: Inlining,
    /// By the depth of the activation.
    pub(super) loops: Vec<LoopEffects>,
}

pub(super) fn pins_memory_base(env: &Environment<'_>) -> bool {
    env.mode == MemoryMode::Guarded && !env.module.memories().is_empty()
}

impl<'a> Translator<'a> {
    pub(super) fn new(
        env: &'a Environment<'a>,
        code: CodeIndex,
        loop_entry: Option<u32>,
        feedback: &'a dyn Feedback,
        function: &'a mut Function,
        buffers: Buffers,
    ) -> Self {
        let root = env.module.body(code);
        Self {
            env,
            module: env.module,
            types: env.module.types(),
            feedback,
            root,
            signature: Signature::new(root.func_type()),
            named: Named::new(function, env.module),
            b: Builder::at_end(function, Block::NONE),
            instance: Value::NONE,
            memory_base: Value::NONE,
            activation: Activation {
                node: Node::ROOT,
                depth: 0,
                first_local: 0,
                outer_handler: NONE,
                caller_origin: Origin::default(),
                owns_frame: true,
                hints: env.module.branch_hints().of(root.func_index()),
                innermost_loop: (Block::NONE, 0),
            },
            is_live: true,
            has_unreached_blocks: false,
            offset: 0,
            loop_entry,
            is_seeking: loop_entry.is_some(),
            sites_seen: 0,
            sites_before_loops: 0,
            open_loops: 0,
            translated_bytes: root.bytes().len() as u32,
            unused_comparison: Value::NONE,
            last_test: None,
            fresh_object: Value::NONE,
            payload: None,
            sites: buffers.sites,
            stack: buffers.stack,
            controls: buffers.controls,
            arrivals: buffers.arrivals,
            carried: buffers.carried,
            catches: buffers.catches,
            meeting: buffers.meeting,
            cases: buffers.cases,
            locals: buffers.locals,
            heaps: buffers.heaps,
            facts: buffers.facts,
            escapes: buffers.escapes,
            rarity: buffers.rarity,
            inlining: buffers.inlining,
            loops: buffers.loops,
        }
    }

    pub(super) fn into_buffers(self) -> Buffers {
        Buffers {
            sites: self.sites,
            stack: self.stack,
            controls: self.controls,
            arrivals: self.arrivals,
            carried: self.carried,
            catches: self.catches,
            meeting: self.meeting,
            cases: self.cases,
            locals: self.locals,
            heaps: self.heaps,
            facts: self.facts,
            escapes: self.escapes,
            rarity: self.rarity,
            inlining: self.inlining,
            loops: self.loops,
        }
    }

    pub(super) fn translate(&mut self) -> Visited {
        self.sites.scopes.clear();
        let root = self.root;
        self.stack.clear();
        self.controls.clear();
        self.catches.clear();
        self.inlining.reset(root.code_index());
        if !self.is_seeking {
            self.inlining.decide(self.module, self.feedback, None);
        }

        let types = root.func_type().params;
        let places = types.iter().zip(&self.signature.params);
        let params: SmallVec<[_; 8]> = places
            .map(|(&ty, &place)| (ir_type(ty), boundary(place)))
            .collect();
        let entry = self.start_function(&params);
        let args = self.b.params(entry).iter().zip(types);
        let args: Operands = args.map(|(&arg, &ty)| Operand::new(arg, ty)).collect();
        self.enter_body(&root, &args);

        let mut driver = root.driver();
        let mut starts: SmallVec<[Driver<'a>; 8]> = SmallVec::new();
        loop {
            match driver.run(self) {
                Ok(()) if self.is_seeking => return Err(Stop::TooComplex),
                Ok(()) => break,
                Err(Stop::TooComplex) => return Err(Stop::TooComplex),
                Err(Stop::LoopStarts) => {
                    starts.truncate(self.open_loops as usize - 1);
                    starts.push(driver);
                }
                Err(Stop::LoopRepeats(depth)) => {
                    let end = core::mem::replace(&mut driver, starts[depth as usize]).offset();
                    self.translated_bytes += end - driver.offset();
                }
            }
        }
        self.locals.finish(self.b.function);
        if self.has_unreached_blocks || !self.rarity.is_empty() {
            let cfg = Cfg::new(self.b.function);
            cfg.remove_unreachable_blocks(self.b.function);
            self.rarity.mark_edges(self.b.function, &cfg);
        }
        self.escapes.dissolve(self.b.function);
        Ok(())
    }

    /// Drops what there is, and goes on in the new entry.
    pub(super) fn start_function(&mut self, params: &[(Type, Boundary)]) -> Block {
        let pins_base = pins_memory_base(self.env);
        let mut pinned = RegisterSet::of(&[abi::INSTANCE], &[]);
        if pins_base {
            pinned.insert(abi::MEMORY_BASE);
        }
        self.b.clear(pinned);
        self.b.reserve_values(self.root.bytes().len());
        (self.b.quiets_nans, self.b.params_are_extended) = (true, true);
        self.b.indexes_objects = false;
        let results = self.signature.results.iter().map(|&place| boundary(place));
        self.b.set_results(&results.collect::<SmallVec<[_; 2]>>());
        self.named = Named::new(self.b.function, self.module);
        self.instance = self.b.pinned(abi::INSTANCE);
        if pins_base {
            self.memory_base = self.b.pinned(abi::MEMORY_BASE);
        }
        self.sites.clear();
        self.arrivals.clear();
        self.carried.clear();
        self.locals.clear();
        self.heaps.clear();
        self.facts.clear();
        self.escapes.clear();
        self.rarity.clear();
        (self.payload, self.last_test) = (None, None);
        let entry = self.b.add_entry(params);
        self.switch_to(entry);
        entry
    }

    #[inline]
    pub(super) fn is_too_large(&self) -> bool {
        self.b.function.value_count() + self.carried.len() > MAX_SIZE
    }

    pub(super) fn check_complexity(&self) -> Visited {
        if self.locals.effort() > MAX_EFFORT
            || self.translated_bytes > MAX_TRANSLATED_BYTES
            || self.is_too_large()
        {
            return Err(Stop::TooComplex);
        }
        Ok(())
    }

    /// For a block that may be reached in another way than from the code before.
    #[inline]
    pub(super) fn switch_to(&mut self, block: Block) {
        self.b.switch_to(block);
        self.is_live = true;
        (self.unused_comparison, self.fresh_object) = (Value::NONE, Value::NONE);
    }

    /// The code here ran `count` times.
    pub(super) fn note_count(&mut self, count: u32) {
        let (header, turns) = self.activation.innermost_loop;
        if is_rare(count, self.inlining[self.activation.node].entries) {
            self.rarity.note_rare(self.b.block(), Block::NONE);
        } else if is_rare(count, turns) {
            self.rarity.note_rare(self.b.block(), header);
        }
    }

    // The operand stack

    #[inline]
    pub(super) fn push(&mut self, value: Value, ty: impl Into<ValType>) {
        self.stack.push(Operand::new(value, ty.into()));
    }

    #[inline]
    pub(super) fn pop(&mut self) -> Operand {
        self.stack.pop().expect("the code was validated")
    }

    #[inline]
    pub(super) fn pop_value(&mut self) -> Value {
        self.pop().value
    }

    /// The last is the one from the top.
    #[inline]
    pub(super) fn pop_values<const N: usize>(&mut self) -> [Value; N] {
        let rest = self.stack.len() - N;
        let values = core::array::from_fn(|index| self.stack[rest + index].value);
        self.stack.truncate(rest);
        values
    }

    pub(super) fn pop_many(&mut self, count: usize) -> Operands {
        self.stack.drain(self.stack.len() - count..).collect()
    }

    // Values

    pub(super) fn null(&mut self) -> Value {
        self.b.const64(abi::NULL.into())
    }

    pub(super) fn default_value(&mut self, ty: ValType) -> Typed {
        let Some(reference) = ty.as_ref() else {
            let value = self.b.zero(ir_type(ty));
            return Typed { value, ty };
        };
        let bottom = reference.heap_type().abstract_type().bottom();
        Typed {
            value: self.null(),
            ty: HeapType::of(bottom).nullable().into(),
        }
    }

    pub(super) fn widen(&mut self, value: Value) -> Value {
        if self.b.type_of(value) == Type::I32 {
            self.b.zero_extend(value)
        } else {
            value
        }
    }

    /// What can be read wherever the address is at hand, and does not change.
    pub(super) fn load_fixed(&mut self, ty: Type, address: Value, offset: i32) -> Value {
        let flags = AccessFlags::IMMUTABLE | AccessFlags::ALWAYS_READABLE;
        (self.b).load(ty, address, offset, Access::new(Heap::NOTHING, flags))
    }

    pub(super) fn load_immutable(&mut self, ty: Type, address: Value, offset: i32) -> Value {
        let access = Access::new(Heap::NOTHING, AccessFlags::IMMUTABLE);
        self.b.load(ty, address, offset, access)
    }

    /// What can be read wherever the address is at hand.
    pub(super) fn load_readable(
        &mut self,
        ty: Type,
        address: Value,
        offset: i32,
        heap: Heap,
    ) -> Value {
        let access = Access::new(heap, AccessFlags::ALWAYS_READABLE);
        self.b.load(ty, address, offset, access)
    }

    /// Goes to the returned block with `value`, or else rarely to the code that follows, which has to jump there.
    pub(super) fn skip_with(&mut self, condition: Value, value: Value) -> (Block, Value) {
        let (rare, done) = (self.b.new_block(), self.b.new_block());
        let ty = self.b.type_of(value);
        let result = self.b.add_param(done, ty);
        (self.b).branch(condition, Successor::new(done, &[value]), rare.rare());
        self.b.switch_to(rare);
        (done, result)
    }

    // Traps

    #[inline]
    pub(super) fn trap_if(&mut self, condition: Value, trap: Trap) {
        match self.b.int_constant(condition) {
            None => {
                let token = Sites::exit_token(trap, self.b.origin);
                let state = State::NONE;
                self.b.check(condition, Exit { token, state });
            }
            Some(0) => {}
            Some(_) => {
                self.trap(trap);
                // For what is added until the instruction ends.
                let unreached = self.b.new_block();
                self.b.switch_to(unreached);
                self.has_unreached_blocks = true;
            }
        }
    }

    pub(super) fn trap(&mut self, trap: Trap) {
        let token = self.sites.add(Site::Trap(trap));
        let effects = Effects::with_flags(EffectFlags::EXITS);
        let data = PatchpointData::new(Action::Custom, token, effects);
        self.b.patchpoint(&data, &[], &[]);
        self.end_unreachable();
    }

    pub(super) fn end_unreachable(&mut self) {
        self.b.unreachable();
        self.is_live = false;
    }
}

impl Visit for Translator<'_> {
    type Error = Stop;

    fn unhandled(&mut self) -> Visited {
        unreachable!("every instruction is translated")
    }

    #[inline]
    fn at(&mut self, offset: u32) {
        self.offset = offset;
    }

    /// What can follow dead code starts with `check_complexity`.
    #[inline]
    fn flow(&self) -> Flow {
        match self.is_live && !self.is_too_large() {
            true => Flow::Live,
            false => Flow::Dead,
        }
    }
}
