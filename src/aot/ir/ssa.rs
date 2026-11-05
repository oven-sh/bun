#[cfg(test)]
mod tests;

use core::ops::ControlFlow;

use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::builder::{
    ENTRY_BLOCK, Edge, FunctionBuilder, LocalVariable, PendingBlock, PendingTarget, Place,
    recycle_vector,
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

impl DominatorLink {
    fn root(block: BlockId) -> DominatorLink {
        DominatorLink {
            parent: block,
            jump: block,
            depth: 0,
            root: block,
        }
    }
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
    is_narrowed: bool,
}

struct NarrowedName {
    value: ValueId,
    origin: ValueId,
    depth: u32,
    block: BlockId,
    read_count: u32,
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
    narrowed_from: FxHashMap<ValueId, NarrowedName>,
}

impl SsaState {
    pub(super) fn recycle(mut self) -> SsaState {
        if self.narrowed_from.capacity() > MAX_SPARE_DEFINITIONS {
            self.narrowed_from = FxHashMap::default();
        }
        self.narrowed_from.clear();
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

    #[inline]
    pub(super) fn add_block(&mut self) {
        self.states.push(BlockState::default());
    }

    #[inline]
    pub(super) fn add_predecessor(&mut self, block: BlockId, predecessor: BlockId) {
        self.states[block.index()].predecessors.push(predecessor);
    }

    #[inline]
    pub(super) fn is_sealed(&self, block: BlockId) -> bool {
        self.states[block.index()].is_sealed
    }

    #[inline]
    pub(super) fn predecessor_count(&self, block: BlockId) -> usize {
        self.states[block.index()].predecessors.len()
    }

    #[inline]
    pub(super) fn variable_count(&self) -> u32 {
        self.variables.len() as u32
    }

    #[inline]
    pub(super) fn create_variable(&mut self, declared: Option<TypeId>) -> LocalVariable {
        let variable = LocalVariable(self.variable_count());
        self.variables.push(VariableState {
            declared,
            stores: StoreCount::Never,
            definition_blocks: SmallVec::new(),
            is_narrowed: false,
        });
        variable
    }

    #[inline]
    fn record_definition_block(&mut self, variable: LocalVariable, block: BlockId) {
        let definition_blocks = &mut self.variables[variable.0 as usize].definition_blocks;
        let is_tracked = definition_blocks.len() <= MAX_SHORTCUT_DEFINITION_BLOCKS;
        if is_tracked && !definition_blocks.contains(&block) {
            definition_blocks.push(block);
        }
    }

    #[inline]
    fn record_observed_value(&mut self, value: ValueId, first_value_of_read: usize) {
        if value.index() >= first_value_of_read && !self.pending_reads.is_empty() {
            self.observed_values.insert(value);
        }
    }

    #[inline]
    fn origin_of(&self, value: ValueId) -> ValueId {
        if self.narrowed_from.is_empty() {
            return value;
        }
        let name = self.narrowed_from.get(&value);
        name.map_or(value, |name| name.origin)
    }

    fn find_value_behind_tests(&self, first: ValueId, second: ValueId) -> Option<ValueId> {
        let origin = self.origin_of(first);
        if origin != self.origin_of(second) {
            return None;
        }
        let (mut first, mut second) = (first, second);
        while first != second {
            if first == origin || second == origin {
                return Some(origin);
            }
            let (first_name, second_name) =
                (&self.narrowed_from[&first], &self.narrowed_from[&second]);
            if first_name.depth >= second_name.depth {
                first = first_name.value;
            }
            if second_name.depth >= first_name.depth {
                second = second_name.value;
            }
        }
        Some(first)
    }

    #[inline]
    fn count_read(&mut self, value: ValueId) {
        if self.narrowed_from.is_empty() {
            return;
        }
        if let Some(name) = self.narrowed_from.get_mut(&value) {
            name.read_count += 1;
        }
    }

    fn take_back_read(&mut self, value: ValueId) {
        if let Some(name) = self.narrowed_from.get_mut(&value) {
            name.read_count -= 1;
        }
    }

    pub(super) fn unread_names(&self) -> impl Iterator<Item = (ValueId, BlockId)> {
        let names = self.narrowed_from.iter();
        let unread = names.filter(|(_, name)| name.read_count == 0);
        unread.map(|(&narrowed, name)| (narrowed, name.block))
    }

    fn join_arriving_values(
        &self,
        variable: LocalVariable,
        first: ValueId,
        second: ValueId,
    ) -> Option<ValueId> {
        if first == second {
            return Some(first);
        }
        let is_narrowed = self.variables[variable.0 as usize].is_narrowed;
        is_narrowed
            .then(|| self.find_value_behind_tests(first, second))
            .flatten()
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
        for &definition_block in definition_blocks.iter() {
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
        if self.states[block.index()].is_loop_header {
            self.link_loop_headers(block);
            return;
        }
        let predecessors = &self.states[block.index()].predecessors;
        let mut headers = predecessors.iter();
        if headers.any(|&predecessor| self.is_unlinked_loop_header(predecessor)) {
            for predecessor in predecessors.clone() {
                self.link_loop_headers(predecessor);
            }
        }
        let link = self.find_link_below(block, &self.states[block.index()].predecessors);
        self.states[block.index()].dominator = Some(link);
    }

    #[inline]
    fn is_unlinked_loop_header(&self, block: BlockId) -> bool {
        let state = &self.states[block.index()];
        state.is_loop_header && state.dominator.is_none()
    }

    fn link_loop_headers(&mut self, mut block: BlockId) {
        let mut unlinked: SmallVec<[BlockId; 4]> = SmallVec::new();
        loop {
            let state = &mut self.states[block.index()];
            if !state.is_loop_header || state.dominator.is_some() {
                break;
            }
            state.dominator = Some(DominatorLink::root(block));
            unlinked.push(block);
            let Some(&entering) = state.predecessors.first() else {
                break;
            };
            block = entering;
        }
        for &header in unlinked.iter().rev() {
            if let Some(&entering) = self.states[header.index()].predecessors.first() {
                self.link_below(header, &[entering]);
            }
        }
    }

    fn link_below(&mut self, block: BlockId, predecessors: &[BlockId]) {
        let link = self.find_link_below(block, predecessors);
        self.states[block.index()].dominator = Some(link);
    }

    #[inline]
    fn find_link_below(&self, block: BlockId, predecessors: &[BlockId]) -> DominatorLink {
        let mut parent = None;
        let mut is_first = true;
        for &predecessor in predecessors {
            let dominator = self.states[predecessor.index()].dominator;
            if dominator.is_some_and(|dominator| self.is_never_entered(dominator.root)) {
                continue;
            }
            parent = if is_first {
                dominator.map(|_| predecessor)
            } else {
                parent.and_then(|parent| self.lowest_common_ancestor(parent, predecessor))
            };
            is_first = false;
        }
        let link = parent.and_then(|parent| {
            let dominator = self.states[parent.index()].dominator?;
            if dominator.root == block {
                return None;
            }
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
        link.unwrap_or_else(|| DominatorLink::root(block))
    }

    #[inline]
    fn is_never_entered(&self, block: BlockId) -> bool {
        if block == ENTRY_BLOCK {
            return false;
        }
        let state = &self.states[block.index()];
        state.is_sealed && state.predecessors.is_empty()
    }

    fn unique_predecessors(&self, block: BlockId) -> Predecessors {
        let mut predecessors = Predecessors::new();
        let mut is_sorted = true;
        for &predecessor in self.states[block.index()].predecessors.iter() {
            if self.is_never_entered(predecessor) || predecessors.last() == Some(&predecessor) {
                continue;
            }
            is_sorted &= predecessors.last() < Some(&predecessor);
            predecessors.push(predecessor);
        }
        if !is_sorted {
            predecessors.sort_unstable();
            predecessors.dedup();
        }
        predecessors
    }
}

#[inline]
fn for_each_edge_target(
    predecessor: &mut PendingBlock,
    block: BlockId,
    mut visit: impl FnMut(&mut PendingTarget),
) {
    if let Some(terminator) = &mut predecessor.terminator {
        for target in terminator.targets.iter_mut() {
            if target.block == block {
                visit(target);
            }
        }
    }
    if let Some(handler) = &mut predecessor.handler
        && handler.block == block
    {
        visit(handler);
    }
}

impl FunctionBuilder {
    pub fn write_variable(&mut self, variable: LocalVariable, value: ValueId) {
        if self.must_split_before_store(variable) {
            self.split_current_block();
        }
        self.define_variable(variable, value);
    }

    pub fn write_variable_kept_in_field(&mut self, variable: LocalVariable, value: ValueId) {
        let covering = self.blocks[self.current_block.index()].covering;
        if !covering.is_some_and(|covering| covering.reads_fields)
            && self.must_split_before_store(variable)
        {
            self.split_current_block();
        }
        self.define_variable(variable, value);
    }

    fn define_variable(&mut self, variable: LocalVariable, value: ValueId) {
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

    pub fn write_variable_at(&mut self, place: Place, variable: LocalVariable, value: ValueId) {
        let covering = self.blocks[place.block.index()].covering;
        assert!(
            covering.is_none_or(|covering| variable.0 >= covering.visible_variable_count),
            "a store that a handler sees begins a block"
        );
        let state = &mut self.ssa.variables[variable.0 as usize];
        debug_assert!(matches!(state.stores, StoreCount::Never));
        state.stores = StoreCount::Once(value, place.block);
        self.ssa.definitions.insert(place.block, variable, value);
        self.ssa.record_definition_block(variable, place.block);
    }

    pub fn value_behind_tests(&self, value: ValueId) -> ValueId {
        self.ssa.origin_of(value)
    }

    pub fn write_narrowed_variable(
        &mut self,
        variable: LocalVariable,
        narrowed: ValueId,
        value: ValueId,
    ) {
        let tested = self.ssa.narrowed_from.get(&value);
        let name = NarrowedName {
            value,
            origin: tested.map_or(value, |tested| tested.origin),
            depth: tested.map_or(0, |tested| tested.depth) + 1,
            block: self.current_block,
            read_count: 0,
        };
        self.ssa.narrowed_from.insert(narrowed, name);
        self.ssa.variables[variable.0 as usize].is_narrowed = true;
        self.write_variable(variable, narrowed);
    }

    pub fn is_undefined_or_null(&self, value: ValueId) -> bool {
        matches!(
            self.opcode_of(value),
            Some(Opcode::Undefined | Opcode::Null)
        )
    }

    pub fn is_constant(&self, value: ValueId) -> bool {
        matches!(
            self.opcode_of(value),
            Some(
                Opcode::Undefined
                    | Opcode::Null
                    | Opcode::Boolean
                    | Opcode::Integer
                    | Opcode::Double
                    | Opcode::String
                    | Opcode::BigInt
            )
        )
    }

    pub fn is_new_closure(&self, value: ValueId) -> bool {
        matches!(self.opcode_of(value), Some(Opcode::NewClosure))
    }

    pub fn write_released_variable(&mut self, variable: LocalVariable, assigned: ValueId) {
        let released = self.read_variable(variable);
        self.write_variable(variable, assigned);
        if self.is_open() && !self.is_undefined_or_null(released) {
            self.release_hint(released);
        }
    }

    fn must_split_before_store(&self, variable: LocalVariable) -> bool {
        let block = &self.blocks[self.current_block.index()];
        let Some(covering) = block.covering else {
            return false;
        };
        let is_visible = variable.0 < covering.visible_variable_count;
        self.is_open() && is_visible && block.value_count != 0
    }

    fn split_current_block(&mut self) {
        let covering = self.handler_of(self.current_block);
        let next = self.create_block(covering);
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
        let has_incomplete_variables = !state.incomplete_variables.is_empty();
        self.ssa.link_dominator(block);
        if has_incomplete_variables {
            self.complete_variables(block);
        }
    }

    fn complete_variables(&mut self, block: BlockId) {
        let state = &mut self.ssa.states[block.index()];
        let incomplete_variables = core::mem::take(&mut state.incomplete_variables);
        for variable in incomplete_variables {
            for predecessor in self.ssa.unique_predecessors(block) {
                let value = self.read_variable_in(variable, predecessor);
                self.append_argument(predecessor, block, value);
            }
        }
    }

    pub fn read_variable(&mut self, variable: LocalVariable) -> ValueId {
        let value = self.read_variable_in(variable, self.current_block);
        self.ssa.count_read(value);
        value
    }

    #[inline]
    fn read_variable_in(&mut self, variable: LocalVariable, block: BlockId) -> ValueId {
        if let Some(value) = self.ssa.find_dominating_store(variable, block) {
            return value;
        }
        self.read_variable_without_dominating_store(variable, block)
    }

    fn read_variable_without_dominating_store(
        &mut self,
        variable: LocalVariable,
        mut block: BlockId,
    ) -> ValueId {
        debug_assert!(
            self.ssa.pending_reads.is_empty() && self.ssa.observed_values.is_empty(),
            "a read ends before the next one begins"
        );
        let first_value_of_read = self.values.len();
        loop {
            let value = self.find_definition(variable, block, first_value_of_read);
            match self.resolve_pending_reads(variable, value) {
                ControlFlow::Continue(predecessor) => block = predecessor,
                ControlFlow::Break(value) => {
                    if !self.ssa.observed_values.is_empty() {
                        self.ssa.observed_values.clear();
                    }
                    return value;
                }
            }
        }
    }

    fn find_definition(
        &mut self,
        variable: LocalVariable,
        mut block: BlockId,
        first_value_of_read: usize,
    ) -> ValueId {
        let mut single_predecessor_run = 0;
        loop {
            if let Some(definition) = self.ssa.definitions.get(block, variable) {
                (self.ssa).record_observed_value(definition, first_value_of_read);
                return definition;
            }
            let should_try_shortcut =
                self.ssa.predecessor_count(block) != 1 || single_predecessor_run % 4 == 3;
            if should_try_shortcut {
                match self.ssa.find_shortcut(variable, block) {
                    Shortcut::Value(definition) => {
                        (self.ssa).record_observed_value(definition, first_value_of_read);
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
                    join.single_value = match (join.next, join.single_value) {
                        (0, _) => Some(value),
                        (_, Some(single)) => self.ssa.join_arriving_values(variable, single, value),
                        (_, None) => None,
                    };
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
        let value = self.append_operation(block, Opcode::Undefined, None, &[], true);
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
        let ssa = &mut self.ssa;
        for &predecessor in predecessors {
            for_each_edge_target(&mut self.blocks[predecessor.index()], block, |target| {
                if let Some(argument) = target.variable_arguments.pop() {
                    ssa.take_back_read(argument);
                }
            });
        }
        if parameter.index() + 1 == self.values.len() {
            self.values.pop();
        }
        true
    }

    fn append_argument(&mut self, predecessor: BlockId, block: BlockId, value: ValueId) {
        let ssa = &mut self.ssa;
        for_each_edge_target(&mut self.blocks[predecessor.index()], block, |target| {
            target.variable_arguments.push(value);
            ssa.count_read(value);
        });
    }
}
