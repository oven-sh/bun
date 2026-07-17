use std::collections::HashSet;

use crate::collections::{IdMap, IndexMap};
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

struct State {
    defs: IdMap<IdentifierId, IdentifierId>,
    incomplete_phis: Vec<IncompletePhi>,
}

struct SSABuilder {
    /// Indexed by `BlockId.0`.
    states: Vec<Option<State>>,
    current: Option<BlockId>,
    /// Indexed by `BlockId.0`.
    unsealed_preds: Vec<Option<u32>>,
    /// Indexed by `BlockId.0`. Empty Vec = no preds / not registered.
    block_preds: Vec<Vec<BlockId>>,
    unknown: HashSet<IdentifierId>,
    context: HashSet<IdentifierId>,
    /// Indexed by `BlockId.0`.
    pending_phis: Vec<Vec<Phi>>,
    processed_functions: Vec<FunctionId>,
}

impl SSABuilder {
    fn new(blocks: &IndexMap<BlockId, BasicBlock>, num_blocks: usize) -> Self {
        let mut block_preds: Vec<Vec<BlockId>> = vec![Vec::new(); num_blocks];
        for (id, block) in blocks {
            block_preds[id.0 as usize] = block.preds.iter().copied().collect();
        }
        let mut states = Vec::with_capacity(num_blocks);
        states.resize_with(num_blocks, || None);
        SSABuilder {
            states,
            current: None,
            unsealed_preds: vec![None; num_blocks],
            block_preds,
            unknown: HashSet::new(),
            context: HashSet::new(),
            pending_phis: vec![Vec::new(); num_blocks],
            processed_functions: Vec::new(),
        }
    }

    fn define_function(&mut self, func: &HirFunction) {
        for (id, block) in &func.body.blocks {
            self.block_preds[id.0 as usize] = block.preds.iter().copied().collect();
        }
    }

    fn state_mut(&mut self) -> &mut State {
        let current = self
            .current
            .expect("we need to be in a block to access state!");
        self.states[current.0 as usize]
            .as_mut()
            .expect("state not found for current block")
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

    fn define_place(
        &mut self,
        old_place: &Place,
        env: &mut Environment,
    ) -> Result<Place, CompilerDiagnostic> {
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
        self.state_mut().defs.insert(old_id, new_id);
        Ok(Place {
            identifier: new_id,
            effect: old_place.effect,
            reactive: old_place.reactive,
            loc: old_place.loc,
        })
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

    fn get_place(&mut self, old_place: &Place, env: &mut Environment) -> Place {
        let current_id = self.current.expect("must be in a block");
        let new_id = self.get_id_at(old_place, current_id, env);
        Place {
            identifier: new_id,
            effect: old_place.effect,
            reactive: old_place.reactive,
            loc: old_place.loc,
        }
    }

    fn get_id_at(
        &mut self,
        old_place: &Place,
        block_id: BlockId,
        env: &mut Environment,
    ) -> IdentifierId {
        if let Some(state) = &self.states[block_id.0 as usize] {
            if let Some(&new_id) = state.defs.get(old_place.identifier) {
                return new_id;
            }
        }

        let preds = &self.block_preds[block_id.0 as usize];

        if preds.is_empty() {
            self.unknown.insert(old_place.identifier);
            return old_place.identifier;
        }
        let preds_len = preds.len();
        let first_pred = preds[0];

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
            state.defs.insert(old_place.identifier, new_id);
            return new_id;
        }

        if preds_len == 1 {
            let new_id = self.get_id_at(old_place, first_pred, env);
            self.states[block_id.0 as usize]
                .as_mut()
                .unwrap()
                .defs
                .insert(old_place.identifier, new_id);
            return new_id;
        }

        let new_id = self.make_id(old_place.identifier, env);
        self.states[block_id.0 as usize]
            .as_mut()
            .unwrap()
            .defs
            .insert(old_place.identifier, new_id);
        let new_place = Place {
            identifier: new_id,
            effect: old_place.effect,
            reactive: old_place.reactive,
            loc: old_place.loc,
        };
        self.add_phi(block_id, old_place, &new_place, env);
        new_id
    }

    fn add_phi(
        &mut self,
        block_id: BlockId,
        old_place: &Place,
        new_place: &Place,
        env: &mut Environment,
    ) {
        let preds = self.block_preds[block_id.0 as usize].clone();

        let mut pred_defs: IndexMap<BlockId, Place> = IndexMap::new();
        for pred_block_id in &preds {
            let pred_id = self.get_id_at(old_place, *pred_block_id, env);
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
        let incomplete_phis: Vec<IncompletePhi> = self.states[block_id.0 as usize]
            .as_mut()
            .unwrap()
            .incomplete_phis
            .drain(..)
            .collect();
        for phi in &incomplete_phis {
            self.add_phi(block_id, &phi.old_place, &phi.new_place, env);
        }
    }

    fn start_block(&mut self, block_id: BlockId) {
        self.current = Some(block_id);
        self.states[block_id.0 as usize] = Some(State {
            defs: IdMap::new(),
            incomplete_phis: Vec::new(),
        });
    }
}

// =============================================================================
// Public entry point
// =============================================================================

pub fn enter_ssa(func: &mut HirFunction, env: &mut Environment) -> Result<(), CompilerDiagnostic> {
    let num_blocks = env.next_block_id_counter as usize;
    let mut builder = SSABuilder::new(&func.body.blocks, num_blocks);
    let root_entry = func.body.entry;
    enter_ssa_impl(func, &mut builder, env, root_entry)?;

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
    for fid in &builder.processed_functions.clone() {
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
    let mut visited_blocks: HashSet<BlockId> = HashSet::new();
    let block_ids: Vec<BlockId> = func.body.blocks.keys().copied().collect();

    for block_id in &block_ids {
        let block_id = *block_id;

        if visited_blocks.contains(&block_id) {
            return Err(cold_invariant(
                "EnterSSA: found a cycle visiting block",
                Some(format!("bb{}", block_id.0)),
                None,
            )
            .into());
        }

        visited_blocks.insert(block_id);
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
            let params = AstAlloc::take(&mut func.params);
            let mut new_params = AstAlloc::vec_with_capacity(params.len());
            for param in params {
                new_params.push(match param {
                    ParamPattern::Place(p) => ParamPattern::Place(builder.define_place(&p, env)?),
                    ParamPattern::Spread(s) => ParamPattern::Spread(SpreadPattern {
                        place: builder.define_place(&s.place, env)?,
                    }),
                });
            }
            func.params = new_params;
        }

        // Process instructions
        let instruction_ids = func
            .body
            .blocks
            .get(&block_id)
            .unwrap()
            .instructions
            .clone();

        for instr_id in &instruction_ids {
            let instr_idx = instr_id.0 as usize;
            let instr = &mut func.instructions[instr_idx];

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
                let context = AstAlloc::take(&mut env.functions[fid.0 as usize].context);
                env.functions[fid.0 as usize].context = AstAlloc::vec_from_iter(
                    context
                        .into_iter()
                        .map(|place| builder.get_place(&place, env)),
                );
            }

            // Map non-context operands
            visitors::for_each_instruction_value_operand_mut(&mut instr.value, &mut |place| {
                *place = builder.get_place(place, env);
            });

            // Map lvalues (skip DeclareContext/StoreContext — context variables
            // don't participate in SSA renaming)
            let instr = &mut func.instructions[instr_idx];
            let mut lvalue_err: Option<CompilerDiagnostic> = None;
            visitors::for_each_instruction_lvalue_mut(instr, &mut |place| {
                if lvalue_err.is_none() {
                    match builder.define_place(place, env) {
                        Ok(new_place) => *place = new_place,
                        Err(e) => lvalue_err = Some(e),
                    }
                }
            });
            if let Some(e) = lvalue_err {
                return Err(e);
            }

            // Handle inner function SSA
            if let Some(fid) = func_expr_id {
                let context_ids: Vec<IdentifierId> = env.functions[fid.0 as usize]
                    .context
                    .iter()
                    .map(|place| place.identifier)
                    .collect();
                for id in context_ids {
                    builder.unmark_unknown(id);
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

                // Map inner function params
                let inner_params = AstAlloc::take(&mut env.functions[fid.0 as usize].params);
                let mut new_inner_params = AstAlloc::vec_with_capacity(inner_params.len());
                for param in inner_params {
                    new_inner_params.push(match param {
                        ParamPattern::Place(p) => {
                            ParamPattern::Place(builder.define_place(&p, env)?)
                        }
                        ParamPattern::Spread(s) => ParamPattern::Spread(SpreadPattern {
                            place: builder.define_place(&s.place, env)?,
                        }),
                    });
                }
                env.functions[fid.0 as usize].params = new_inner_params;

                // Take the inner function out of the arena to process it
                let mut inner_func =
                    std::mem::replace(&mut env.functions[fid.0 as usize], placeholder_function());

                enter_ssa_impl(&mut inner_func, builder, env, root_entry)?;

                // Put it back
                env.functions[fid.0 as usize] = inner_func;

                builder.current = saved_current;

                // Clear entry preds
                env.functions[fid.0 as usize]
                    .body
                    .blocks
                    .get_mut(&inner_entry)
                    .unwrap()
                    .preds
                    .clear();
                builder.block_preds[inner_entry.0 as usize] = Vec::new();
            }
        }

        // Map terminal operands
        let terminal = &mut func.body.blocks.get_mut(&block_id).unwrap().terminal;
        visitors::for_each_terminal_operand_mut(terminal, &mut |place| {
            *place = builder.get_place(place, env);
        });

        // Handle successors
        let terminal_ref = &func.body.blocks.get(&block_id).unwrap().terminal;
        let successors = visitors::each_terminal_successor(terminal_ref);
        for output_id in successors {
            let output_preds_len = builder.block_preds[output_id.0 as usize].len() as u32;

            let count = match builder.unsealed_preds[output_id.0 as usize] {
                Some(prev) => prev - 1,
                None => output_preds_len - 1,
            };
            builder.unsealed_preds[output_id.0 as usize] = Some(count);

            if count == 0 && visited_blocks.contains(&output_id) {
                builder.fix_incomplete_phis(output_id, env);
            }
        }
    }

    Ok(())
}

/// Create a placeholder HirFunction for temporarily swapping an inner function
/// out of `env.functions` via `std::mem::replace`. The placeholder is never
/// read — the real function is swapped back immediately after processing.
pub fn placeholder_function() -> HirFunction {
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
