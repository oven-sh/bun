//! Tells whether work that tsgo repeats can be skipped.
//!
//! tsgo walks between the same type arguments again within one `inferTypes` call, and computes the type of a property
//! again for every intersection of a cross product. Where the checker skips such a repeat
//! (`Checker::infer_from_type_arguments_once`, check/sibling_intersections.rs), that must not be observable. These rules
//! guarantee it:
//!
//! - The work that's remembered had no side effects, called traces here (`traces_of_inference`). It didn't make a query,
//!   start a computation whose result is cached in a table, compute an instantiation, create a record, or report
//!   anything. So every lookup it made hit the type store or a table.
//! - A cache that evicts either sits in front of a table or can rebuild an evicted entry from tables. The answer is the
//!   same on a hit and on a miss, and the cache's contents aren't visible anywhere else. So rebuilding an entry doesn't
//!   count as a trace. If it did, whether there's a trace would depend on which lookups ran before
//!   (`Checker::scopes_begun`).
//! - Some lookups miss without starting an evaluation. `type_of_mapped_prop` and the `circular_*` tables are read this
//!   way. If the entry is added later, it changes the answer only when it was produced by a cycle or a limit. So what's
//!   remembered is valid until the next cycle or limit (`inference_disturbances`), either in this task or in a commit
//!   from another task (`Checker::state_of_commits`).
//! - What's remembered is dropped before anything that was in progress ends: at the end of the `inferTypes` call, or
//!   when the union has been filtered.

use super::super::*;
use super::Inference;

/// Labels for `Checker::traces_of_inference`. Each one is a `Checker` field or a kind of record.
const TRACES: [&str; 14] = [
    "work",
    "scopes_begun",
    "instantiations_computed",
    "atoms",
    "components",
    "mappers",
    "signatures",
    "types",
    "comparisons_of_deeply_nested_types",
    "incomplete_flow_taints",
    "reported",
    "diagnostics",
    "relation_too_complex",
    "unresolved_renamed_params",
];

/// Labels for `Checker::inference_disturbances`.
const DISTURBANCES: [&str; 9] = [
    "cycles",
    "taints",
    "limits",
    "times_cut_short",
    "in_progress_variance_reads",
    "unmarked_rejections",
    "any_signature_reads",
    "commits",
    "restrictive_resets",
];

/// The counters that `Checker::inference_disturbances` returns.
pub(super) type Disturbances = [u64; DISTURBANCES.len()];

/// The index in `DISTURBANCES` of the counter for other tasks' commits.
pub(in super::super) const COMMITS: usize = 7;

const _: () = assert!(matches!(DISTURBANCES[COMMITS].as_bytes(), b"commits"));

impl<'p, 's> Checker<'p, 's> {
    /// Everything that a walk between type arguments changes if it does more than repeat an earlier one.
    pub(super) fn marks_of_argument_walk(&self, n: &Inference) -> impl PartialEq + use<'p, 's> {
        (
            self.traces_of_inference(),
            self.inference_disturbances(),
            self.lowest_taint,
            self.instantiation_count,
            (
                n.visited.len(),
                n.unfinished_hits,
                n.has_reached_contextual_function,
            ),
        )
    }

    /// Returns the counters in `TRACES` order. Every computation whose result is cached in a table starts with `enter`
    /// or `begin_scope`, which `work` and `scopes_begun` count.
    pub(in super::super) fn traces_of_inference(&self) -> [u64; TRACES.len()] {
        let [atoms, components, mappers, signatures, types] = self.task.own.created();
        [
            self.work,
            self.scopes_begun,
            self.instantiations_computed,
            atoms as u64,
            components as u64,
            mappers as u64,
            signatures as u64,
            types as u64,
            self.comparisons_of_deeply_nested_types,
            self.incomplete_flow_taints,
            self.reported.len() as u64,
            self.task.diagnostics.len() as u64,
            u64::from(self.relation_too_complex),
            self.unresolved_renamed_params.len() as u64,
        ]
    }

    /// Returns the counters in `DISTURBANCES` order. One of them changes whenever a computation hits a cycle or is cut
    /// short, or a result stops being valid for every caller. A walk that changes one of them has left a trace.
    ///
    /// The last counter changes when `getUniqueTypeParameters` adds type parameters to `unresolved_renamed_params`.
    /// Requesting the constraint of one removes it from the set, which is a trace. So a remembered walk doesn't request
    /// the constraint of any type parameter in the set, and that stays true until more are added.
    pub(in super::super) fn inference_disturbances(&self) -> Disturbances {
        let from_loops = self.incomplete_flow_taints;
        [
            self.cycles.wrapping_sub(from_loops),
            self.taints.wrapping_sub(from_loops),
            self.limits_in_earlier_files + self.limits + self.instantiation_limit_hits,
            self.times_cut_short.get(),
            self.in_progress_variance_reads,
            self.unmarked_rejections,
            u64::from(self.any_signature_reads),
            self.state_of_commits(),
            u64::from(self.links.restrictive_resets()),
        ]
    }
}
