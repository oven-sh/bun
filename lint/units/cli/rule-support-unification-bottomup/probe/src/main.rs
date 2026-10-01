//! Probe harness: lints each operand (or each path listed in `@file`) and prints one line per report.
//! `path<TAB>start<TAB>len<TAB>line:column<TAB>code<TAB>text`, columns in UTF-16 units; `path<TAB>PARSE` when it does not parse.
#[allow(
    clippy::all,
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros,
    clippy::ptr_as_ptr,
    clippy::ref_as_ptr,
    clippy::borrow_as_ptr,
    clippy::undocumented_unsafe_blocks
)]
mod harness;
mod lint;
#[allow(
    clippy::all,
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros,
    clippy::ptr_as_ptr,
    clippy::ref_as_ptr,
    clippy::borrow_as_ptr,
    clippy::undocumented_unsafe_blocks
)]
mod shims;

fn main() {
    harness::main();
}
