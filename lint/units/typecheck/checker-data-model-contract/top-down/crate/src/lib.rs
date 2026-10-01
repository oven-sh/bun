//! One scratch package: the node table prototype, the diagnostics table and the data model of the checker with translated functions.
pub mod ast;
pub mod bindprobe;
pub mod checker;
pub mod compiler;
pub mod diagnostics;
pub mod diagnosticwriter;
pub mod testimport;
pub mod tscore;

#[cfg(test)]
mod diagnostics_tests;
#[cfg(test)]
mod native_test_shims;
#[cfg(test)]
mod nodetable_tests;
#[cfg(test)]
mod tests_checker;
