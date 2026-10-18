//! The order of oxfmt's `sortPackageJson`, which is that of the crate
//! [`sort-package-json`](https://crates.io/crates/sort-package-json) (MIT license, VoidZero Inc. and contributors).
//!
//! Besides what the header of `sort_package_json.rs` lists, this differs from the crate in two ways:
//! - From a list like `keywords`, the crate drops whatever isn't a string. Here such a list is left alone.
//! - The crate sorts nothing if `serde_json` can't read the text: it isn't strict JSON, or it's nested more than 127 deep.

use super::{Context, Document, KEPT, Over, Properties, SORTED};

const TYPE_URL: Over = Over::Keys(&["type", "url"], &[]);
const DEV_ENGINES: Over = Over::Values(&Over::EachOrSelf(&Over::Keys(
    &["name", "version", "onFail"],
    &[],
)));

/// The known keys, in order.
const FIELDS: Properties = &[
    // Core package metadata
    ("$schema", KEPT),
    ("name", KEPT),
    ("displayName", KEPT),
    ("version", KEPT),
    ("stableVersion", KEPT),
    ("gitHead", KEPT),
    ("private", KEPT),
    ("description", KEPT),
    ("categories", Over::UniqueSorted),
    ("keywords", Over::UniqueSorted),
    ("homepage", KEPT),
    ("bugs", Over::Keys(&["url", "email"], &[])),
    // License and people
    ("license", KEPT),
    ("author", Over::Keys(&["name", "email", "url"], &[])),
    ("maintainers", KEPT),
    ("contributors", KEPT),
    // Repository and funding
    ("repository", TYPE_URL),
    ("funding", TYPE_URL),
    ("donate", TYPE_URL),
    ("sponsor", TYPE_URL),
    ("qna", KEPT),
    ("publisher", KEPT),
    // Package content and distribution
    ("man", KEPT),
    ("style", KEPT),
    ("example", KEPT),
    ("examplestyle", KEPT),
    ("assets", KEPT),
    ("bin", SORTED),
    ("source", KEPT),
    (
        "directories",
        Over::Keys(&["lib", "bin", "man", "doc", "example", "test"], &[]),
    ),
    ("workspaces", KEPT),
    (
        "binary",
        Over::Keys(
            &[
                "module_name",
                "module_path",
                "remote_path",
                "package_name",
                "host",
            ],
            &[],
        ),
    ),
    ("files", Over::Unique),
    ("os", KEPT),
    ("cpu", KEPT),
    ("libc", Over::UniqueSorted),
    // Package entry points
    ("type", KEPT),
    ("sideEffects", KEPT),
    ("main", KEPT),
    ("module", KEPT),
    ("browser", KEPT),
    ("types", KEPT),
    ("typings", KEPT),
    ("typesVersions", KEPT),
    ("typeScriptVersion", KEPT),
    ("typesPublisherContentHash", KEPT),
    ("react-native", KEPT),
    ("svelte", KEPT),
    ("unpkg", KEPT),
    ("jsdelivr", KEPT),
    ("jsnext:main", KEPT),
    ("umd", KEPT),
    ("umd:main", KEPT),
    ("es5", KEPT),
    ("esm5", KEPT),
    ("fesm5", KEPT),
    ("es2015", KEPT),
    ("esm2015", KEPT),
    ("fesm2015", KEPT),
    ("es2020", KEPT),
    ("esm2020", KEPT),
    ("fesm2020", KEPT),
    ("esnext", KEPT),
    ("imports", KEPT),
    ("exports", KEPT),
    ("publishConfig", Over::Fields),
    // Scripts
    ("scripts", Over::ScriptsOfOxfmt),
    ("betterScripts", Over::ScriptsOfOxfmt),
    ("wireit", Over::ScriptsOfOxfmt),
    // Dependencies
    ("dependencies", SORTED),
    ("devDependencies", SORTED),
    ("dependenciesMeta", KEPT),
    ("peerDependencies", SORTED),
    ("peerDependenciesMeta", KEPT),
    ("optionalDependencies", SORTED),
    ("bundledDependencies", Over::UniqueSorted),
    ("bundleDependencies", Over::UniqueSorted),
    ("resolutions", SORTED),
    ("overrides", SORTED),
    // Git hooks and commit tools
    ("husky", Over::Deep(&[])),
    ("simple-git-hooks", KEPT),
    ("vite-staged", KEPT),
    ("lint-staged", KEPT),
    ("nano-staged", KEPT),
    ("pre-commit", KEPT),
    ("commitlint", Over::Deep(&[])),
    // Extensions of VS Code
    ("l10n", KEPT),
    ("contributes", KEPT),
    ("activationEvents", Over::UniqueSorted),
    ("extensionPack", Over::UniqueSorted),
    ("extensionDependencies", Over::UniqueSorted),
    ("extensionKind", Over::UniqueSorted),
    ("icon", KEPT),
    ("badges", KEPT),
    ("galleryBanner", KEPT),
    ("preview", KEPT),
    ("markdown", KEPT),
    // Configuration of build tools. Where the order of what is nested means something, only the top
    // level is sorted.
    ("napi", SORTED),
    ("flat", KEPT),
    ("config", SORTED),
    ("nodemonConfig", Over::Deep(&[])),
    ("browserify", Over::Deep(&[])),
    ("babel", Over::Deep(&[])),
    ("browserslist", KEPT),
    ("xo", Over::Deep(&[])),
    ("prettier", Over::Deep(&[])),
    ("eslintConfig", Over::Deep(&[])),
    ("eslintIgnore", KEPT),
    ("standard", Over::Deep(&[])),
    ("npmpkgjsonlint", KEPT),
    ("npmPackageJsonLintConfig", KEPT),
    ("npmpackagejsonlint", KEPT),
    ("release", KEPT),
    ("auto-changelog", SORTED),
    ("remarkConfig", SORTED),
    ("stylelint", Over::Deep(&[])),
    ("typescript", Over::Deep(&[])),
    ("typedoc", Over::Deep(&[])),
    ("tshy", SORTED),
    ("tsdown", Over::Deep(&[])),
    ("size-limit", KEPT),
    // Testing
    ("ava", Over::Deep(&[])),
    ("jest", SORTED),
    ("jest-junit", KEPT),
    ("jest-stare", KEPT),
    ("mocha", Over::Deep(&[])),
    ("nyc", Over::Deep(&[])),
    ("c8", Over::Deep(&[])),
    ("tap", KEPT),
    ("tsd", Over::Deep(&[])),
    ("typeCoverage", Over::Deep(&[])),
    ("oclif", Over::Deep(&[])),
    // Runtime and package manager
    ("languageName", KEPT),
    ("preferGlobal", KEPT),
    ("devEngines", DEV_ENGINES),
    ("engines", SORTED),
    ("engineStrict", KEPT),
    ("volta", Over::Deep(&[])),
    ("packageManager", KEPT),
    ("pnpm", KEPT),
];

pub(super) fn context(document: Document<'_>, sorts_scripts: bool) -> Context<'_> {
    Context {
        document,
        fields: FIELDS,
        first: &[],
        // How Rust compares strings.
        by_name: <[u8]>::cmp,
        sorts_scripts,
        sorts_dependencies_like_npm: false,
        has_sequential_script: false,
    }
}
