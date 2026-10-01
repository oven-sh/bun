// Scratch: the data model and callee stubs, and the candidate flow.rs under the deny set of the workspace.
pub mod data;
pub mod model;
pub mod stubs_generated;
pub mod name_from_type;
#[deny(
    warnings,
    dead_code,
    unreachable_pub,
    unused_imports,
    unused_variables,
    unused_mut,
    unused_assignments,
    unused_macros,
    unreachable_code,
    unreachable_patterns
)]
#[path = "/workspace/wt/typecheck/src/typecheck/checker/flow.rs"]
pub mod flow;
pub use data::*;
pub use flow::*;
pub use name_from_type::*;
pub use stubs_generated::*;
#[cfg(test)]
mod tests;
