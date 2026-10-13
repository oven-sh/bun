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
mod eslint;
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
use bun_react_compiler::Categories;
use std::cell::{Cell, OnceCell};

#[derive(Default)]
struct PerFlavor {
    wanted: Cell<Categories>,
    /// And what was wanted when the compiler ran.
    findings: OnceCell<(Vec<Finding>, Categories)>,
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

/// [`findings`] is to have what the compiler says in `category`. It counts if it is called before.
pub fn want<'a>(file: &'a File<'a>, flavor: Flavor, category: ErrorCategory) {
    if let Some(per_flavor) = per_flavor(file, flavor) {
        (per_flavor.wanted).set(per_flavor.wanted.get().with(category));
    }
}

/// What the compiler says of the file in the categories that are [wanted](want), in its order, and
/// perhaps more. It runs the first time this is asked.
pub fn findings<'a>(file: &'a File<'a>, flavor: Flavor) -> &'a [Finding] {
    let Some(per_flavor) = per_flavor(file, flavor) else {
        debug_assert!(false, "the file has no room for what the compiler says");
        return &[];
    };
    let wanted = per_flavor.wanted.get();
    let (findings, wanted_then) = per_flavor.findings.get_or_init(|| {
        let findings = program::compile_program(file, flavor, wanted);
        #[cfg(debug_assertions)]
        {
            let of_wanted = |all: &[Finding]| -> Vec<Finding> {
                let is_wanted = |it: &&Finding| wanted.has(it.category);
                all.iter().filter(is_wanted).cloned().collect()
            };
            let all = program::compile_program(file, flavor, Categories::ALL);
            debug_assert_eq!(of_wanted(&findings), of_wanted(&all));
        }
        (findings, wanted)
    });
    debug_assert_eq!(*wanted_then, wanted);
    findings
}
