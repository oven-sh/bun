//! `sortImports` of oxfmt.

/// The value of `sortImports`, checked.
#[derive(Debug)]
pub(super) struct Options;

/// `value`: as it is written in JSON. `None`: imports are left as they are.
pub(super) fn compile(value: &[u8]) -> Result<Option<Options>, Vec<u8>> {
    Ok((value != b"false").then_some(Options))
}
