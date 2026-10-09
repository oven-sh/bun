//! The React Compiler as lint rules: what `eslint-plugin-react-hooks` has as `react-hooks/refs`,
//! `react-hooks/immutability` and so on, and oxlint as `react/refs`, `react/immutability` and so on.
//!
//! The compiler is Bun's (`src/react_compiler`), with its own lowering. A function that can be a
//! component or a hook is handed to it as the tree that Bun's parser would make of it
//! ([`convert`]), and is compiled once for all rules.

#![forbid(unsafe_code)]

mod compile;
mod convert;
mod finding;
mod host;
mod oxlint;
mod program;
mod suppression;

pub use compile::Depth;
pub use finding::{Detail, Finding, Suggestion};
pub use oxlint::{Label, Rendered, render_all};

use bun_lint::ast::File;
use std::cell::OnceCell;

#[derive(Default)]
struct PerFile {
    validations: OnceCell<Vec<Finding>>,
    everything: OnceCell<Vec<Finding>>,
}

/// What the compiler says of the file, in its order. It runs the first time this is asked.
pub fn findings<'a>(file: &'a File<'a>, depth: Depth) -> &'a [Finding] {
    let Some(per_file) = file.extension(PerFile::default) else {
        debug_assert!(false, "the file has no room for what the compiler says");
        return &[];
    };
    match (depth, per_file.everything.get()) {
        (_, Some(everything)) => everything,
        (Depth::Everything, None) => {
            (per_file.everything).get_or_init(|| program::compile_program(file, Depth::Everything))
        }
        (Depth::Validations, None) => (per_file.validations)
            .get_or_init(|| program::compile_program(file, Depth::Validations)),
    }
}
