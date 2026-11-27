//! The React Compiler as lint rules: `react-hooks/refs`, `react-hooks/immutability` and so on in
//! `eslint-plugin-react-hooks`, and `react/refs`, `react/immutability` and so on in oxlint.
//!
//! The compiler is Bun's (`src/react_compiler`), with its own lowering. Each function that could be
//! a component or a hook is converted to the tree that Bun's parser would produce for it
//! ([`convert`]), and is compiled once for all rules.
//!
//! The choice of functions to compile, and the wording and placement of the diagnostics, are a port of
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
use bun_lint::regex::Regex;
use bun_react_compiler::Categories;
use std::cell::{Cell, OnceCell};
use std::sync::Arc;

/// oxlint's `ReactCompilerEnvOptions`: what the options of its `react/capitalized-calls` add to the compiler's config.
pub struct EnvOptions {
    /// Capitalized functions that may be called.
    pub capitalized_calls_allow: Vec<String>,
    /// A capitalized function whose name it matches may be called too.
    pub capitalized_calls_allow_pattern: Option<Regex>,
}

#[derive(Default)]
struct PerFlavor {
    wanted: Cell<Categories>,
    /// The findings, and the value of `wanted` when the compiler ran.
    findings: OnceCell<(Vec<Finding>, Categories)>,
}

#[derive(Default)]
struct PerFile {
    oxlint: PerFlavor,
    eslint: PerFlavor,
    /// For `oxlint`.
    env_options: OnceCell<Arc<EnvOptions>>,
}

fn per_flavor<'a>(file: &'a File<'a>, flavor: Flavor) -> Option<&'a PerFlavor> {
    let per_file = file.extension(PerFile::default)?;
    Some(match flavor {
        Flavor::Oxlint => &per_file.oxlint,
        Flavor::Eslint => &per_file.eslint,
    })
}

/// Asks [`findings`] to include the compiler's diagnostics in `category`. It only has an effect
/// before the first [`findings`] call.
pub fn want<'a>(file: &'a File<'a>, flavor: Flavor, category: ErrorCategory) {
    if let Some(per_flavor) = per_flavor(file, flavor) {
        (per_flavor.wanted).set(per_flavor.wanted.get().with(category));
    }
}

/// Gives the compiler the options of oxlint's `react/capitalized-calls` for the file. Like [`want`], it only has an
/// effect before the first [`findings`] call.
pub fn set_env_options<'a>(file: &'a File<'a>, options: &Arc<EnvOptions>) {
    if let Some(per_file) = file.extension(PerFile::default) {
        debug_assert!(per_file.oxlint.findings.get().is_none());
        per_file.env_options.get_or_init(|| Arc::clone(options));
    }
}

fn env_options<'a>(file: &'a File<'a>) -> Option<&'a EnvOptions> {
    let per_file = file.extension(PerFile::default)?;
    per_file.env_options.get().map(|it| &**it)
}

/// The compiler's diagnostics for the file in the [wanted](want) categories, in the compiler's
/// order. There may be some from other categories too. The compiler runs on the first call.
pub fn findings<'a>(file: &'a File<'a>, flavor: Flavor) -> &'a [Finding] {
    let Some(per_flavor) = per_flavor(file, flavor) else {
        debug_assert!(false, "the file has no slot for the compiler's findings");
        return &[];
    };
    let wanted = per_flavor.wanted.get();
    let (findings, wanted_then) = per_flavor.findings.get_or_init(|| {
        let findings = program::compile_program(file, flavor, wanted);
        #[cfg(debug_assertions)]
        {
            let only_wanted = |all: &[Finding]| -> Vec<Finding> {
                let is_wanted = |it: &&Finding| wanted.has(it.category);
                all.iter().filter(is_wanted).cloned().collect()
            };
            // oxlint leaves passes out if it wants nothing that they throw, and that changes what else it says.
            let everything = match flavor == Flavor::Oxlint && !wanted.has_thrown() {
                true => Categories::RECORDED,
                false => Categories::ALL,
            };
            let all = program::compile_program(file, flavor, everything);
            debug_assert_eq!(only_wanted(&findings), only_wanted(&all));
        }
        (findings, wanted)
    });
    debug_assert_eq!(*wanted_then, wanted);
    findings
}
