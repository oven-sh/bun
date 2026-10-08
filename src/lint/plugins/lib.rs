//! Rules of plugins that many projects use with ESLint and oxlint. Each is a port of the rule of the same name, with the same
//! options, the same messages, at the same places:
//! - `react-hooks`: https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks (Copyright Meta Platforms,
//!   Inc. and affiliates, MIT License)
//! - `import`: https://github.com/import-js/eslint-plugin-import (Copyright Ben Mosher, MIT License)
//! - `n`: https://github.com/eslint-community/eslint-plugin-n (Copyright Toru Nagashima, MIT License)
//! - `oxc`: https://github.com/oxc-project/oxc (Copyright VoidZero Inc. and contributors, MIT License)

mod n;

bun_lint::rules! {
    import_no_cycle::NoCycle,
    import_no_mutable_exports::NoMutableExports,
    n_no_unsupported_features_es_builtins::EsBuiltins,
    n_no_unsupported_features_node_builtins::NodeBuiltins,
    oxc_no_accumulating_spread::NoAccumulatingSpread,
    react_hooks_exhaustive_deps::ExhaustiveDeps,
    react_hooks_rules_of_hooks::RulesOfHooks,
}
