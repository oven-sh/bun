//! Scratch: the checker-side data model, compiled as one crate with the node table prototype.
pub mod tscore;

#[path = "/workspace/notes/lint/units/typecheck/node-table-id-contract/bottom-up/crate/src/ast/mod.rs"]
pub mod ast;
#[path = "/workspace/notes/lint/units/typecheck/node-table-id-contract/bottom-up/crate/src/bindprobe.rs"]
pub mod bindprobe;
#[path = "/workspace/notes/lint/units/typecheck/node-table-id-contract/bottom-up/crate/src/testimport/mod.rs"]
pub mod testimport;

#[cfg(test)]
#[path = "/workspace/notes/lint/units/typecheck/node-table-id-contract/bottom-up/crate/src/native_test_shims.rs"]
mod native_test_shims;

pub mod ast_diagnostic;
pub mod checker;
pub mod compiler_program;
pub mod diagnostics;
pub mod diagnosticwriter;

#[cfg(test)]
mod diagnostics_tests;
#[cfg(test)]
#[path = "/workspace/notes/lint/units/typecheck/node-table-id-contract/bottom-up/crate/src/tests.rs"]
mod node_table_tests;
#[cfg(test)]
mod tests;
