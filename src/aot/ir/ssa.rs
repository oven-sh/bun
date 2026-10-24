#[cfg(test)]
mod tests;

use core::ops::ControlFlow;

use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::builder::{
    ENTRY_BLOCK, Edge, FunctionBuilder, LocalVariable, PendingBlock, PendingDefinition,
    PendingTarget, PendingValue, recycle_vector,
};
use super::generated::{BlockRole, Opcode, TerminatorKind};
use super::ids::{BlockId, Id, TypeId, ValueId};

const MAX_SPARE_DEFINITIONS: usize = 1 << 10;
const MAX_SPARE_OBSERVED_VALUES: usize = 1 << 10;
const MAX_SPARE_BLOCK_STATES: usize = 1 << 12;
const MAX_SPARE_PENDING_READS: usize = 1 << 12;
const MAX_SPARE_VARIABLES: usize = 1 << 12;
pub(super) const MAX_SHORTCUT_DEFINITION_BLOCKS: usize = 8;

type Predecessors = SmallVec<[BlockId; 2]>;

#[derive(Default)]
struct Definitions(FxHashMap<u64, ValueId>);

impl Definitions {
    #[inline]
    fn key(block: BlockId, variable: LocalVariable) -> u64 {
        ((block.index() as u64) << 32) | u64::from(variable.0)
    }

    #[inline]
    fn get(&self, block: BlockId, variable: LocalVariable) -> Option<ValueId> {
        self.0.get(&Definitions::key(block, variable)).copied()
    }

    #[inline]
    fn insert(&mut self, block: BlockId, variable: LocalVariable, value: ValueId) {
        self.0.insert(Definitions::key(block, variable), value);
    }
}

#[derive(Default)]
struct BlockState {
    predecessors: Predecessors,
    is_sealed: bool,
    is_loop_header: bool,
    incomplete_variables: Vec<LocalVariable>,
    dominator: Option<DominatorLink>,
}

#[derive(Copy, Clone)]
struct DominatorLink {
    parent: BlockId,
    jump: BlockId,
    depth: u32,
    root: BlockId,
}

enum Shortcut {
    No,
    To(BlockId),
    Value(ValueId),
}

#[derive(Copy, Clone)]
enum StoreCount {
    Never,
    Once(ValueId, BlockId),
    Many,
}

struct VariableState {
    declared: Option<TypeId>,
    stores: StoreCount,
    definition_blocks: SmallVec<[BlockId; 4]>,
}

struct PendingJoin {
    block: BlockId,
    parameter: ValueId,
    predecessors: Predecessors,
    next: usize,
    single_value: Option<ValueId>,
}

enum PendingRead {
    SinglePredecessor(BlockId),
    Join(PendingJoin),
}

#[derive(Default)]
pub(super) struct SsaState {
    states: Vec<BlockState>,
    definitions: Definitions,
    pending_reads: Vec<PendingRead>,
    observed_values: FxHashSet<ValueId>,
    variables: Vec<VariableState>,
}

impl SsaState {
    pub(super) fn recycle(mut self) -> SsaState {
        if self.definitions.0.capacity() > MAX_SPARE_DEFINITIONS {
            self.definitions = Definitions::default();
        }
        if self.observed_values.capacity() > MAX_SPARE_OBSERVED_VALUES {
            self.observed_values = FxHashSet::default();
        }
        self.definitions.0.clear();
        self.observed_values.clear();
        SsaState {
            states: recycle_vector(self.states, MAX_SPARE_BLOCK_STATES),
            pending_reads: recycle_vector(self.pending_reads, MAX_SPARE_PENDING_READS),
            variables: recycle_vector(self.variables, MAX_SPARE_VARIABLES),
            ..self
        }
    }

    pub(super) fn add_block(&mut self) {
        self.states.push(BlockState::default());
    }

    pub(super) fn add_predecessor(&mut self, block: BlockId, predecessor: BlockId) {
        self.states[block.index()].predecessors.push(predecessor);
    }

    pub(super) fn is_sealed(&self, block: BlockId) -> bool {
        self.states[block.index()].is_sealed
    }

    pub(super) fn predecessor_count(&self, block: BlockId) -> usize {
        self.states[block.index()].predecessors.len()
    }

    pub(super) fn variable_count(&self) -> u32 {
        self.variables.len() as u32
    }

    pub(super) fn create_variable(&mut self, declared: Option<TypeId>) -> LocalVariable {
        let variable = LocalVariable(self.variable_count());
        self.variables.push(VariableState {
            declared,
            stores: StoreCount::Never,
            definition_blocks: SmallVec::new(),
        });
        variable
    }

    fn record_definition_block(&mut self, variable: LocalVariable, block: BlockId) {
        let definition_blocks = &mut self.variables[variable.0 as usize].definition_blocks;
        let is_tracked = definition_blocks.len() <= MAX_SHORTCUT_DEFINITION_BLOCKS;
        if is_tracked && !definition_blocks.contains(&block) {
            definition_blocks.push(block);
        }
    }

    fn record_observed_value(&mut self, value: ValueId) {
        if !self.pending_reads.is_empty() {
            self.observed_values.insert(value);
        }
    }

    fn find_dominating_store(&self, variable: LocalVariable, block: BlockId) -> Option<ValueId> {
        let StoreCount::Once(value, definition_block) = self.variables[variable.0 as usize].stores
        else {
            return None;
        };
        let dominator = self.states[definition_block.index()].dominator?;
        (self.ancestor_at(block, dominator.depth) == Some(definition_block)).then_some(value)
    }

    fn find_shortcut(&self, variable: LocalVariable, block: BlockId) -> Shortcut {
        let definition_blocks = &self.variables[variable.0 as usize].definition_blocks;
        let is_tracked = definition_blocks.len() <= MAX_SHORTCUT_DEFINITION_BLOCKS;
        let (true, Some(current)) = (is_tracked, self.states[block.index()].dominator) else {
            return Shortcut::No;
        };
        let mut nearest: Option<(u32, bool)> = None;
        for &definition_block in definition_blocks {
            let dominator = self.states[definition_block.index()].dominator;
            if dominator.is_none_or(|dominator| dominator.root != current.root) {
                continue;
            }
            let Some(ancestor) = self.lowest_common_ancestor(definition_block, block) else {
                continue;
            };
            if ancestor == block && definition_block != block {
                continue;
            }
            let dominator = self.states[ancestor.index()].dominator;
            let depth = dominator.map_or(0, |dominator| dominator.depth);
            let level = if ancestor == definition_block {
                (depth, true)
            } else {
                (depth + 1, false)
            };
            nearest = nearest.max(Some(level));
        }
        match nearest {
            None if current.root != block => Shortcut::To(current.root),
            None => Shortcut::No,
            Some((depth, _)) if depth >= current.depth => Shortcut::No,
            Some((depth, is_definition)) => match (self.ancestor_at(block, depth), is_definition) {
                (Some(definition_block), true) => {
                    let definition = self.definitions.get(definition_block, variable);
                    definition.map_or(Shortcut::No, Shortcut::Value)
                }
                (Some(join), false) => Shortcut::To(join),
                (None, _) => Shortcut::No,
            },
        }
    }

    fn ancestor_at(&self, mut block: BlockId, depth: u32) -> Option<BlockId> {
        loop {
            let dominator = self.states[block.index()].dominator?;
            if dominator.depth <= depth {
                return Some(block);
            }
            let jump = self.states[dominator.jump.index()].dominator?;
            block = if jump.depth >= depth {
                dominator.jump
            } else {
                dominator.parent
            };
        }
    }

    fn lowest_common_ancestor(&self, a: BlockId, b: BlockId) -> Option<BlockId> {
        let depth_a = self.states[a.index()].dominator?.depth;
        let depth_b = self.states[b.index()].dominator?.depth;
        let depth = depth_a.min(depth_b);
        let (mut a, mut b) = (self.ancestor_at(a, depth)?, self.ancestor_at(b, depth)?);
        while a != b {
            let dominator_a = self.states[a.index()].dominator?;
            let dominator_b = self.states[b.index()].dominator?;
            if dominator_a.depth == 0 {
                return None;
            }
            (a, b) = if dominator_a.jump != dominator_b.jump {
                (dominator_a.jump, dominator_b.jump)
            } else {
                (dominator_a.parent, dominator_b.parent)
            };
        }
        Some(a)
    }

    fn link_dominator(&mut self, block: BlockId) {
        let predecessors = &self.states[block.index()].predecessors;
        let first = predecessors.first().copied();
        let mut parent =
            first.filter(|predecessor| self.states[predecessor.index()].dominator.is_some());
        for &predecessor in predecessors.iter().skip(1) {
            parent = parent.and_then(|parent| self.lowest_common_ancestor(parent, predecessor));
        }
        let link = parent.and_then(|parent| {
            let dominator = self.states[parent.index()].dominator?;
            let jump = self.states[dominator.jump.index()].dominator?;
            let next_jump = self.states[jump.jump.index()].dominator?;
            let is_even = dominator.depth - jump.depth == jump.depth - next_jump.depth;
            Some(DominatorLink {
                parent,
                jump: if is_even { jump.jump } else { parent },
                depth: dominator.depth + 1,
                root: dominator.root,
            })
        });
        let root = DominatorLink {
            parent: block,
            jump: block,
            depth: 0,
            root: block,
        };
        self.states[block.index()].dominator = Some(link.unwrap_or(root));
    }

    fn is_never_entered(&self, block: BlockId) -> bool {
        let state = &self.states[block.index()];
        block != ENTRY_BLOCK && state.is_sealed && state.predecessors.is_empty()
    }

    // A block is a predecessor of its handler from its creation, also the block that follows a `return` or a `throw`.
    fn unique_predecessors(&self, block: BlockId) -> Predecessors {
        let mut predecessors = self.states[block.index()].predecessors.clone();
        predecessors.retain(|predecessor| !self.is_never_entered(*predecessor));
        predecessors.sort_unstable();
        predecessors.dedup();
        predecessors
    }
}

fn edge_targets(
    predecessor: &mut PendingBlock,
    block: BlockId,
) -> impl Iterator<Item = &mut PendingTarget> {
    let terminator = predecessor.terminator.iter_mut();
    let targets = terminator.flat_map(|terminator| terminator.targets.iter_mut());
    let targets = targets.chain(predecessor.handler.iter_mut());
    targets.filter(move |target| target.block == block)
}

impl FunctionBuilder {
    pub fn write_variable(&mut self, variable: LocalVariable, value: ValueId) {
        if self.must_split_before_store(variable) {
            self.split_current_block();
        }
        let (block, is_open) = (self.current_block, self.is_open());
        self.ssa.definitions.insert(block, variable, value);
        self.ssa.record_definition_block(variable, block);
        let stores = &mut self.ssa.variables[variable.0 as usize].stores;
        *stores = match *stores {
            StoreCount::Never => StoreCount::Once(value, block),
            StoreCount::Once(_, definition_block) if definition_block == block && is_open => {
                StoreCount::Once(value, definition_block)
            }
            StoreCount::Once(..) | StoreCount::Many => StoreCount::Many,
        };
    }

    fn must_split_before_store(&self, variable: LocalVariable) -> bool {
        let block = &self.blocks[self.current_block.index()];
        let Some(covering) = block.covering else {
            return false;
        };
        let is_visible = variable.0 < covering.visible_variable_count;
        self.is_open() && is_visible && !block.values.is_empty()
    }

    fn split_current_block(&mut self) {
        let current = self.current_block;
        let covering = self.handler_of(current);
        let next = self.create_block(covering);
        self.blocks[next.index()].frequency = self.blocks[current.index()].frequency;
        self.terminate(TerminatorKind::Jump, &[], &[Edge::to(next)]);
        self.seal(next);
        self.switch_to(next);
    }

    pub fn declare_loop_header(&mut self, block: BlockId, modified: &[LocalVariable]) {
        let pending = &self.blocks[block.index()];
        debug_assert!(
            !self.ssa.is_sealed(block),
            "a loop header is declared before its back edges"
        );
        debug_assert!(
            pending.variable_parameters.is_empty(),
            "a loop header has no variable parameter yet"
        );
        self.ssa.states[block.index()].is_loop_header = true;
        for &variable in modified {
            if self.ssa.definitions.get(block, variable).is_none() {
                self.create_incomplete_parameter(variable, block);
            }
        }
    }

    pub fn seal(&mut self, block: BlockId) {
        let state = &mut self.ssa.states[block.index()];
        if state.is_sealed {
            return;
        }
        state.is_sealed = true;
        let incomplete_variables = core::mem::take(&mut state.incomplete_variables);
        self.ssa.link_dominator(block);
        for variable in incomplete_variables {
            for predecessor in self.ssa.unique_predecessors(block) {
                let value = self.read_variable_in(variable, predecessor);
                self.append_argument(predecessor, block, value);
            }
        }
    }

    pub fn read_variable(&mut self, variable: LocalVariable) -> ValueId {
        self.read_variable_in(variable, self.current_block)
    }

    fn read_variable_in(&mut self, variable: LocalVariable, mut block: BlockId) -> ValueId {
        if let Some(value) = self.ssa.find_dominating_store(variable, block) {
            return value;
        }
        debug_assert!(
            self.ssa.pending_reads.is_empty() && self.ssa.observed_values.is_empty(),
            "a read ends before the next one begins"
        );
        loop {
            let value = self.find_definition(variable, block);
            match self.resolve_pending_reads(variable, value) {
                ControlFlow::Continue(predecessor) => block = predecessor,
                ControlFlow::Break(value) => {
                    self.ssa.observed_values.clear();
                    return value;
                }
            }
        }
    }

    fn find_definition(&mut self, variable: LocalVariable, mut block: BlockId) -> ValueId {
        let mut single_predecessor_run = 0;
        loop {
            if let Some(definition) = self.ssa.definitions.get(block, variable) {
                self.ssa.record_observed_value(definition);
                return definition;
            }
            let should_try_shortcut =
                self.ssa.predecessor_count(block) != 1 || single_predecessor_run % 4 == 3;
            if should_try_shortcut {
                match self.ssa.find_shortcut(variable, block) {
                    Shortcut::Value(definition) => {
                        self.ssa.record_observed_value(definition);
                        return definition;
                    }
                    Shortcut::To(ancestor) => {
                        block = ancestor;
                        continue;
                    }
                    Shortcut::No => {}
                }
            }
            let state = &self.ssa.states[block.index()];
            let (is_sealed, predecessor_count) = (state.is_sealed, state.predecessors.len());
            let is_pass_through = state.is_loop_header || (is_sealed && predecessor_count == 1);
            let is_run_exhausted = single_predecessor_run > self.ssa.states.len();
            if is_pass_through && predecessor_count > 0 && !is_run_exhausted {
                let pending_read = PendingRead::SinglePredecessor(block);
                block = state.predecessors[0];
                self.ssa.pending_reads.push(pending_read);
                single_predecessor_run += 1;
                continue;
            }
            if !is_sealed {
                return self.create_incomplete_parameter(variable, block);
            }
            if predecessor_count == 0 || is_run_exhausted {
                return self.create_undefined_value(variable, block);
            }
            let predecessors = self.ssa.unique_predecessors(block);
            let Some(&first) = predecessors.first() else {
                return self.create_undefined_value(variable, block);
            };
            let parameter = self.add_variable_parameter(variable, block);
            self.ssa.definitions.insert(block, variable, parameter);
            let pending_read = PendingRead::Join(PendingJoin {
                block,
                parameter,
                predecessors,
                next: 0,
                single_value: None,
            });
            self.ssa.pending_reads.push(pending_read);
            block = first;
            single_predecessor_run = 0;
        }
    }

    fn resolve_pending_reads(
        &mut self,
        variable: LocalVariable,
        mut value: ValueId,
    ) -> ControlFlow<ValueId, BlockId> {
        while let Some(pending_read) = self.ssa.pending_reads.pop() {
            match pending_read {
                PendingRead::SinglePredecessor(successor) => {
                    self.ssa.definitions.insert(successor, variable, value);
                }
                PendingRead::Join(mut join) => {
                    self.append_argument(join.predecessors[join.next], join.block, value);
                    let is_single_value = join.next == 0 || join.single_value == Some(value);
                    join.single_value = is_single_value.then_some(value);
                    join.next += 1;
                    if let Some(&predecessor) = join.predecessors.get(join.next) {
                        self.ssa.pending_reads.push(PendingRead::Join(join));
                        return ControlFlow::Continue(predecessor);
                    }
                    value = self.resolve_join(variable, &join);
                }
            }
        }
        ControlFlow::Break(value)
    }

    fn resolve_join(&mut self, variable: LocalVariable, join: &PendingJoin) -> ValueId {
        let (block, parameter) = (join.block, join.parameter);
        let is_observed = self.ssa.observed_values.contains(&parameter);
        if let Some(value) = join.single_value
            && value != parameter
            && !is_observed
            && self.try_remove_parameter(block, parameter, &join.predecessors)
        {
            self.ssa.definitions.insert(block, variable, value);
            return value;
        }
        self.ssa.variables[variable.0 as usize].stores = StoreCount::Many;
        self.ssa.record_definition_block(variable, block);
        parameter
    }

    fn add_variable_parameter(&mut self, variable: LocalVariable, block: BlockId) -> ValueId {
        let pending = &self.blocks[block.index()];
        debug_assert!(
            pending.role == BlockRole::Ordinary || variable.0 < pending.visible_variable_count,
            "a handler reads only variables created before it"
        );
        let declared = self.ssa.variables[variable.0 as usize].declared;
        let parameter = self.add_parameter_value(declared);
        let pending = &mut self.blocks[block.index()];
        pending.variable_parameters.push(parameter);
        parameter
    }

    fn create_incomplete_parameter(&mut self, variable: LocalVariable, block: BlockId) -> ValueId {
        let parameter = self.add_variable_parameter(variable, block);
        let state = &mut self.ssa.states[block.index()];
        state.incomplete_variables.push(variable);
        self.record_computed_definition(variable, block, parameter);
        parameter
    }

    fn create_undefined_value(&mut self, variable: LocalVariable, block: BlockId) -> ValueId {
        let value = ValueId::new(self.values.len());
        self.values.push(PendingValue {
            definition: PendingDefinition::Operation {
                opcode: Opcode::Undefined,
                fields: 0..0,
            },
            position: None,
        });
        self.blocks[block.index()].values.insert(0, value);
        self.record_computed_definition(variable, block, value);
        value
    }

    fn record_computed_definition(
        &mut self,
        variable: LocalVariable,
        block: BlockId,
        value: ValueId,
    ) {
        self.ssa.definitions.insert(block, variable, value);
        self.ssa.variables[variable.0 as usize].stores = StoreCount::Many;
        self.ssa.record_definition_block(variable, block);
    }

    fn try_remove_parameter(
        &mut self,
        block: BlockId,
        parameter: ValueId,
        predecessors: &[BlockId],
    ) -> bool {
        let variable_parameters = &mut self.blocks[block.index()].variable_parameters;
        if variable_parameters.last() != Some(&parameter) {
            return false;
        }
        variable_parameters.pop();
        for &predecessor in predecessors {
            for target in edge_targets(&mut self.blocks[predecessor.index()], block) {
                target.variable_arguments.pop();
            }
        }
        if parameter.index() + 1 == self.values.len() {
            self.values.pop();
        }
        true
    }

    fn append_argument(&mut self, predecessor: BlockId, block: BlockId, value: ValueId) {
        for target in edge_targets(&mut self.blocks[predecessor.index()], block) {
            target.variable_arguments.push(value);
        }
    }
}
