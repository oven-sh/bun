//! Prototype of the node table of the type checker: ids, files, open stores, the builder and the generated accessors.
pub mod ast;
pub mod bindprobe;
pub mod testimport;
pub mod tscore;

#[cfg(test)]
mod native_test_shims;
#[cfg(test)]
mod tests;
