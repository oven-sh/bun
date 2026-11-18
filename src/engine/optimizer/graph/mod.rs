//! A function on its way from bytecode to machine code. It refers to cells by address only.

mod data;
mod direct;
mod facts;
mod frames;
pub(crate) mod heaps;
mod knowledge;
mod modes;
mod node;
mod owners;
pub(crate) mod probes;
mod recipes;
mod validate;

use core::panic::Location;

use bun_engine_asm::{RegisterSet, abi};
use bun_engine_bytecode::{BlockIndex, Register};
use bun_engine_codegen::ir::{
    Entity, Exit, Function, Op, Origin, State, Table, Token, Value as Ssa,
};
use bun_engine_codegen::passes::Level;
use bun_engine_ffi::Signature;
use bun_engine_number::Random;
use bun_engine_vm::{ExitKinds, FastHashMap, Intrinsic, RealmWatchpoint, SpeculatedType, Value};
pub(crate) use data::*;
pub(crate) use direct::FormCall;
pub(crate) use facts::*;
pub(crate) use frames::*;
pub(crate) use knowledge::{
    Knowledge, Known, LOOKED_UP, SavedKnowledge, implied_by_end, implied_type, type_of_param,
    without_negation,
};
pub(crate) use modes::{ModeCheck, ModeSet};
pub(crate) use node::{Gives, Kind};
use probes::Claim;
pub(crate) use recipes::{Recipe, out_of_line_offset};
pub(crate) use validate::validate;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Entry {
    Function,
    /// Takes over the frame of code that is not optimized at the loop with this offset.
    Loop(u32),
}

/// What the code may count on without checking.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Assumption {
    Stable(ShapeIndex),
    Realm(usize, RealmWatchpoint),
}

#[derive(Clone, Copy)]
pub(crate) struct Site {
    pub(crate) position: Position,
    pub(crate) exits: ExitKinds,
    /// An exception may be caught in this frame on the stack.
    pub(crate) has_handler: bool,
    /// Of the function that the position is in.
    pub(crate) own_handler: Option<BlockIndex>,
    /// What the handler goes on from, if a node here may turn into one that throws.
    pub(crate) state_for_handler: State,
    /// What is done in place of a call.
    pub(crate) intrinsic: Intrinsic,
}

pub(crate) struct Graph {
    pub(crate) function: Function,
    pub(crate) level: Level,
    pub(crate) entry: Entry,
    pub(crate) is_specialized: bool,
    pub(crate) frames: Vec<FrameInfo>,
    /// By origin.
    pub(crate) sites: Vec<Site>,
    pub(crate) layouts: Vec<Layout>,
    pub(crate) layout_registers: Vec<Register>,
    pub(crate) recipes: Vec<Recipe>,
    pub(crate) exits: Vec<ExitInfo>,
    /// One of them does. No code comes of such a graph.
    pub(crate) lacks_state: bool,
    /// Of checks that are done before a loop, which might not have come to them, and the head of the loop. Ascending.
    pub(crate) speculative_states: Vec<(State, Origin)>,
    pub(crate) shapes: Shapes,
    pub(crate) cells: FastHashMap<u64, CellFacts>,
    pub(crate) transitions: Vec<Transition>,
    pub(crate) allocations: Vec<Allocation>,
    pub(crate) cached_accesses: Vec<CachedAccess>,
    pub(crate) searches: Vec<SlotSearch>,
    pub(crate) wasm_calls: Vec<WasmCall>,
    pub(crate) signatures: Vec<&'static Signature>,
    /// Those of the code blocks of the frames, which have to be looked after by the next collection then.
    pub(crate) writes_profiles: bool,
    pub(crate) shadow_frame: ShadowFrame,
    /// The strings, which never die, by `TypeName`. Zero unless a node needs them.
    pub(crate) type_names: [u64; TypeName::COUNT],
    /// What is stored at a point where the code suspends, and loaded when it goes on: the point, the word and the value.
    pub(crate) saved: Vec<(u32, u32, Ssa)>,
    pub(crate) restored: Vec<(u32, u32, Ssa)>,
    /// For concatenations, once there is one.
    pub(crate) rope_allocation: Option<u32>,
    /// What tagged values are expected to be. Empty for what has never been seen.
    pub(crate) predictions: Table<Ssa, SpeculatedType>,
    /// What tagged values are certain to be, wherever they are at hand. Empty if only their kind of node tells.
    /// `INT52` for a parameter in that form.
    pub(crate) declared: Table<Ssa, SpeculatedType>,
    /// Ascending.
    pub(crate) profiles: Vec<(Ssa, Profile)>,
    pub(crate) types: TypeChecks,
    mode_checks: Vec<ModeCheck>,
    /// By realm, a bit for each watchpoint that held when the graph was built.
    pub(crate) realms: Vec<(usize, u64)>,
    /// Those that passes have made use of.
    pub(crate) assumptions: Vec<Assumption>,
    /// In a build with assertions, the values that an instruction stores without a barrier, as they are no cells there.
    no_cells: Vec<(Ssa, Origin)>,
    /// The tokens of those that are taken only if their node has done nothing, ascending, if exits are forced.
    pub(crate) unforced_exits: Vec<u32>,
    pub(crate) claims: Vec<(Claim, &'static Location<'static>)>,
    /// For probes.
    pub(crate) random: Random,
}

pub(crate) const PINNED: RegisterSet = abi::PINNED;

impl Graph {
    pub(crate) fn new(level: Level, entry: Entry, seed: u32) -> Self {
        let mut function = Function::new(PINNED);
        function.set_node_kinds(node::INFO);
        function.only_nodes_make_readable = true;
        function.set_pinned_value(abi::NUMBER_TAG, Value::NUMBER_TAG);
        function.set_pinned_value(abi::NOT_CELL_MASK, Value::NOT_CELL_MASK);
        heaps::add_fixed(&mut function);
        Self {
            function,
            level,
            entry,
            is_specialized: false,
            frames: Vec::new(),
            sites: Vec::new(),
            layouts: Vec::new(),
            layout_registers: Vec::new(),
            recipes: Vec::new(),
            exits: Vec::new(),
            lacks_state: false,
            speculative_states: Vec::new(),
            shapes: Shapes::default(),
            cells: FastHashMap::default(),
            transitions: Vec::new(),
            allocations: Vec::new(),
            cached_accesses: Vec::new(),
            searches: Vec::new(),
            wasm_calls: Vec::new(),
            signatures: Vec::new(),
            writes_profiles: false,
            shadow_frame: ShadowFrame::default(),
            type_names: [0; TypeName::COUNT],
            saved: Vec::new(),
            restored: Vec::new(),
            rope_allocation: None,
            predictions: Table::default(),
            declared: Table::default(),
            profiles: Vec::new(),
            types: TypeChecks::default(),
            mode_checks: Vec::new(),
            realms: Vec::new(),
            assumptions: Vec::new(),
            no_cells: Vec::new(),
            unforced_exits: Vec::new(),
            claims: Vec::new(),
            random: Random::new(seed),
        }
    }

    #[inline]
    pub(crate) fn node(&self, value: Ssa) -> Option<(Kind, u32)> {
        self.function
            .op(value)
            .node()
            .map(|(kind, data)| (Kind::of(kind), data))
    }

    #[inline]
    pub(crate) fn kind(&self, value: Ssa) -> Option<Kind> {
        self.node(value).map(|(kind, _)| kind)
    }

    #[inline]
    pub(crate) fn operand(&self, value: Ssa, position: usize) -> Ssa {
        self.function
            .resolve(self.function.operands(value)[position])
    }

    /// The operand of a node of that kind.
    #[inline]
    pub(crate) fn inside(&self, value: Ssa, kind: Kind) -> Option<Ssa> {
        (self.kind(value) == Some(kind)).then(|| self.operand(value, 0))
    }

    /// The value without the checks that it has passed.
    #[inline]
    pub(crate) fn root(&self, mut value: Ssa) -> Ssa {
        value = self.function.resolve(value);
        while self
            .kind(value)
            .is_some_and(|kind| matches!(kind.gives(), Gives::Operand))
        {
            value = self.operand(value, 0);
        }
        value
    }

    pub(crate) fn site(&self, origin: Origin) -> &Site {
        &self.sites[origin.0 as usize]
    }

    pub(crate) fn frame_at(&self, origin: Origin) -> &FrameInfo {
        &self.frames[self.site(origin).position.frame.index()]
    }

    pub(crate) fn has_exited(&self, origin: Origin, kind: ExitKind) -> bool {
        self.site(origin).exits.contains(kind)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(crate) fn exit(&mut self, kind: ExitKind, origin: Origin, state: State) -> Exit {
        self.lacks_state |= state.is_none();
        let speculative = &self.speculative_states;
        let (kind, origin) = match speculative.binary_search_by_key(&state, |it| it.0) {
            Ok(position) => match speculative[position].1 {
                head if self.has_exited(head, ExitKind::HoistingFailed) => {
                    (ExitKind::HoistingFailedAgain, head)
                }
                head => (ExitKind::HoistingFailed, head),
            },
            Err(_) => (kind, origin),
        };
        self.exits.push(ExitInfo {
            kind,
            origin,
            culprit: None,
            #[cfg(debug_assertions)]
            made_at: Location::caller(),
        });
        Exit {
            token: Token(self.exits.len() as u32 - 1),
            state,
        }
    }

    pub(crate) fn type_check(&mut self, check: TypeCheck) -> u32 {
        self.types.check(check)
    }

    pub(crate) fn type_check_at(&self, data: u32) -> TypeCheck {
        self.types.at(data)
    }

    pub(crate) fn mode_check(&mut self, check: ModeCheck) -> u32 {
        let found = self.mode_checks.iter().position(|&it| it == check);
        found.unwrap_or_else(|| {
            self.mode_checks.push(check);
            self.mode_checks.len() - 1
        }) as u32
    }

    pub(crate) fn mode_check_at(&self, data: u32) -> ModeCheck {
        self.mode_checks[data as usize]
    }

    pub(crate) fn intern_type(&mut self, wanted: SpeculatedType) -> u32 {
        self.type_check(TypeCheck {
            wanted,
            known: SpeculatedType::BYTECODE_TOP,
            failure: ExitKind::BadType,
        })
    }

    pub(crate) fn interned_type(&self, data: u32) -> SpeculatedType {
        self.type_check_at(data).wanted
    }

    pub(crate) fn prediction(&self, value: Ssa) -> SpeculatedType {
        if let Op::Const64(bits) = *self.function.op(value) {
            return self.type_of_constant(bits.get());
        }
        self.predictions.get(value).copied().unwrap_or_default()
    }

    pub(crate) fn predict(&mut self, value: Ssa, prediction: SpeculatedType) {
        self.predictions
            .grow_to(self.function.value_count(), SpeculatedType::empty());
        self.predictions[value] = prediction;
    }

    pub(crate) fn type_of_constant(&self, bits: u64) -> SpeculatedType {
        SpeculatedType::of_immediate(bits).unwrap_or_else(|| {
            self.cells
                .get(&bits)
                .map_or(SpeculatedType::CELL, |facts| facts.ty)
        })
    }

    /// The bits of a tagged constant.
    pub(crate) fn constant(&self, value: Ssa) -> Option<u64> {
        match *self.function.op(value) {
            Op::Const64(bits) => Some(bits.get()),
            _ => None,
        }
    }

    /// What follows from the instruction alone.
    pub(crate) fn inherent_type(&self, value: Ssa) -> SpeculatedType {
        match *self.function.op(value) {
            Op::Const64(bits) => self.type_of_constant(bits.get()),
            ref op => {
                let declared = (self.declared.get(value).copied()).filter(|ty| !ty.is_empty());
                match op.node().map(|(kind, _)| Kind::of(kind).gives()) {
                    Some(Gives::Value(ty)) => declared.map_or(ty, |it| it & ty),
                    _ => declared.unwrap_or(SpeculatedType::BYTECODE_TOP),
                }
            }
        }
    }

    pub(crate) fn text_of_constant(&self, value: Ssa) -> Option<TextFacts> {
        self.cells.get(&self.constant(self.root(value))?)?.text
    }

    pub(crate) fn note_as_no_cell(&mut self, value: Ssa, origin: Origin) {
        if cfg!(debug_assertions) {
            let position = self.no_cells.partition_point(|it| it.1.0 <= origin.0);
            self.no_cells.insert(position, (value, origin));
        }
    }

    fn is_noted_as_no_cell(&self, root: Ssa, origin: Origin) -> bool {
        let first = self.no_cells.partition_point(|it| it.1.0 < origin.0);
        let mut noted = self.no_cells[first..]
            .iter()
            .take_while(|it| it.1 == origin);
        noted.any(|it| self.root(it.0) == root)
    }

    pub(crate) fn declare(&mut self, value: Ssa, ty: SpeculatedType) {
        (self.declared).grow_to(self.function.value_count(), SpeculatedType::empty());
        self.declared[value] = ty;
    }

    /// For the latest value that has one.
    pub(crate) fn set_profile(&mut self, value: Ssa, profile: Profile) {
        if self
            .profiles
            .last()
            .is_none_or(|last| last.0.index() < value.index())
        {
            self.profiles.push((value, profile));
        }
    }

    pub(crate) fn profile(&self, value: Ssa) -> Option<Profile> {
        let found = self
            .profiles
            .binary_search_by_key(&value.index(), |it| it.0.index());
        Some(self.profiles[found.ok()?].1)
    }

    /// For what may throw at `origin`.
    pub(crate) fn state_for_unwinding(&self, origin: Origin) -> State {
        match self.frame_at(origin).entry.expand() {
            _ if self.site(origin).has_handler => self.site(origin).state_for_handler,
            Some(entry) => self.function.state_of(entry),
            None => State::NONE,
        }
    }

    pub(crate) fn resumes_at(&self, state: State) -> Origin {
        self.layouts[self.function.state_layout(state) as usize].resume
    }

    /// Whether the code that takes over at the state has the instruction that the value comes from still ahead.
    pub(crate) fn makes_again(&self, state: State, value: Ssa) -> bool {
        self.resumes_at(state).0 <= self.function.origin(value).0
    }

    pub(crate) fn inherent_shapes(&self, value: Ssa) -> ShapeSet {
        self.constant(value)
            .and_then(|bits| self.cells.get(&bits))
            .map_or(ShapeSet::ANY, |facts| facts.shapes)
    }

    pub(crate) fn assume(&mut self, assumption: Assumption) {
        if !self.assumptions.contains(&assumption) {
            self.assumptions.push(assumption);
        }
    }

    pub(crate) fn assume_stable(&mut self, set: ShapeSet) {
        for position in 0..self.shapes.members(set).len() {
            self.assume(Assumption::Stable(self.shapes.members(set)[position]));
        }
    }

    /// Whether it holds in the realm of the code at `origin`, in which case the code counts on it from now on.
    pub(crate) fn try_to_assume(&mut self, origin: Origin, which: RealmWatchpoint) -> bool {
        let global = self.frame_at(origin).global;
        let holds = self
            .realms
            .iter()
            .any(|&(realm, holding)| realm == global && holding >> which as u32 & 1 != 0);
        if holds {
            self.assume(Assumption::Realm(global, which));
        }
        holds
    }
}
