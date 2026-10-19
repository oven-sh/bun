//! The order of oxfmt's `sortPackageJson`, which comes from the
//! [`sort-package-json`](https://crates.io/crates/sort-package-json) crate (MIT license, VoidZero Inc. and
//! contributors).
//!
//! Besides what the header of `sort_package_json.rs` lists, this differs from the crate in two ways:
//! - From a list like `keywords`, the crate drops whatever isn't a string. Here such a list is left alone.
//! - The crate sorts nothing if `serde_json` can't read the text: it isn't strict JSON, or it's nested more than 127 deep.

use super::{AS_IS, Context, Document, Over, Properties, SORTED};

const TYPE_URL: Over = Over::Keys(&["type", "url"], &[]);
const DEV_ENGINES: Over = Over::Values(&Over::EachOrSelf(&Over::Keys(
    &["name", "version", "onFail"],
    &[],
)));

/// The known keys, in order.
const FIELDS: Properties = &[
    // Core package metadata
    ("$schema", AS_IS),
    ("name", AS_IS),
    ("displayName", AS_IS),
    ("version", AS_IS),
    ("stableVersion", AS_IS),
    ("gitHead", AS_IS),
    ("private", AS_IS),
    ("description", AS_IS),
    ("categories", Over::UniqueSorted),
    ("keywords", Over::UniqueSorted),
    ("homepage", AS_IS),
    ("bugs", Over::Keys(&["url", "email"], &[])),
    // License and people
    ("license", AS_IS),
    ("author", Over::Keys(&["name", "email", "url"], &[])),
    ("maintainers", AS_IS),
    ("contributors", AS_IS),
    // Repository and funding
    ("repository", TYPE_URL),
    ("funding", TYPE_URL),
    ("donate", TYPE_URL),
    ("sponsor", TYPE_URL),
    ("qna", AS_IS),
    ("publisher", AS_IS),
    // Package content and distribution
    ("man", AS_IS),
    ("style", AS_IS),
    ("example", AS_IS),
    ("examplestyle", AS_IS),
    ("assets", AS_IS),
    ("bin", SORTED),
    ("source", AS_IS),
    (
        "directories",
        Over::Keys(&["lib", "bin", "man", "doc", "example", "test"], &[]),
    ),
    ("workspaces", AS_IS),
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
    ("os", AS_IS),
    ("cpu", AS_IS),
    ("libc", Over::UniqueSorted),
    // Package entry points
    ("type", AS_IS),
    ("sideEffects", AS_IS),
    ("main", AS_IS),
    ("module", AS_IS),
    ("browser", AS_IS),
    ("types", AS_IS),
    ("typings", AS_IS),
    ("typesVersions", AS_IS),
    ("typeScriptVersion", AS_IS),
    ("typesPublisherContentHash", AS_IS),
    ("react-native", AS_IS),
    ("svelte", AS_IS),
    ("unpkg", AS_IS),
    ("jsdelivr", AS_IS),
    ("jsnext:main", AS_IS),
    ("umd", AS_IS),
    ("umd:main", AS_IS),
    ("es5", AS_IS),
    ("esm5", AS_IS),
    ("fesm5", AS_IS),
    ("es2015", AS_IS),
    ("esm2015", AS_IS),
    ("fesm2015", AS_IS),
    ("es2020", AS_IS),
    ("esm2020", AS_IS),
    ("fesm2020", AS_IS),
    ("esnext", AS_IS),
    ("imports", AS_IS),
    ("exports", AS_IS),
    ("publishConfig", Over::Fields),
    // Scripts
    ("scripts", Over::OxfmtScripts),
    ("betterScripts", Over::OxfmtScripts),
    ("wireit", Over::OxfmtScripts),
    // Dependencies
    ("dependencies", SORTED),
    ("devDependencies", SORTED),
    ("dependenciesMeta", AS_IS),
    ("peerDependencies", SORTED),
    ("peerDependenciesMeta", AS_IS),
    ("optionalDependencies", SORTED),
    ("bundledDependencies", Over::UniqueSorted),
    ("bundleDependencies", Over::UniqueSorted),
    ("resolutions", SORTED),
    ("overrides", SORTED),
    // Git hooks and commit tools
    ("husky", Over::Deep(&[])),
    ("simple-git-hooks", AS_IS),
    ("vite-staged", AS_IS),
    ("lint-staged", AS_IS),
    ("nano-staged", AS_IS),
    ("pre-commit", AS_IS),
    ("commitlint", Over::Deep(&[])),
    // VS Code extensions
    ("l10n", AS_IS),
    ("contributes", AS_IS),
    ("activationEvents", Over::UniqueSorted),
    ("extensionPack", Over::UniqueSorted),
    ("extensionDependencies", Over::UniqueSorted),
    ("extensionKind", Over::UniqueSorted),
    ("icon", AS_IS),
    ("badges", AS_IS),
    ("galleryBanner", AS_IS),
    ("preview", AS_IS),
    ("markdown", AS_IS),
    // Build tool configuration. Where the order of nested keys is meaningful, only the top level is sorted.
    ("napi", SORTED),
    ("flat", AS_IS),
    ("config", SORTED),
    ("nodemonConfig", Over::Deep(&[])),
    ("browserify", Over::Deep(&[])),
    ("babel", Over::Deep(&[])),
    ("browserslist", AS_IS),
    ("xo", Over::Deep(&[])),
    ("prettier", Over::Deep(&[])),
    ("eslintConfig", Over::Deep(&[])),
    ("eslintIgnore", AS_IS),
    ("standard", Over::Deep(&[])),
    ("npmpkgjsonlint", AS_IS),
    ("npmPackageJsonLintConfig", AS_IS),
    ("npmpackagejsonlint", AS_IS),
    ("release", AS_IS),
    ("auto-changelog", SORTED),
    ("remarkConfig", SORTED),
    ("stylelint", Over::Deep(&[])),
    ("typescript", Over::Deep(&[])),
    ("typedoc", Over::Deep(&[])),
    ("tshy", SORTED),
    ("tsdown", Over::Deep(&[])),
    ("size-limit", AS_IS),
    // Testing
    ("ava", Over::Deep(&[])),
    ("jest", SORTED),
    ("jest-junit", AS_IS),
    ("jest-stare", AS_IS),
    ("mocha", Over::Deep(&[])),
    ("nyc", Over::Deep(&[])),
    ("c8", Over::Deep(&[])),
    ("tap", AS_IS),
    ("tsd", Over::Deep(&[])),
    ("typeCoverage", Over::Deep(&[])),
    ("oclif", Over::Deep(&[])),
    // Runtime and package manager
    ("languageName", AS_IS),
    ("preferGlobal", AS_IS),
    ("devEngines", DEV_ENGINES),
    ("engines", SORTED),
    ("engineStrict", AS_IS),
    ("volta", Over::Deep(&[])),
    ("packageManager", AS_IS),
    ("pnpm", AS_IS),
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
