//! Flattens a reactive scope when one of its outputs can be a value that the
//! scope does not track.
//!
//! A scope is printed as `if (a dependency changed) { body; store the outputs }
//! else { load the outputs }`. The `else` branch is only correct when every
//! output is a function of the dependencies. A variable that is declared before
//! the scope, and reassigned on some paths through it but not on all of them, is
//! an output that can also keep the value it had on entry:
//!
//! ```js
//! let w = props.fallback;
//! for (let i = 0; i < props.n; i++) { // scope, dependencies: props.c, props.n
//!   if (props.c) w = <b>{i}</b>;
//! }
//! return <div>{w}</div>;
//! ```
//!
//! PropagateScopeDependenciesHIR collects dependencies from the operands of
//! instructions and terminals. The value on entry reaches the output only
//! through a phi, so it is not a dependency. With `props.n === 0` on two
//! renders, the second render loads `w` from the cache and loses a change of
//! `props.fallback`.
//!
//! A phi inside the scope that merges a value defined before the scope reads
//! that value. When the value is reactive and the scope has no dependency on the
//! variable, the scope cannot be memoized. This pass turns it into a pruned
//! scope, so its body runs on every render. Scopes nested in it keep their
//! memoization. So does an enclosing scope that also holds the declaration.
//!
//! A scope that reads the variable has the dependency and is left alone.
//!
//! Upstream has no such pass and prints the stale load, in TypeScript and in
//! Rust. Since facebook/react#36732 a loop counter gets a scope that spans its
//! loop, so a plain counted loop is enough to reach it. The pass reads the
//! dependencies that PropagateScopeDependenciesHIR computed, so it runs after it.

use crate::hir::environment::Environment;
use crate::hir::visitors::{self, ScopeBlockInfo, ScopeBlockTraversal};
use crate::hir::{BlockId, EvaluationOrder, HirFunction, IdentifierId, Place, ScopeId, Terminal};

pub(crate) fn flatten_scopes_with_untracked_phi_inputs_hir(
    func: &mut HirFunction,
    env: &Environment,
) {
    let blocks = &func.body.blocks;
    if !blocks
        .values()
        .any(|block| matches!(block.terminal, Terminal::Scope { .. }))
        || blocks.values().all(|block| block.phis.is_empty())
    {
        return;
    }

    // Where each identifier is defined. A parameter or a context variable has no
    // defining instruction and keeps 0, which is before every scope.
    let mut defined_at = vec![EvaluationOrder(0); env.identifiers.len()];
    // InferReactivePlaces records its result on places, and not on every place of
    // a reactive identifier, so take the union over all places.
    let mut reactive = vec![false; env.identifiers.len()];
    fn mark(reactive: &mut [bool], place: &Place) {
        if place.reactive {
            reactive[place.identifier.0 as usize] = true;
        }
    }

    for param in &func.params {
        mark(&mut reactive, param.place());
    }
    for block in blocks.values() {
        // A phi takes its value on entry to its block, before the first
        // instruction. The block that ends in a scope terminal is before that
        // scope, also when the terminal is all it holds.
        let block_start = block
            .instructions
            .first()
            .map(|id| func.instructions[id.0 as usize].id)
            .unwrap_or(block.terminal.evaluation_order());
        let block_entry = EvaluationOrder(block_start.0.saturating_sub(1));
        for phi in &block.phis {
            defined_at[phi.place.identifier.0 as usize] = block_entry;
            mark(&mut reactive, &phi.place);
            for operand in phi.operands.values() {
                mark(&mut reactive, operand);
            }
        }
        for instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            for lvalue in visitors::each_instruction_lvalue(instr) {
                defined_at[lvalue.identifier.0 as usize] = instr.id;
                mark(&mut reactive, &lvalue);
            }
            for operand in visitors::each_instruction_value_operand(&instr.value, env) {
                mark(&mut reactive, &operand);
            }
        }
        for operand in visitors::each_terminal_operand(&block.terminal) {
            mark(&mut reactive, &operand);
        }
    }

    let mut traversal = ScopeBlockTraversal::new();
    let mut active_scopes: Vec<ScopeId> = Vec::new();
    let mut flatten: Vec<ScopeId> = Vec::new();

    for (block_id, block) in blocks {
        traversal.record_scopes(block);
        match traversal.block_infos.get(block_id) {
            Some(ScopeBlockInfo::Begin {
                scope,
                pruned: false,
                ..
            }) => active_scopes.push(*scope),
            Some(ScopeBlockInfo::End {
                scope,
                pruned: false,
            }) => {
                let top = active_scopes.pop();
                debug_assert_eq!(top, Some(*scope));
            }
            _ => {}
        }

        for phi in &block.phis {
            for operand in phi.operands.values() {
                let operand_id = operand.identifier;
                if !reactive[operand_id.0 as usize] {
                    continue;
                }
                for &scope_id in &active_scopes {
                    if defined_at[operand_id.0 as usize]
                        < env.scopes[scope_id.0 as usize].range.start
                        && !flatten.contains(&scope_id)
                        && !depends_on_variable(env, scope_id, operand_id)
                    {
                        flatten.push(scope_id);
                    }
                }
            }
        }
    }

    if flatten.is_empty() {
        return;
    }

    let block_ids: Vec<BlockId> = func.body.blocks.keys().copied().collect();
    for block_id in block_ids {
        let block = func.body.blocks.get_mut(&block_id).unwrap();
        if let Terminal::Scope {
            block: scope_block,
            fallthrough,
            scope,
            id,
            loc,
        } = &block.terminal
        {
            if flatten.contains(scope) {
                block.terminal = Terminal::PrunedScope {
                    block: *scope_block,
                    fallthrough: *fallthrough,
                    scope: *scope,
                    id: *id,
                    loc: *loc,
                };
            }
        }
    }
}

/// Whether the scope depends on the variable itself. A dependency on one of its
/// properties compares only that property.
fn depends_on_variable(env: &Environment, scope_id: ScopeId, identifier: IdentifierId) -> bool {
    let declaration_id = env.identifiers[identifier.0 as usize].declaration_id;
    env.scopes[scope_id.0 as usize]
        .dependencies
        .iter()
        .any(|dep| {
            dep.path.is_empty()
                && env.identifiers[dep.identifier.0 as usize].declaration_id == declaration_id
        })
}
