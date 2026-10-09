//! Where oxlint's ports of these rules differ from the plugins. With a configuration of oxlint a rule does what oxlint 1.80 does, so
//! that the comments and the baselines of a project stay valid.
//!
//! Each difference is behind a function that is named after what oxlint does, here or in [`bun_lint::modules::Flavor`], and has a
//! project in `test/cli/lint/oracle/plugins/oxlint`.

pub(crate) mod comments;
pub(crate) mod exhaustive_deps;
pub(crate) mod node;
pub(crate) mod promise;
pub(crate) mod rules_of_hooks;
pub(crate) mod vue;

use bun_lint::ast::File;
use bun_lint::modules::Flavor;

/// The file is linted with a configuration of oxlint.
pub(crate) fn is_followed(file: &File) -> bool {
    file.language().is_oxlint
}

pub(crate) fn flavor_of_modules(file: &File) -> Flavor {
    if is_followed(file) {
        Flavor::Oxlint
    } else {
        Flavor::EslintPluginImport
    }
}
