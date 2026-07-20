#![allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    unreachable_pub,
    reason = "ported from facebook/react upstream; uses std collections by design"
)]
#![allow(
    clippy::assigning_clones,
    clippy::borrow_as_ptr,
    clippy::clone_on_copy,
    clippy::for_kv_map,
    clippy::iter_cloned_collect,
    clippy::manual_pop_if,
    clippy::unnecessary_sort_by,
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
    clippy::redundant_field_names,
    clippy::unnecessary_map_or,
    clippy::unnecessary_mut_passed,
    clippy::unnecessary_unwrap,
    clippy::unneeded_wildcard_pattern,
    clippy::unwrap_or_default,
    clippy::useless_conversion,
    clippy::useless_format,
    reason = "ported verbatim from facebook/react upstream; not maintained for Rust idioms"
)]

pub mod align_method_call_scopes;
pub mod align_object_method_scopes;
pub mod align_reactive_scopes_to_block_scopes_hir;
pub mod analyse_functions;
pub mod build_reactive_scope_terminals_hir;
pub mod flatten_reactive_loops_hir;
pub mod flatten_scopes_with_hooks_or_use_hir;
pub mod infer_mutation_aliasing_effects;
pub mod infer_mutation_aliasing_ranges;
pub mod infer_reactive_places;
pub mod infer_reactive_scope_variables;
pub mod memoize_fbt_and_macro_operands_in_same_scope;
pub mod merge_overlapping_reactive_scopes_hir;
pub mod propagate_scope_dependencies_hir;

pub use align_method_call_scopes::align_method_call_scopes;
pub use align_object_method_scopes::align_object_method_scopes;
pub use align_reactive_scopes_to_block_scopes_hir::align_reactive_scopes_to_block_scopes_hir;
pub use analyse_functions::analyse_functions;
pub use build_reactive_scope_terminals_hir::build_reactive_scope_terminals_hir;
pub use flatten_reactive_loops_hir::flatten_reactive_loops_hir;
pub use flatten_scopes_with_hooks_or_use_hir::flatten_scopes_with_hooks_or_use_hir;
pub use infer_mutation_aliasing_effects::infer_mutation_aliasing_effects;
pub use infer_mutation_aliasing_ranges::infer_mutation_aliasing_ranges;
pub use infer_reactive_places::infer_reactive_places;
pub use infer_reactive_scope_variables::infer_reactive_scope_variables;
pub use memoize_fbt_and_macro_operands_in_same_scope::memoize_fbt_and_macro_operands_in_same_scope;
pub use merge_overlapping_reactive_scopes_hir::merge_overlapping_reactive_scopes_hir;
pub use propagate_scope_dependencies_hir::propagate_scope_dependencies_hir;
