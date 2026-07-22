#![allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    reason = "ported from facebook/react upstream; uses std collections by design"
)]
#![allow(unreachable_pub)]
#![allow(
    clippy::assigning_clones,
    clippy::clone_on_copy,
    clippy::format_collect,
    clippy::if_same_then_else,
    clippy::large_enum_variant,
    clippy::let_and_return,
    clippy::manual_contains,
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
    clippy::unnecessary_unwrap,
    clippy::unneeded_wildcard_pattern,
    clippy::unwrap_or_default,
    clippy::useless_conversion,
    clippy::useless_format,
    reason = "ported verbatim from facebook/react upstream; not maintained for Rust idioms"
)]

pub mod validate_context_variable_lvalues;
pub mod validate_exhaustive_dependencies;
pub mod validate_hooks_usage;
pub mod validate_locals_not_reassigned_after_render;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub mod validate_no_capitalized_calls;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub mod validate_no_derived_computations_in_effects;
pub mod validate_no_freezing_known_mutable_functions;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub mod validate_no_jsx_in_try_statement;
pub mod validate_no_ref_access_in_render;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub mod validate_no_set_state_in_effects;
pub mod validate_no_set_state_in_render;
pub mod validate_preserved_manual_memoization;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub mod validate_static_components;
pub mod validate_use_memo;

pub(crate) use validate_context_variable_lvalues::validate_context_variable_lvalues;
pub(crate) use validate_exhaustive_dependencies::validate_exhaustive_dependencies;
pub(crate) use validate_hooks_usage::validate_hooks_usage;
pub(crate) use validate_locals_not_reassigned_after_render::validate_locals_not_reassigned_after_render;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub(crate) use validate_no_capitalized_calls::validate_no_capitalized_calls;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub(crate) use validate_no_derived_computations_in_effects::validate_no_derived_computations_in_effects;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub use validate_no_derived_computations_in_effects::validate_no_derived_computations_in_effects_exp;
pub(crate) use validate_no_freezing_known_mutable_functions::validate_no_freezing_known_mutable_functions;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub(crate) use validate_no_jsx_in_try_statement::validate_no_jsx_in_try_statement;
pub(crate) use validate_no_ref_access_in_render::validate_no_ref_access_in_render;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub(crate) use validate_no_set_state_in_effects::validate_no_set_state_in_effects;
pub(crate) use validate_no_set_state_in_render::validate_no_set_state_in_render;
pub(crate) use validate_preserved_manual_memoization::validate_preserved_manual_memoization;
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub(crate) use validate_static_components::validate_static_components;
pub(crate) use validate_use_memo::validate_use_memo;
