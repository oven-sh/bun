//! The state of the translation of one function.

use std::rc::Rc;

use bun_engine_bytecode::{BlockIndex, Liveness, Locals, Register};
use bun_engine_codegen::ir::{Block, Edge, State, Value as Ssa};
use bun_engine_vm::{CodeBlock, Gc};
use smallvec::SmallVec;

use super::{Built, Refusal};
use crate::graph::{FrameIndex, FrameInfo, Graph, NO_LAYOUT, SavedKnowledge};

#[derive(Clone, Copy)]
pub(super) enum ArgumentCount {
    InFrame,
    /// Including `this`.
    Known(u32),
}

/// A place where several ways meet.
#[derive(Default)]
pub(super) struct Junction {
    /// What all ways here can still go back to.
    pub(super) checkpoint: Option<State>,
    /// The header of the innermost loop around it that has been entered, which may be itself.
    pub(super) header: Option<BlockIndex>,
    pub(super) block: Option<Block>,
    pub(super) edges: SmallVec<[Edge; 2]>,
    /// For each register that is live, in the order of `Frame::carried`.
    pub(super) values: Vec<Ssa>,
    /// For each parameter of the block, its position in `values`.
    pub(super) params: Vec<u32>,
    pub(super) knowledge: SavedKnowledge,
    /// Not all edges come from where nothing leads.
    pub(super) is_reached: bool,
    /// Ways back to it are built after it, so it is no place to go without translating it.
    pub(super) heads_cycle: bool,
    pub(super) is_entered: bool,
    /// No more edges will leave the block.
    pub(super) is_done: bool,
    /// On some way here, assumptions may have failed since the last invalidation point.
    pub(super) follows_effect: bool,
}

/// The latest state for those who walk the stack.
pub(super) struct Walk {
    /// Without what it has for the callers.
    pub(super) own: SmallVec<[(Register, Ssa); 8]>,
    pub(super) state: State,
}

pub(super) struct Frame {
    pub(super) index: FrameIndex,
    pub(super) code_block: Gc<CodeBlock>,
    pub(super) liveness: Rc<Liveness>,
    pub(super) argument_count: ArgumentCount,
    /// From the last local up to the last argument.
    registers: Vec<Ssa>,
    locals: u32,
    pub(super) in_place: Vec<Register>,
    pub(super) junctions: Vec<Junction>,
    pub(super) is_reducible: bool,
    pub(super) separates_resumptions: bool,
    /// Where the function returns to, if it is inlined.
    pub(super) continuation: Junction,
    pub(super) returned_in_place: Option<(Block, Ssa)>,
    /// The position of the frame that gets the result, and the metadata of the instruction that does.
    pub(super) returns_to: Option<(usize, u32)>,
    /// What a state has for the callers.
    pub(super) caller_layout: u32,
    pub(super) caller_values: Vec<Ssa>,
    pub(super) caller_has_handler: bool,
    pub(super) walk: Walk,
    /// The latest, with the handler of this function that it is for.
    pub(super) state_for_handler: Option<(Option<BlockIndex>, State)>,
    /// For each instruction of the current block, last first, the locals that are live before it.
    pub(super) live_before: Vec<u64>,
    pub(super) words: usize,
    pub(super) offset: u32,
    pub(super) current: BlockIndex,
}

impl Frame {
    /// `slots` is the number of arguments that have a register, including `this`.
    pub(super) fn new(
        graph: &mut Graph,
        info: FrameInfo,
        code_block: Gc<CodeBlock>,
        slots: u32,
        argument_count: ArgumentCount,
    ) -> Built<Self> {
        let liveness = code_block.liveness().map_err(|_| Refusal::TooLarge)?;
        graph.frames.push(info);
        let locals = code_block.locals();
        Ok(Self {
            index: FrameIndex(graph.frames.len() as u32 - 1),
            code_block,
            argument_count,
            registers: vec![Ssa::NONE; (locals + Register::HEADER_WORDS + slots) as usize],
            locals,
            in_place: Vec::new(),
            junctions: (0..liveness.graph().len())
                .map(|_| Junction::default())
                .collect(),
            is_reducible: true,
            separates_resumptions: false,
            continuation: Junction::default(),
            returned_in_place: None,
            returns_to: None,
            caller_layout: NO_LAYOUT,
            caller_values: Vec::new(),
            caller_has_handler: false,
            walk: Walk {
                own: SmallVec::new(),
                state: State::NONE,
            },
            state_for_handler: None,
            live_before: Vec::new(),
            words: locals.div_ceil(64) as usize,
            offset: 0,
            current: BlockIndex(0),
            liveness,
        })
    }

    #[inline]
    fn position(&self, register: Register) -> usize {
        (register.offset() + self.locals as i32) as usize
    }

    #[inline]
    pub(super) fn get(&self, register: Register) -> Ssa {
        self.registers[self.position(register)]
    }

    #[inline]
    pub(super) fn set(&mut self, register: Register, value: Ssa) {
        let position = self.position(register);
        self.registers[position] = value;
    }

    pub(super) fn all_registers(&self) -> &[Ssa] {
        &self.registers
    }

    /// From the first block, for another way through the function.
    pub(super) fn start_over(&mut self, registers: &[Ssa]) {
        self.registers.copy_from_slice(registers);
        (self.junctions.iter_mut()).for_each(|it| *it = Junction::default());
        self.current = BlockIndex(0);
    }

    pub(super) fn is_root(&self) -> bool {
        self.index == FrameIndex::ROOT
    }

    /// `this` and the arguments.
    pub(super) fn argument_registers(&self) -> impl Iterator<Item = Register> + use<> {
        let end = self.registers.len() as i32 - self.locals as i32;
        (Register::THIS.offset()..end).map(Register::from_offset)
    }

    /// What an edge carries to a block at whose start `live` is live.
    pub(super) fn carried<'a>(&self, live: Locals<'a>) -> impl Iterator<Item = Register> + use<'a> {
        self.argument_registers().chain(live.iter())
    }

    /// The frame on the stack has the value at all times.
    pub(super) fn is_in_place(&self, register: Register) -> bool {
        self.in_place.contains(&register)
    }

    pub(super) fn assigned_arguments(&self) -> SmallVec<[Register; 4]> {
        let (graph, body) = (self.liveness.graph(), self.code_block.body());
        let mut assigned = SmallVec::new();
        for block in (0..graph.len() as u32).map(BlockIndex) {
            for (_, instruction) in graph.instructions(body, block) {
                instruction.for_each_def(body, |run, _| {
                    for register in run.registers().filter(|it| it.offset() > 0) {
                        if !assigned.contains(&register) {
                            assigned.push(register);
                        }
                    }
                });
            }
        }
        assigned
    }

    pub(super) fn live_locals(&self) -> impl Iterator<Item = Register> {
        let words = &self.live_before[self.live_before.len() - self.words..];
        words.iter().enumerate().flat_map(|(index, &word)| {
            let bits = core::iter::successors((word != 0).then_some(word), |&rest| {
                Some(rest & (rest - 1)).filter(|&rest| rest != 0)
            });
            bits.map(move |rest| Register::local(index as u32 * 64 + rest.trailing_zeros()))
        })
    }

    pub(super) fn is_in_header(&self) -> bool {
        self.header_around(self.current) == Some(self.current)
    }

    pub(super) fn may_be_in_loop(&self) -> bool {
        !self.is_reducible || self.header_around(self.current).is_some()
    }

    pub(super) fn may_be_jumped_back_to(&self) -> bool {
        self.may_be_in_loop() && self.liveness.graph().range(self.current).start == self.offset
    }

    pub(super) fn header_around(&self, block: BlockIndex) -> Option<BlockIndex> {
        self.junctions[block.index()].header
    }

    pub(super) fn has_handler(&self) -> bool {
        self.caller_has_handler || self.own_handler().is_some()
    }

    pub(super) fn own_handler(&self) -> Option<BlockIndex> {
        self.liveness.graph().handler(self.current)
    }
}
