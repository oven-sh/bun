//! The syntactic parts of typescript-eslint's `util/` and of `@typescript-eslint/utils`' `ast-utils`.
//!
//! Everything is re-exported from here: `use bun_lint::utils::ts_utils::{get_name_from_member, ..};`
//!
//! No function takes `sourceCode` or `context`: a handle knows its file.
//!
//! **`ChainExpression`.** ESTree has two nodes for all of `a?.b.c()`: the `ChainExpression` and the
//! `CallExpression` in it. Here they are one `Expr`. Where the answer depends on which is meant, it
//! stands for the one that upstream's callers pass, and the doc comment says which:
//! the `ChainExpression` in [`is_strong_precedence_node`], [`is_weak_precedence_parent`],
//! [`get_wrapping_fixer`], [`get_moved_node_code`], [`is_node_equal`], [`is_conditional_test`], the
//! element in it in [`is_assignee`] and [`get_wrapping_fixer_for_chain_element`].

mod estree;
mod head_loc;
mod member_access;
mod misc;
mod nodes;
mod precedence;
mod predicates;
mod statement_start;
mod wrapping_fixer;

pub use head_loc::*;
pub use member_access::*;
pub use misc::*;
pub use nodes::*;
pub use precedence::*;
pub use predicates::*;
pub use statement_start::*;
pub use wrapping_fixer::*;

pub use super::ast_utils::{
    get_static_string_value, is_function, is_loop, is_null_literal,
    is_start_of_expression_statement, is_token_on_same_line,
};
pub use super::text::upper_case_first;
