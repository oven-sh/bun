//! The React Compiler as lint rules: what `eslint-plugin-react-hooks` has as `react-hooks/refs`,
//! `react-hooks/immutability` and so on, and oxlint as `react/refs`, `react/immutability` and so on.
//!
//! The compiler is Bun's (`src/react_compiler`), with its own lowering. A function that can be a
//! component or a hook is handed to it as the tree that Bun's parser would make of it
//! ([`convert`]), and is compiled once for all rules.
//!
//! Which functions are compiled, and how what the compiler says is worded and placed, is a port of
//! - https://github.com/oxc-project/oxc (Copyright VoidZero Inc. and contributors, MIT License)
//! - which is a port of https://github.com/facebook/react (Copyright Meta Platforms, Inc. and affiliates, MIT License)

#![forbid(unsafe_code)]

mod compile;
mod convert;
mod finding;
mod host;
mod oxlint;
mod program;
pub mod rule;
mod suppression;

pub use bun_react_compiler::diagnostics::ErrorCategory;
pub use compile::Flavor;
pub use finding::{Detail, Finding, Suggestion};
pub use oxlint::{Label, Rendered, render_all};

use bun_lint::ast::File;
use compile::Depth;
use std::cell::{Cell, OnceCell};

#[derive(Default)]
struct PerFlavor {
    wants_everything: Cell<bool>,
    findings: OnceCell<Vec<Finding>>,
}

#[derive(Default)]
struct PerFile {
    oxlint: PerFlavor,
    eslint: PerFlavor,
}

fn per_flavor<'a>(file: &'a File<'a>, flavor: Flavor) -> Option<&'a PerFlavor> {
    let per_file = file.extension(PerFile::default)?;
    Some(match flavor {
        Flavor::Oxlint => &per_file.oxlint,
        Flavor::Eslint => &per_file.eslint,
    })
}

/// [`findings`] is also to have what only the passes after the validations say, which is of the
/// categories `Todo` and `Invariant`. It counts if it is called before.
pub fn want_everything<'a>(file: &'a File<'a>, flavor: Flavor) {
    if let Some(per_flavor) = per_flavor(file, flavor) {
        per_flavor.wants_everything.set(true);
    }
}

/// What the compiler says of the file, in its order. It runs the first time this is asked.
pub fn findings<'a>(file: &'a File<'a>, flavor: Flavor) -> &'a [Finding] {
    let Some(per_flavor) = per_flavor(file, flavor) else {
        debug_assert!(false, "the file has no room for what the compiler says");
        return &[];
    };
    per_flavor.findings.get_or_init(|| {
        let depth = match per_flavor.wants_everything.get() {
            true => Depth::Everything,
            false => Depth::Validations,
        };
        program::compile_program(file, flavor, depth)
    })
}
