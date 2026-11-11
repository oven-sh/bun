//! The parts of typescript-eslint's `util/` that analyze scopes and classes.

mod class_scope_analyzer;
mod collect_unused_variables;
mod estree;
mod explicit_return_type_utils;
mod is_type_only_reference;
mod reference_contains_type_predicate;
mod reference_contains_type_query;
mod scope_utils;

pub use class_scope_analyzer::*;
pub use collect_unused_variables::*;
pub use explicit_return_type_utils::*;
pub use is_type_only_reference::*;
pub use reference_contains_type_predicate::*;
pub use reference_contains_type_query::*;
pub use scope_utils::*;
