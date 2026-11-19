//! The differences between oxlint's ports of these rules and the original plugins. With an oxlint config, a rule
//! behaves like oxlint 1.87, so that a project's disable comments and baselines stay valid.
//!
//! Each difference is behind a function named after what oxlint does, here or in [`bun_lint::modules::Flavor`], and has
//! a test project in `test/cli/lint/oracle/plugins/oxlint`.

pub(crate) mod exhaustive_deps;
pub(crate) mod node;
pub(crate) mod promise;
pub(crate) mod rules_of_hooks;

use bun_lint::ast::File;
use bun_lint::modules::Flavor;

/// True if the file is linted with an oxlint config.
pub(crate) fn is_followed(file: &File) -> bool {
    file.language().is_oxlint
}

pub(crate) fn module_flavor(file: &File) -> Flavor {
    if is_followed(file) {
        Flavor::Oxlint
    } else {
        Flavor::EslintPluginImport
    }
}
