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
    clippy::iter_cloned_collect,
    clippy::large_enum_variant,
    clippy::let_and_return,
    clippy::manual_contains,
    clippy::manual_map,
    clippy::manual_pop_if,
    clippy::map_entry,
    clippy::match_like_matches_macro,
    clippy::needless_borrow,
    clippy::needless_borrows_for_generic_args,
    clippy::needless_collect,
    clippy::needless_pass_by_value,
    clippy::neg_multiply,
    clippy::or_fun_call,
    clippy::ptr_arg,
    clippy::question_mark,
    clippy::redundant_clone,
    clippy::redundant_closure,
    clippy::unnecessary_map_or,
    clippy::unnecessary_sort_by,
    clippy::unnecessary_unwrap,
    clippy::unneeded_wildcard_pattern,
    clippy::unwrap_or_default,
    clippy::useless_conversion,
    clippy::useless_format,
    reason = "ported verbatim from facebook/react upstream; not maintained for Rust idioms"
)]

pub mod constant_propagation;
pub mod dead_code_elimination;
pub mod drop_manual_memoization;
pub mod inline_iifes;
pub(crate) mod merge_consecutive_blocks;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub mod name_anonymous_functions;
pub mod optimize_for_ssr;
pub mod optimize_props_method_calls;
pub mod outline_functions;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub mod outline_jsx;
pub mod prune_maybe_throws;
pub mod prune_unused_labels_hir;

pub(crate) use constant_propagation::constant_propagation;
pub(crate) use dead_code_elimination::dead_code_elimination;
pub(crate) use drop_manual_memoization::drop_manual_memoization;
pub(crate) use inline_iifes::inline_immediately_invoked_function_expressions;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub(crate) use name_anonymous_functions::name_anonymous_functions;
pub(crate) use optimize_for_ssr::optimize_for_ssr;
pub(crate) use optimize_props_method_calls::optimize_props_method_calls;
pub(crate) use outline_functions::outline_functions;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub(crate) use outline_jsx::outline_jsx;
pub(crate) use prune_maybe_throws::prune_maybe_throws;
pub(crate) use prune_unused_labels_hir::prune_unused_labels_hir;
