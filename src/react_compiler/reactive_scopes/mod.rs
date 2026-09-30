// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Reactive scope passes for the React Compiler.
//!
//! Converts the HIR CFG into a tree-structured `ReactiveFunction` and runs
//! scope-related transformation passes (pruning, merging, renaming, etc.).
//!
//! Corresponds to `src/ReactiveScopes/` in the TypeScript compiler.

#![allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    reason = "ported from facebook/react upstream; uses std collections by design"
)]
#![allow(unreachable_pub)]
#![allow(
    clippy::assigning_clones,
    clippy::clone_on_copy,
    clippy::if_same_then_else,
    clippy::large_enum_variant,
    clippy::let_and_return,
    clippy::manual_map,
    clippy::map_entry,
    clippy::match_like_matches_macro,
    clippy::needless_borrow,
    clippy::needless_borrows_for_generic_args,
    clippy::needless_collect,
    clippy::needless_pass_by_value,
    clippy::or_fun_call,
    clippy::ptr_arg,
    clippy::question_mark,
    clippy::redundant_clone,
    clippy::redundant_closure,
    clippy::unnecessary_map_or,
    clippy::unnecessary_mut_passed,
    clippy::unnecessary_unwrap,
    clippy::unneeded_wildcard_pattern,
    clippy::unwrap_or_default,
    clippy::useless_conversion,
    clippy::useless_format,
    reason = "ported verbatim from facebook/react upstream; not maintained for Rust idioms"
)]

mod assert_scope_instructions_within_scopes;
mod assert_well_formed_break_targets;
mod build_reactive_function;
mod extract_scope_declarations_from_destructuring;
mod merge_reactive_scopes_that_invalidate_together;
mod promote_used_temporaries;
mod propagate_early_returns;
mod prune_always_invalidating_scopes;
mod prune_hoisted_contexts;
mod prune_non_escaping_scopes;
mod prune_non_reactive_dependencies;
mod prune_unused_labels;
mod prune_unused_lvalues;
mod prune_unused_scopes;
mod rename_variables;
mod stabilize_block_ids;
pub(crate) mod visitors;

pub(crate) use assert_scope_instructions_within_scopes::assert_scope_instructions_within_scopes;
pub(crate) use assert_well_formed_break_targets::assert_well_formed_break_targets;
pub(crate) use build_reactive_function::build_reactive_function;
pub(crate) use extract_scope_declarations_from_destructuring::extract_scope_declarations_from_destructuring;
pub(crate) use merge_reactive_scopes_that_invalidate_together::merge_reactive_scopes_that_invalidate_together;
pub(crate) use promote_used_temporaries::promote_used_temporaries;
pub(crate) use propagate_early_returns::propagate_early_returns;
pub(crate) use prune_always_invalidating_scopes::prune_always_invalidating_scopes;
pub(crate) use prune_hoisted_contexts::prune_hoisted_contexts;
pub(crate) use prune_non_escaping_scopes::prune_non_escaping_scopes;
pub(crate) use prune_non_reactive_dependencies::prune_non_reactive_dependencies;
pub(crate) use prune_unused_labels::prune_unused_labels;
pub(crate) use prune_unused_lvalues::prune_unused_lvalues;
pub(crate) use prune_unused_scopes::prune_unused_scopes;
pub(crate) use rename_variables::rename_variables;
pub(crate) use stabilize_block_ids::stabilize_block_ids;
