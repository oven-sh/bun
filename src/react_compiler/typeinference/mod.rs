#![allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    unreachable_pub,
    reason = "ported from facebook/react upstream; uses std collections by design"
)]
#![allow(
    clippy::clone_on_copy,
    clippy::if_same_then_else,
    clippy::large_enum_variant,
    clippy::let_and_return,
    clippy::manual_map,
    clippy::map_entry,
    clippy::match_like_matches_macro,
    clippy::needless_borrow,
    clippy::needless_borrows_for_generic_args,
    clippy::needless_pass_by_value,
    clippy::or_fun_call,
    clippy::ptr_arg,
    clippy::redundant_clone,
    clippy::redundant_closure,
    clippy::trivially_copy_pass_by_ref,
    clippy::unnecessary_map_or,
    clippy::unnecessary_mut_passed,
    clippy::unnecessary_unwrap,
    clippy::unwrap_or_default,
    clippy::useless_conversion,
    clippy::useless_format,
    reason = "ported verbatim from facebook/react upstream; not maintained for Rust idioms"
)]

pub mod infer_types;

pub use infer_types::infer_types;
