use smallvec::SmallVec;

use crate::collections::FxHashSet as HashSet;

use crate::collections::IndexMap;
use crate::diagnostics::{CompilerDiagnostic, ErrorCategory, cold_diagnostic, cold_invariant};
use crate::hir::environment::Environment;
use crate::hir::visitors;
use crate::hir::*;

// =============================================================================
// SSABuilder
// =============================================================================

struct IncompletePhi {
    old_place: Place,
    new_place: Place,
}

mod definitions {
    use crate::collections::FxHashMap;
    use crate::hir::{BlockId, IdentifierId};

    const NO_BLOCK: BlockId = BlockId(u32::MAX);

    /// What each variable is at the end of each block.
    pub(super) struct Definitions {
        /// Indexed by the `IdentifierId.0` of the variable: the block that it was last set for, and to what.
        newest: Vec<(BlockId, IdentifierId)>,
        /// What it was last set to for the other blocks.
        others: FxHashMap<u64, IdentifierId>,
        /// Indexed by `BlockId.0`: a bit for each variable, modulo 64, that `others` may have for the block.
        in_others: Vec<u64>,
        /// The phis whose operands are being looked up, by ascending id, and whether `get` has returned that id.
        phis_in_the_making: Vec<(IdentifierId, bool)>,
    }

    #[inline]
    fn key(block_id: BlockId, old: IdentifierId) -> u64 {
        u64::from(block_id.0) << 32 | u64::from(old.0)
    }

    impl Definitions {
        pub(super) fn new(num_blocks: usize, num_identifiers: usize) -> Self {
            Definitions {
                newest: vec![(NO_BLOCK, IdentifierId(0)); num_identifiers],
                others: FxHashMap::default(),
                in_others: vec![0; num_blocks],
                phis_in_the_making: Vec::new(),
            }
        }

        /// The only way to read a definition.
        #[inline]
        pub(super) fn get(&mut self, block_id: BlockId, old: IdentifierId) -> Option<IdentifierId> {
            let new = match self.newest.get(old.0 as usize) {
                Some(&(block, new)) if block == block_id => new,
                _ if self.in_others[block_id.0 as usize] & (1 << (old.0 % 64)) == 0 => return None,
                _ => *self.others.get(&key(block_id, old))?,
            };
            if !self.phis_in_the_making.is_empty() {
                self.was_read(new);
            }
            Some(new)
        }

        fn was_read(&mut self, new: IdentifierId) {
            let phi = self
                .phis_in_the_making
                .binary_search_by_key(&new, |it| it.0);
            if let Ok(index) = phi {
                self.phis_in_the_making[index].1 = true;
            }
        }

        pub(super) fn set(&mut self, block_id: BlockId, old: IdentifierId, new: IdentifierId) {
            let index = old.0 as usize;
            if index >= self.newest.len() {
                self.newest.resize(index + 1, (NO_BLOCK, IdentifierId(0)));
            }
            let (block, was) = std::mem::replace(&mut self.newest[index], (block_id, new));
            if block != block_id && block != NO_BLOCK {
                if self.others.capacity() == 0 {
                    self.others.reserve(self.in_others.len());
                }
                self.others.insert(key(block, old), was);
                self.in_others[block.0 as usize] |= 1 << (old.0 % 64);
            }
        }

        /// `phi` is newer than all ids so far.
        pub(super) fn begin_phi(&mut self, phi: IdentifierId) {
            self.phis_in_the_making.push((phi, false));
        }

        /// Whether `get` has returned the id of the phi that was begun last.
        pub(super) fn end_phi(&mut self) -> bool {
            self.phis_in_the_making
                .pop()
                .is_none_or(|(_, was_read)| was_read)
        }
    }
}

struct State {
    incomplete_phis: Vec<IncompletePhi>,
}

/// A block whose predecessors `get_id_at` is looking in.
enum Lookup {
    OnePredecessor(BlockId),
    Phi {
        block_id: BlockId,
        new_id: IdentifierId,
        operands: SmallVec<[IdentifierId; 4]>,
    },
}

struct SSABuilder {
    /// Indexed by `BlockId.0`. `Some`: the block was started.
    states: Vec<Option<State>>,
    definitions: definitions::Definitions,
    /// Not where the entry has a predecessor: then a variable can be a phi of nothing but phis.
    leaves_out_trivial_phis: bool,
    current: Option<BlockId>,
    /// Indexed by `BlockId.0`.
    unsealed_preds: Vec<Option<u32>>,
    /// Indexed by `BlockId.0`: from where to where in `preds`. Empty = no preds / not registered.
    block_preds: Vec<(u32, u32)>,
    preds: Vec<BlockId>,
    unknown: HashSet<IdentifierId>,
    context: HashSet<IdentifierId>,
    /// Indexed by `BlockId.0`.
    pending_phis: Vec<Vec<Phi>>,
    processed_functions: Vec<FunctionId>,
    /// Empty between the calls of `get_id_at`.
    lookups: Vec<Lookup>,
}

impl SSABuilder {
    fn new(num_blocks: usize, num_identifiers: usize) -> Self {
        let mut states = Vec::with_capacity(num_blocks);
        states.resize_with(num_blocks, || None);
        SSABuilder {
            states,
            definitions: definitions::Definitions::new(num_blocks, num_identifiers),
            leaves_out_trivial_phis: false,
            current: None,
            unsealed_preds: vec![None; num_blocks],
            block_preds: vec![(0, 0); num_blocks],
            preds: Vec::with_capacity(num_blocks),
            unknown: HashSet::default(),
            context: HashSet::default(),
            pending_phis: vec![Vec::new(); num_blocks],
            processed_functions: Vec::new(),
            lookups: Vec::new(),
        }
    }

    fn define_function(&mut self, func: &HirFunction) {
        for (id, block) in &func.body.blocks {
            let start = self.preds.len() as u32;
            self.preds.extend(&block.preds);
            self.block_preds[id.0 as usize] = (start, self.preds.len() as u32);
        }
    }

    #[inline]
    fn preds(&self, block_id: BlockId) -> &[BlockId] {
        let (start, end) = self.block_preds[block_id.0 as usize];
        &self.preds[start as usize..end as usize]
    }

    #[inline]
    fn is_started(&self, block_id: BlockId) -> bool {
        self.states[block_id.0 as usize].is_some()
    }

    fn make_id(&mut self, old_id: IdentifierId, env: &mut Environment) -> IdentifierId {
        let new_id = env.next_identifier_id();
        let old = &env.identifiers[old_id.0 as usize];
        let declaration_id = old.declaration_id;
        let name = old.name.clone();
        let loc = old.loc;
        let new_ident = &mut env.identifiers[new_id.0 as usize];
        new_ident.declaration_id = declaration_id;
        new_ident.name = name;
        new_ident.loc = loc;
        new_id
    }

    /// The identifier that is to stand in `old_place`, which is written.
    fn define_place(
        &mut self,
        old_place: &Place,
        env: &mut Environment,
    ) -> Result<IdentifierId, CompilerDiagnostic> {
        let old_id = old_place.identifier;

        if self.unknown.contains(&old_id) {
            let ident = &env.identifiers[old_id.0 as usize];
            let name = match &ident.name {
                Some(name) => format!("{}${}", bun_core::BStr::new(name.value()), old_id.0),
                None => format!("${}", old_id.0),
            };
            return Err(cold_diagnostic(
                ErrorCategory::Todo,
                "[hoisting] EnterSSA: Expected identifier to be defined before being used",
                Some(format!("Identifier {} is undefined", name)),
                old_place.loc,
            )
            .into());
        }

        // Do not redefine context references.
        if self.context.contains(&old_id) {
            return Ok(self.get_place(old_place, env));
        }

        let new_id = self.make_id(old_id, env);
        let current = self
            .current
            .expect("we need to be in a block to access state!");
        self.definitions.set(current, old_id, new_id);
        Ok(new_id)
    }

    /// A function's context places capture a *binding*, not a value: the
    /// variable is only read when the function is later called, so a context
    /// place may reference a binding that is declared after the function
    /// expression itself (eg `const colgroup = useMemo(() => <colgroup>...)`,
    /// where the JSX tag name resolves to the variable being assigned). Unmark
    /// such identifiers so the later declaration doesn't error; if the function
    /// body actually *reads* the variable before it is defined, visiting the
    /// body re-marks it and the hoisting bailout in define_place still applies.
    fn unmark_unknown(&mut self, id: IdentifierId) {
        self.unknown.remove(&id);
    }

    /// The identifier that is to stand in `old_place`, which is read.
    #[inline]
    fn get_place(&mut self, old_place: &Place, env: &mut Environment) -> IdentifierId {
        let current_id = self.current.expect("must be in a block");
        match self.definitions.get(current_id, old_place.identifier) {
            Some(new_id) => new_id,
            None => self.get_id_at(old_place, current_id, env),
        }
    }

    fn get_id_at(
        &mut self,
        old_place: &Place,
        block_id: BlockId,
        env: &mut Environment,
    ) -> IdentifierId {
        let old_id = old_place.identifier;
        let mut lookups = std::mem::take(&mut self.lookups);
        let mut block_id = block_id;
        loop {
            let mut found = match self.look_in(old_place, block_id, env) {
                Ok(found) => found,
                Err(lookup) => {
                    block_id = self.preds(block_id)[0];
                    // A block need not remember what its one predecessor knows.
                    let known = match lookup {
                        Lookup::OnePredecessor(_) => self.definitions.get(block_id, old_id),
                        Lookup::Phi { .. } => None,
                    };
                    let Some(found) = known else {
                        lookups.push(lookup);
                        continue;
                    };
                    found
                }
            };
            // What was found is what the variable is at the end of a predecessor of the last of `lookups`.
            loop {
                match lookups.pop() {
                    None => {
                        self.lookups = lookups;
                        return found;
                    }
                    Some(Lookup::OnePredecessor(block_id)) => {
                        self.definitions.set(block_id, old_id, found);
                    }
                    Some(Lookup::Phi {
                        block_id: phi_block,
                        new_id,
                        mut operands,
                    }) => {
                        operands.push(found);
                        if let Some(&next) = self.preds(phi_block).get(operands.len()) {
                            block_id = next;
                            lookups.push(Lookup::Phi {
                                block_id: phi_block,
                                new_id,
                                operands,
                            });
                            break;
                        }
                        found = self.finish_phi(phi_block, old_place, new_id, &operands);
                    }
                }
            }
        }
    }

    /// What `old_place` is at the end of the block, or that it depends on its predecessors. Then it has one at least.
    fn look_in(
        &mut self,
        old_place: &Place,
        block_id: BlockId,
        env: &mut Environment,
    ) -> Result<IdentifierId, Lookup> {
        if let Some(new_id) = self.definitions.get(block_id, old_place.identifier) {
            return Ok(new_id);
        }

        let preds_len = self.preds(block_id).len();

        if preds_len == 0 {
            self.unknown.insert(old_place.identifier);
            return Ok(old_place.identifier);
        }

        let unsealed = self.unsealed_preds[block_id.0 as usize].unwrap_or(0);
        if unsealed > 0 {
            let new_id = self.make_id(old_place.identifier, env);
            let new_place = Place {
                identifier: new_id,
                effect: old_place.effect,
                reactive: old_place.reactive,
                loc: old_place.loc,
            };
            let state = self.states[block_id.0 as usize].as_mut().unwrap();
            state.incomplete_phis.push(IncompletePhi {
                old_place: old_place.clone(),
                new_place,
            });
            self.definitions.set(block_id, old_place.identifier, new_id);
            return Ok(new_id);
        }

        if preds_len == 1 {
            return Err(Lookup::OnePredecessor(block_id));
        }

        let new_id = self.make_id(old_place.identifier, env);
        self.definitions.set(block_id, old_place.identifier, new_id);
        self.definitions.begin_phi(new_id);
        Err(Lookup::Phi {
            block_id,
            new_id,
            operands: SmallVec::new(),
        })
    }

    /// What `old_place` is at the end of the block, now that it is known for each predecessor.
    fn finish_phi(
        &mut self,
        block_id: BlockId,
        old_place: &Place,
        new_id: IdentifierId,
        operands: &[IdentifierId],
    ) -> IdentifierId {
        let was_read = self.definitions.end_phi();
        // Braun et al.'s trivial phi, where nothing has its id yet: EliminateRedundantPhi would put `same` for it.
        if self.leaves_out_trivial_phis
            && !was_read
            && let Some(&same) = operands.first()
            && operands.iter().all(|&operand| operand == same)
        {
            self.definitions.set(block_id, old_place.identifier, same);
            return same;
        }
        let new_place = Place {
            identifier: new_id,
            effect: old_place.effect,
            reactive: old_place.reactive,
            loc: old_place.loc,
        };
        self.push_phi(block_id, old_place, &new_place, operands);
        new_id
    }

    /// What `old_place` is at the end of each predecessor of the block, in their order.
    fn phi_operands(
        &mut self,
        block_id: BlockId,
        old_place: &Place,
        env: &mut Environment,
    ) -> SmallVec<[IdentifierId; 4]> {
        (0..self.preds(block_id).len())
            .map(|index| self.get_id_at(old_place, self.preds(block_id)[index], env))
            .collect()
    }

    fn add_phi(
        &mut self,
        block_id: BlockId,
        old_place: &Place,
        new_place: &Place,
        env: &mut Environment,
    ) {
        let operands = self.phi_operands(block_id, old_place, env);
        self.push_phi(block_id, old_place, new_place, &operands);
    }

    fn push_phi(
        &mut self,
        block_id: BlockId,
        old_place: &Place,
        new_place: &Place,
        operands: &[IdentifierId],
    ) {
        let preds = self.preds(block_id);
        let mut pred_defs: IndexMap<BlockId, Place> = IndexMap::new();
        for (pred_block_id, &pred_id) in preds.iter().zip(operands) {
            pred_defs.insert(
                *pred_block_id,
                Place {
                    identifier: pred_id,
                    effect: old_place.effect,
                    reactive: old_place.reactive,
                    loc: old_place.loc,
                },
            );
        }

        let phi = Phi {
            place: new_place.clone(),
            operands: pred_defs,
        };

        self.pending_phis[block_id.0 as usize].push(phi);
    }

    fn fix_incomplete_phis(&mut self, block_id: BlockId, env: &mut Environment) {
        let incomplete_phis: Vec<IncompletePhi> = core::mem::take(
            &mut self.states[block_id.0 as usize]
                .as_mut()
                .unwrap()
                .incomplete_phis,
        );
        for phi in &incomplete_phis {
            self.add_phi(block_id, &phi.old_place, &phi.new_place, env);
        }
    }

    fn start_block(&mut self, block_id: BlockId) {
        self.current = Some(block_id);
        self.states[block_id.0 as usize] = Some(State {
            incomplete_phis: Vec::new(),
        });
    }
}

// =============================================================================
// Public entry point
// =============================================================================

pub(crate) fn enter_ssa(
    func: &mut HirFunction,
    env: &mut Environment,
) -> Result<(), CompilerDiagnostic> {
    let num_blocks = env.next_block_id_counter as usize;
    let mut builder = SSABuilder::new(num_blocks, env.identifiers.len());
    builder.define_function(func);
    let root_entry = func.body.entry;
    builder.leaves_out_trivial_phis = func.body.blocks[&root_entry].preds.is_empty();
    enter_ssa_impl(func, &mut builder, env, root_entry)?;
    if !env.has_stack() {
        return Err(crate::lowering::nested_too_deeply());
    }

    // Apply all pending phis to the actual blocks
    apply_pending_phis(func, env, &mut builder);

    Ok(())
}

fn apply_pending_phis(func: &mut HirFunction, env: &mut Environment, builder: &mut SSABuilder) {
    for (block_id, block) in func.body.blocks.iter_mut() {
        let phis = std::mem::take(&mut builder.pending_phis[block_id.0 as usize]);
        if !phis.is_empty() {
            block.phis.extend(phis);
        }
    }
    for fid in &builder.processed_functions {
        let inner_func = &mut env.functions[fid.0 as usize];
        for (block_id, block) in inner_func.body.blocks.iter_mut() {
            let phis = std::mem::take(&mut builder.pending_phis[block_id.0 as usize]);
            if !phis.is_empty() {
                block.phis.extend(phis);
            }
        }
    }
}

fn enter_ssa_impl(
    func: &mut HirFunction,
    builder: &mut SSABuilder,
    env: &mut Environment,
    root_entry: BlockId,
) -> Result<(), CompilerDiagnostic> {
    if !env.has_stack() {
        return Err(crate::lowering::nested_too_deeply());
    }

    for (&block_id, block) in func.body.blocks.iter_mut() {
        if builder.is_started(block_id) {
            return Err(cold_invariant(
                "EnterSSA: found a cycle visiting block",
                Some(format!("bb{}", block_id.0)),
                None,
            )
            .into());
        }

        builder.start_block(block_id);

        // Handle params at the root entry
        if block_id == root_entry {
            if !func.context.is_empty() {
                return Err(cold_invariant(
                    "Expected function context to be empty for outer function declarations",
                    None,
                    None,
                )
                .into());
            }
            for param in &mut func.params {
                let place = param.place_mut();
                place.identifier = builder.define_place(place, env)?;
            }
        }

        // Process instructions
        for instr_id in &block.instructions {
            let instr = &mut func.instructions[instr_id.0 as usize];

            // For FunctionExpression/ObjectMethod, we need to handle context
            // mapping specially because env.functions is borrowed by the closure.
            // First, check if this is a FunctionExpression/ObjectMethod and handle
            // context mapping separately.
            let func_expr_id = match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => Some(lowered_func.func),
                _ => None,
            };

            // Map context places for function expressions before other operands
            if let Some(fid) = func_expr_id {
                let mut context = AstAlloc::take(&mut env.functions[fid.0 as usize].context);
                for place in &mut context {
                    place.identifier = builder.get_place(place, env);
                }
                env.functions[fid.0 as usize].context = context;
            }

            // Map non-context operands
            visitors::for_each_instruction_value_operand_mut(&mut instr.value, &mut |place| {
                place.identifier = builder.get_place(place, env);
            });

            // Map lvalues (skip DeclareContext/StoreContext — context variables
            // don't participate in SSA renaming)
            let mut lvalue_err: Option<CompilerDiagnostic> = None;
            visitors::for_each_instruction_lvalue_mut(instr, &mut |place| {
                if lvalue_err.is_none() {
                    match builder.define_place(place, env) {
                        Ok(new_id) => place.identifier = new_id,
                        Err(e) => lvalue_err = Some(e),
                    }
                }
            });
            if let Some(e) = lvalue_err {
                return Err(e);
            }

            // Handle inner function SSA
            if let Some(fid) = func_expr_id {
                for place in &env.functions[fid.0 as usize].context {
                    builder.unmark_unknown(place.identifier);
                }
                builder.processed_functions.push(fid);
                let inner_func = &mut env.functions[fid.0 as usize];
                let inner_entry = inner_func.body.entry;
                let entry_block = inner_func.body.blocks.get_mut(&inner_entry).unwrap();

                if !entry_block.preds.is_empty() {
                    return Err(cold_invariant(
                        "Expected function expression entry block to have zero predecessors",
                        None,
                        None,
                    )
                    .into());
                }
                entry_block.preds.insert(block_id);

                builder.define_function(inner_func);

                let saved_current = builder.current;

                // Take the inner function out of the arena to process it
                let mut inner_func =
                    std::mem::replace(&mut env.functions[fid.0 as usize], placeholder_function());

                // Map inner function params
                for param in &mut inner_func.params {
                    let place = param.place_mut();
                    place.identifier = builder.define_place(place, env)?;
                }

                enter_ssa_impl(&mut inner_func, builder, env, root_entry)?;

                // Clear entry preds
                inner_func
                    .body
                    .blocks
                    .get_mut(&inner_entry)
                    .unwrap()
                    .preds
                    .clear();

                // Put it back
                env.functions[fid.0 as usize] = inner_func;

                builder.current = saved_current;

                builder.block_preds[inner_entry.0 as usize] = (0, 0);
            }
        }

        // Map terminal operands
        visitors::for_each_terminal_operand_mut(&mut block.terminal, &mut |place| {
            place.identifier = builder.get_place(place, env);
        });

        // Handle successors
        let successors = visitors::each_terminal_successor(&block.terminal);
        for output_id in successors {
            let output_preds_len = builder.preds(output_id).len() as u32;

            let count = match builder.unsealed_preds[output_id.0 as usize] {
                Some(prev) => prev - 1,
                None => output_preds_len - 1,
            };
            builder.unsealed_preds[output_id.0 as usize] = Some(count);

            if count == 0 && builder.is_started(output_id) {
                builder.fix_incomplete_phis(output_id, env);
            }
        }
    }

    Ok(())
}

/// Create a placeholder HirFunction for temporarily swapping an inner function
/// out of `env.functions` via `std::mem::replace`. The placeholder is never
/// read — the real function is swapped back immediately after processing.
pub(crate) fn placeholder_function() -> HirFunction {
    HirFunction {
        loc: None,
        id: None,
        name_hint: None,
        fn_type: ReactFunctionType::Other,
        params: hir_vec![],
        return_type_annotation: None,
        returns: Place {
            identifier: IdentifierId(0),
            effect: Effect::Unknown,
            reactive: false,
            loc: None,
        },
        context: hir_vec![],
        body: HIR {
            entry: BlockId(0),
            blocks: IndexMap::new(),
        },
        instructions: hir_vec![],
        generator: false,
        is_async: false,
        directives: hir_vec![],
        aliasing_effects: None,
    }
}
