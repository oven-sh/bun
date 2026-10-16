//! CLI Arguments for:
//!
//! - bun install
//! - bun update
//! - bun patch
//! - bun patch-commit
//! - bun pm
//! - bun add
//! - bun remove
//! - bun link
//! - bun audit

use crate::bun_schema::api::BunInstall;
use crate::package_install;
use crate::package_manager_real::PackageManagerCommand;
use crate::package_manager_real::Subcommand;
use bun_clap as clap;
use bun_core::strings;
use bun_core::{Global, Output};
use bun_install::npm as Npm;
use bun_paths as Path;

use std::sync::OnceLock;

use super::package_manager_options as Options;

/// `Output.pretty(text, .{})` — single-pass `<tag>` → ANSI rewrite of a help
/// template to stdout. Don't wrap in `format_args!`: a second rewrite pass
/// would delete the already-unescaped `\<name\>` placeholders as unknown tags.
#[inline]
#[allow(clippy::disallowed_methods)] // template is a runtime &str parameter
fn pretty_help(text: &str) {
    Output::pretty(text);
}

/// `--cpu` / `--os` / `--libc`. Unlike in a package.json array, an unknown name is fatal.
fn parse_platform_flag<T: Npm::NegatableEnum>(
    values: &[&[u8]],
    what: &str,
    valid_names: &str,
) -> Option<T> {
    if values.is_empty() {
        return None;
    }
    let mut negatable = Npm::Negatable::<T>::default();
    for &value in values {
        match value {
            b"*" => negatable.had_wildcard = true,
            b"any" | b"none" => negatable.apply(value),
            _ => {
                let name = value.strip_prefix(b"!").unwrap_or(value);
                if T::lookup_name(name).is_none() {
                    Output::err_generic(
                        "invalid {}: '{}'. valid values: *, any, {}. use !name to negate",
                        (what, bstr::BStr::new(value), valid_names),
                    );
                    Global::crash();
                }
                negatable.apply(value);
            }
        }
    }
    Some(negatable.combine())
}

type ParamType = clap::Param<clap::Help>;
/// A list of slices that's joined on use, because a param is 96 bytes and most params are shared by
/// 17 commands.
type ParamTable = &'static [&'static [ParamType]];

// `bun_clap::concat_params!` is a const-fn slice concat over `Param<Help>`.
use bun_clap::concat_params;

// `clap::param!` is a proc-macro that requires a
// *literal* token (it parses the spec at compile time), so `const_format::concatcp!`
// can't feed it. Instead we cfg-select the fully-expanded literal per platform.
#[cfg(target_os = "macos")]
const BACKEND_PARAM: ParamType = clap::param!(
    "--backend <STR>                       Platform-specific optimizations for installing dependencies. Possible values: \"clonefile\" (default), \"hardlink\", \"symlink\", \"copyfile\""
);
#[cfg(not(target_os = "macos"))]
const BACKEND_PARAM: ParamType = clap::param!(
    "--backend <STR>                       Platform-specific optimizations for installing dependencies. Possible values: \"hardlink\" (default), \"symlink\", \"copyfile\""
);

// The flags of `AUTO_PARAMS` (runtime/cli/Arguments.rs) that take no value and that no table here
// has. They're ignored.
const RUNTIME_FLAGS_PARAM: ParamType = clap::param!(
    "-b, --bun/--no-orphans/--workspaces/--parallel/--sequential/--no-exit-on-error/--version/--revision/--watch/--hot/--no-clear-screen/--smol/--cpu-prof/--cpu-prof-md/--heap-prof/--heap-prof-md/--if-present/--no-install/--prefer-latest/--experimental-http2-fetch/--experimental-http3-fetch/--insecure-http-parser/--experimental-stream-iter/--expose-gc/--no-deprecation/--throw-deprecation/--no-warnings/--trace-warnings/--trace-deprecation/--pending-deprecation/--zero-fill-buffers/--tls-min-v1.0/--tls-min-v1.1/--tls-min-v1.2/--tls-min-v1.3/--tls-max-v1.2/--tls-max-v1.3/--redis-preconnect/--sql-preconnect/--no-addons/--no-ffi-cc/--trace-events-enabled/--trace-env/--trace-env-js-stack/--trace-env-native-stack/--trace-exit/--expose-internals/--preserve-symlinks/--preserve-symlinks-main/--no-macros/--jsx-side-effects/--ignore-dce-annotations"
);

const SHARED_HEAD_PARAMS: &[ParamType] = &[
    clap::param!("-c, --config <STR>?                   Specify path to config file (bunfig.toml)"),
    clap::param!("-y, --yarn                            Write a yarn.lock file (yarn v1)"),
];

const PRODUCTION_PARAMS: &[ParamType] = &[
    clap::param!("-p, --production                      Don't install devDependencies"),
    clap::param!("-P, --prod"),
];

// `LINK_SHARED_PARAMS` swaps out the first two.
const SHARED_TAIL_PARAMS: &[ParamType] = &[
    clap::param!(
        "--no-save                             Don't update package.json or save a lockfile"
    ),
    clap::param!("--save                                Save to package.json (true by default)"),
    clap::param!(
        "--ca <STR>...                         Provide a Certificate Authority signing certificate"
    ),
    clap::param!(
        "--cafile <STR>                        The same as `--ca`, but is a file path to the certificate"
    ),
    clap::param!("--dry-run                             Perform a dry run without making changes"),
    clap::param!("--frozen-lockfile                     Disallow changes to lockfile"),
    clap::param!(
        "-f, --force                           Always request the latest versions from the registry & reinstall all dependencies"
    ),
    clap::param!(
        "--cache-dir <PATH>                    Store & load cached data from a specific directory path"
    ),
    clap::param!("--no-cache                            Ignore manifest cache entirely"),
    clap::param!("--silent                              Don't log anything"),
    clap::param!("--quiet                               Only show tarball name when packing"),
    clap::param!("--verbose                             Excessively verbose logging"),
    clap::param!("--no-progress                         Disable the progress bar"),
    clap::param!("--no-summary                          Don't print a summary"),
    clap::param!(
        "--no-verify                           Skip verifying integrity of newly downloaded packages"
    ),
    clap::param!(
        "--offline                             Never touch the network: resolve and install only from the local cache"
    ),
    clap::param!(
        "--prefer-offline                      Use cached package metadata regardless of age; only fetch what is missing"
    ),
    clap::param!(
        "--ignore-scripts                      Skip lifecycle scripts for all packages, including the project's package.json and trusted dependencies"
    ),
    clap::param!(
        "--trust                               Add to trustedDependencies in the project's package.json and install the package(s)"
    ),
    clap::param!("-g, --global                          Install globally"),
    clap::param!("--cwd <STR>                           Set a specific cwd"),
    clap::param!(
        "--env-file <STR>...                   Load environment variables from the specified file(s)"
    ),
    clap::param!("--no-env-file                         Disable automatic loading of .env files"),
    BACKEND_PARAM,
    clap::param!(
        "--registry <STR>                      Use a specific registry by default, overriding .npmrc, bunfig.toml and environment variables"
    ),
    clap::param!(
        "--concurrent-scripts <NUM>            Maximum number of concurrent jobs for lifecycle scripts (default: 2x CPU cores)"
    ),
    clap::param!(
        "--network-concurrency <NUM>           Maximum number of concurrent network requests (default 64)"
    ),
    clap::param!("--save-text-lockfile                  Save a text-based lockfile"),
    clap::param!(
        "--omit <dev|optional|peer>...         Exclude 'dev', 'optional', or 'peer' dependencies from install"
    ),
    clap::param!(
        "--lockfile-only                       Generate a lockfile without installing dependencies"
    ),
    clap::param!(
        "--linker <STR>                        Linker strategy (one of \"isolated\" or \"hoisted\")"
    ),
    clap::param!(
        "--minimum-release-age <NUM>           Only install packages published at least N seconds ago (security feature)"
    ),
    clap::param!(
        "--minimum-release-age-excludes <STR>...  Packages exempt from --minimum-release-age (comma-separated or repeated; replaces the bunfig.toml list)"
    ),
    clap::param!(
        "--cpu <STR>...                        Override CPU architecture for optional dependencies (e.g., x64, arm64, * for all)"
    ),
    clap::param!(
        "--os <STR>...                         Override operating system for optional dependencies (e.g., linux, darwin, * for all)"
    ),
    clap::param!(
        "--libc <STR>...                       Override libc for optional dependencies (e.g., glibc, musl, * for all)"
    ),
    clap::param!(
        "--use-system-ca                       Use the system's trusted certificate authorities"
    ),
    clap::param!("--use-openssl-ca                      Use OpenSSL's default CA store"),
    clap::param!("--use-bundled-ca                      Use bundled CA store"),
    clap::param!("-h, --help                            Print this help menu"),
    RUNTIME_FLAGS_PARAM,
];

const SHARED_PARAMS: &[ParamType] =
    concat_params![SHARED_HEAD_PARAMS, PRODUCTION_PARAMS, SHARED_TAIL_PARAMS];

// `parse` gives link and unlink the opposite default: they only save when --save is passed.
const LINK_SHARED_PARAMS: &[ParamType] = concat_params![
    SHARED_HEAD_PARAMS,
    PRODUCTION_PARAMS,
    &[
        clap::param!(
            "--no-save                             Don't update package.json or save a lockfile (the default)"
        ),
        clap::param!(
            "--save                                Update package.json and save a lockfile (false by default)"
        ),
    ],
    SHARED_TAIL_PARAMS.split_at(2).1
];

pub(crate) static INSTALL_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!("-d, --dev                 Add dependency to \"devDependencies\""),
        clap::param!("-D, --development"),
        clap::param!(
            "--optional                        Add dependency to \"optionalDependencies\""
        ),
        clap::param!("--peer                        Add dependency to \"peerDependencies\""),
        clap::param!(
            "--save-prod                   Add dependency to \"dependencies\", also when another group lists it"
        ),
        clap::param!("-E, --exact                  Add the exact version instead of the ^range"),
        clap::param!(
            "-F, --filter <STR>...             Install packages for the matching workspaces"
        ),
        clap::param!(
            "-a, --analyze                   Analyze & install all dependencies of files passed as arguments recursively (using Bun's bundler)"
        ),
        clap::param!(
            "--only-missing                  Only add dependencies to package.json if they are not already present"
        ),
        clap::param!(
            "--catalog <STR>?                Add the resolved version to the root package.json catalog and depend on it as \"catalog:\" (use --catalog=NAME for a named catalog)"
        ),
        clap::param!("<POS> ...                         "),
    ],
];

pub(crate) static UPDATE_PARAMS: ParamTable = &[
    SHARED_HEAD_PARAMS,
    &[
        clap::param!(
            "-p, --production                      Only update dependencies and optionalDependencies (alias: --prod)"
        ),
        clap::param!("-P, --prod"),
    ],
    SHARED_TAIL_PARAMS,
    &[
        clap::param!(
            "-L, --latest                          Update packages to their latest versions, ignoring the ranges in package.json"
        ),
        clap::param!(
            "-i, --interactive                     Show an interactive list of outdated packages to select for update"
        ),
        clap::param!(
            "-F, --filter <STR>...                 Update packages for the matching workspaces"
        ),
        clap::param!("-r, --recursive                       Update packages in all workspaces"),
        clap::param!("-d, --dev                             Only update devDependencies"),
        clap::param!("-D, --development"),
        clap::param!("--no-optional                         Don't update optionalDependencies"),
        clap::param!(
            "--depth <NUM>                         Only 0 is accepted: update direct dependencies and keep transitive dependencies at their locked versions"
        ),
        clap::param!(
            "-E, --exact                           Write exact versions to package.json instead of ^ or ~ ranges"
        ),
        clap::param!(
            "<POS> ...                             \"name\" or pattern (\"@scope/*\", \"!name\") of packages to update"
        ),
    ],
];

pub(crate) static PM_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!("-a, --all"),
        clap::param!("--trusted"),
        // `bun ./bun.lockb --hash` parses its argv with this table.
        clap::param!("--hash"),
        clap::param!("--json                              Output in JSON format"),
        clap::param!(
            "--diff <STR>...                        A package spec or path to compare (bun pm diff; may be given twice)"
        ),
        clap::param!(
            "--raw                                  Compare file bytes as-is; skip the JS/CSS/JSON re-print (bun pm diff)"
        ),
        clap::param!("--unformatted                          Alias of --raw (bun pm diff)"),
        clap::param!(
            "--unminify                             Rename short locals in lockstep in every JS file, not only ones that look minified (bun pm diff)"
        ),
        clap::param!(
            "--minify                               Also normalise syntax (!0 vs true, quotes, parens…) so equivalent spellings collapse (bun pm diff)"
        ),
        clap::param!(
            "-w, --ignore-space                     Show files that differ only in whitespace as 'whitespace only' instead of hunks (bun pm diff)"
        ),
        clap::param!(
            "--name-only                            Only list the files that differ (bun pm diff)"
        ),
        clap::param!(
            "--stat                                 Show a per-file change summary instead of hunks (bun pm diff)"
        ),
        clap::param!(
            "-U, --unified <STR>                    Lines of context around each change (bun pm diff, default 3)"
        ),
        clap::param!(
            "-F, --filter <STR>...                  List only the matching workspaces' dependencies (bun pm licenses)"
        ),
        clap::param!(
            "-D, --dev                              List only the packages pulled in by devDependencies (bun pm licenses)"
        ),
        clap::param!(
            "--long                                 Also print author, description and homepage (bun pm licenses)"
        ),
        clap::param!(
            "--destination <STR>                    The directory the tarball will be saved in"
        ),
        clap::param!("--filename <STR>                       The filename of the tarball"),
        clap::param!(
            "--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9."
        ),
        clap::param!("--git-tag-version <BOOL>               Create a git commit and tag"),
        clap::param!("--no-git-tag-version"),
        clap::param!("--allow-same-version                   Allow bumping to the same version"),
        clap::param!("-m, --message <STR>                    Use the given message for the commit"),
        clap::param!(
            "--preid <STR>                          Identifier to be used to prefix premajor, preminor, prepatch or prerelease version increments"
        ),
        clap::param!(
            "--top                                Show only the first level of dependencies"
        ),
        clap::param!(
            "--depth <NUM>                          Maximum depth of the dependency tree to display"
        ),
        clap::param!(
            "--max-age <NUM>                        Remove cache entries older than this many days (bun pm cache prune, default 30)"
        ),
        clap::param!("<POS> ...                         "),
    ],
];

/// Flags in `PM_PARAMS` that only some `bun pm` subcommands accept. `parse` rejects them for every
/// other subcommand.
const PM_SUBCOMMAND_FLAGS: &[(&[u8], &[&[u8]])] = &[
    (b"cache", &[b"--max-age"]),
    (
        b"diff",
        &[
            b"--diff",
            b"--json",
            b"--raw",
            b"--unformatted",
            b"--unminify",
            b"--minify",
            b"--ignore-space",
            b"--name-only",
            b"--stat",
            b"--unified",
        ],
    ),
    (b"licenses", &[b"--json", b"--filter", b"--dev", b"--long"]),
    (b"ls", &[b"--all", b"--trusted", b"--depth"]),
    (b"pack", &[b"--destination", b"--filename", b"--gzip-level"]),
    (b"pkg", &[b"--json"]),
    (b"trust", &[b"--all"]),
    (
        b"version",
        &[
            b"--git-tag-version",
            b"--no-git-tag-version",
            b"--allow-same-version",
            b"--message",
            b"--preid",
        ],
    ),
    (b"view", &[b"--json"]),
    (b"why", &[b"--top", b"--depth"]),
];

/// How `bun install`, `add`, `remove` and `update` treat a flag that belongs to npm, yarn or pnpm.
#[derive(Clone, Copy)]
enum ForeignFlag {
    /// Means the same as this Bun flag, so it is rewritten to it.
    AliasOf(&'static [u8]),
    /// Asks for something Bun always does, whatever its configuration, so the flag is ignored.
    Satisfied,
}
use ForeignFlag::{AliasOf, Satisfied};

/// An entry written as `--name=value` also matches `--name value`. A flag that isn't listed here
/// or in `IGNORED_FOREIGN_FLAGS`, and isn't one of Bun's own, is an error.
const FOREIGN_FLAGS: &[(&[u8], ForeignFlag)] = &[
    (b"--save-dev", AliasOf(b"--dev")),
    (b"--save-exact", AliasOf(b"--exact")),
    (b"--save-optional", AliasOf(b"--optional")),
    (b"--save-peer", AliasOf(b"--peer")),
    (b"--save-catalog", AliasOf(b"--catalog")),
    (b"--location=global", AliasOf(b"--global")),
    (b"--no-optional", AliasOf(b"--omit=optional")),
    (b"--ignore-optional", AliasOf(b"--omit=optional")),
    // Not `--production`, because `--production` also freezes the lockfile.
    (b"--only=prod", AliasOf(b"--omit=dev")),
    (b"--only=production", AliasOf(b"--omit=dev")),
    (b"--production=true", AliasOf(b"--production")),
    (b"--package-lock-only", AliasOf(b"--lockfile-only")),
    (b"--immutable", AliasOf(b"--frozen-lockfile")),
    (b"--shamefully-hoist", AliasOf(b"--linker=hoisted")),
    (b"--progress=false", AliasOf(b"--no-progress")),
    (b"--loglevel=silent", AliasOf(b"--silent")),
    (b"--loglevel=error", AliasOf(b"--quiet")),
    (b"--loglevel=warn", AliasOf(b"--quiet")),
    (b"--loglevel=notice", Satisfied),
    (b"--loglevel=http", Satisfied),
    (b"--loglevel=info", Satisfied),
    (b"--loglevel=verbose", AliasOf(b"--verbose")),
    (b"--loglevel=silly", AliasOf(b"--verbose")),
    // `bun install` never audits, prints funding messages, or checks for a newer version of itself.
    (b"--no-audit", Satisfied),
    (b"--audit=false", Satisfied),
    (b"--no-fund", Satisfied),
    (b"--fund=false", Satisfied),
    (b"--no-update-notifier", Satisfied),
    (b"--update-notifier=false", Satisfied),
    // Bun only warns about conflicting peer dependencies, does not check `engines`, runs scripts as
    // the current user, and never prompts.
    (b"--legacy-peer-deps", Satisfied),
    (b"--ignore-engines", Satisfied),
    (b"--unsafe-perm", Satisfied),
    (b"--non-interactive", Satisfied),
    (b"--prefer-frozen-lockfile", Satisfied),
    (b"--install-strategy=hoisted", AliasOf(b"--linker=hoisted")),
    (b"--install-strategy=linked", AliasOf(b"--linker=isolated")),
    (b"--node-linker=hoisted", AliasOf(b"--linker=hoisted")),
    (b"--node-linker=node-modules", AliasOf(b"--linker=hoisted")),
    (b"--node-linker=isolated", AliasOf(b"--linker=isolated")),
    (b"--node-linker=pnpm", AliasOf(b"--linker=isolated")),
];

/// Flags of npm, yarn and pnpm that Bun has no equivalent for. `bun install`, `add`, `remove` and
/// `update` skip them, like Bun 1.4 and earlier did, so scripts written for those tools keep working.
const IGNORED_FOREIGN_FLAGS: clap::IgnoredLongFlags = clap::IgnoredLongFlags {
    #[rustfmt::skip]
    flags: &[
    b"aggregate-output", b"all", b"allow-same-version", b"audit", b"auto-dedupe",
    b"auto-install-peers", b"bin-links", b"cached", b"caret", b"changeset", b"check-cache",
    b"check-files", b"check-resolutions", b"ci", b"color", b"dangerously-allow-all-builds",
    b"dangerously-allow-all-scripts", b"dedupe-peer-dependents", b"default-rc", b"disable-pnp",
    b"emoji", b"enable-pnp", b"engine-strict", b"fail-if-no-match", b"fix-lockfile", b"fixed",
    b"flat", b"focus", b"foreground-scripts", b"format-package-lock", b"frozen-store", b"fund",
    b"global-style", b"har", b"hoist", b"ignore-manifest-check", b"ignore-platform",
    b"ignore-pnpmfile", b"ignore-workspace", b"ignore-workspace-root-check", b"immutable-cache",
    b"include-github-actions", b"include-workspace-root", b"inline-builds", b"install-links", b"iwr",
    b"json", b"legacy-bundling", b"link-duplicates", b"link-workspace-packages",
    b"lockfile", b"long", b"merge-git-branch-lockfiles", b"no-frozen-lockfile", b"no-immutable",
    b"no-prefer-frozen-lockfile", b"no-production", b"no-proxy", b"node-version-check",
    b"omit-lockfile-registry-resolved", b"package-lock", b"parseable", b"patches", b"pnp",
    b"prefer-dedupe", b"prefer-online", b"prefer-workspace-packages", b"progress", b"pure-lockfile",
    b"rebuild-bundle", b"recursive", b"refresh-lockfile", b"resolution-only",
    b"resolve-peers-from-workspace-root", b"reverse", b"runtime", b"save-build", b"save-bundle",
    b"save-types", b"scripts-prepend-node-path", b"shared-workspace-lockfile",
    b"shrinkwrap", b"side-effects-cache", b"skip-integrity-check", b"sort", b"stream",
    b"strict-allow-scripts", b"strict-peer-dependencies", b"strict-peer-deps", b"strict-semver",
    b"strict-ssl", b"symlink", b"tilde", b"timing", b"trust-lockfile", b"unicode",
    b"update-checksums", b"update-notifier", b"use-running-store-server", b"use-stderr",
    b"use-store-server", b"verify-store-integrity", b"workspace-root", b"workspaces-update", b"ws",
    b"yes",
    // These are in `FOREIGN_FLAGS` too, which doesn't match them if they have a value.
    b"ignore-engines", b"ignore-optional", b"immutable", b"legacy-peer-deps", b"non-interactive",
    b"package-lock-only", b"prefer-frozen-lockfile", b"save-catalog", b"save-dev", b"save-exact",
    b"save-optional", b"save-peer", b"save-prod", b"shamefully-hoist", b"unsafe-perm",
    ],
    #[rustfmt::skip]
    options: &[
    b"allow-build", b"allow-directory", b"allow-file", b"allow-git", b"allow-remote",
    b"allow-scripts", b"also", b"before", b"cache", b"cache-folder", b"cache-max",
    b"cache-min", b"cert", b"changed-files-ignore-pattern", b"child-concurrency", b"dir",
    b"enjoy-by", b"fetch-min-speed-ki-bps", b"fetch-retries", b"fetch-retry-factor", b"fetch-retry-maxtimeout",
    b"fetch-retry-mintimeout", b"fetch-timeout", b"fetch-warn-timeout-ms", b"filter-prod",
    b"global-folder", b"global-pnpmfile", b"globalconfig", b"hoist-pattern", b"http-proxy",
    b"https-proxy", b"include", b"install-strategy", b"key", b"link-folder", b"local-address",
    b"location", b"lockfile-dir", b"lockfile-version", b"loglevel", b"logs-dir", b"logs-max",
    b"maxsockets", b"merge-git-branch-lockfiles-branch-pattern", b"min-release-age", b"mode",
    b"mutex", b"network-timeout", b"node-gyp", b"node-linker", b"node-options",
    b"noproxy", b"npmrc-auth-file", b"only", b"otp", b"package-import-method", b"pnpmfile",
    b"pnpr-server", b"preferred-cache-folder", b"prefix", b"proxy", b"public-hoist-pattern",
    b"replace-registry-host", b"reporter", b"save-catalog-name", b"save-prefix", b"scope",
    b"script-shell", b"state-dir", b"store-dir", b"tag", b"test-pattern", b"umask", b"use-yarnrc",
    b"user-agent", b"userconfig", b"virtual-store-dir", b"workspace", b"workspace-concurrency",
    b"workspace-packages",
    ],
    // pnpm's `--config.<setting>=<value>`.
    prefixes: &[b"config."],
};

/// `bun update` accepts these flags too, but there they select which dependencies to update, so no
/// entry in `FOREIGN_FLAGS` is rewritten to them for `bun update`.
const UPDATE_FILTERS: &[&[u8]] = &[b"--dev", b"--production"];

pub(crate) static ADD_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!("-d, --dev                 Add dependency to \"devDependencies\""),
        clap::param!("-D, --development"),
        clap::param!(
            "--optional                        Add dependency to \"optionalDependencies\""
        ),
        clap::param!("--peer                        Add dependency to \"peerDependencies\""),
        clap::param!(
            "--save-prod                   Add dependency to \"dependencies\", also when another group lists it"
        ),
        clap::param!("-E, --exact                  Add the exact version instead of the ^range"),
        clap::param!(
            "-F, --filter <STR>...            Add the package(s) to the matching workspaces instead of the current package"
        ),
        clap::param!(
            "-a, --analyze                   Recursively analyze & install dependencies of files passed as arguments (using Bun's bundler)"
        ),
        clap::param!(
            "--only-missing                  Only add dependencies to package.json if they are not already present"
        ),
        clap::param!(
            "--catalog <STR>?                Add the resolved version to the root package.json catalog and depend on it as \"catalog:\" (use --catalog=NAME for a named catalog)"
        ),
        clap::param!(
            "<POS> ...                         \"name\" or \"name@version\" of package(s) to install"
        ),
    ],
];

pub(crate) static REMOVE_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!(
            "-F, --filter <STR>...            Remove the package(s) from the matching workspaces instead of the current package"
        ),
        clap::param!(
            "<POS> ...                         \"name\" of package(s) to remove from package.json"
        ),
    ],
];

pub(crate) static LINK_PARAMS: ParamTable = &[
    LINK_SHARED_PARAMS,
    &[clap::param!(
        "<POS> ...                         \"name\" install package as a link"
    )],
];

pub(crate) static UNLINK_PARAMS: ParamTable = &[
    LINK_SHARED_PARAMS,
    &[clap::param!(
        "<POS> ...                         \"name\" uninstall package as a link"
    )],
];

static PATCH_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!("<POS> ...                         \"name\" of the package to patch"),
        clap::param!(
            "--commit                         Install a package containing modifications in `dir`"
        ),
        clap::param!(
            "--patches-dir <dir>                    The directory to put the patch file in (only if --commit is used)"
        ),
    ],
];

static PATCH_COMMIT_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!("<POS> ...                         \"dir\" containing changes to a package"),
        clap::param!("--patches-dir <dir>                    The directory to put the patch file"),
    ],
];

static OUTDATED_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        // clap::param!("--json                                 Output outdated information in JSON format"),
        clap::param!(
            "-F, --filter <STR>...                  Display outdated dependencies for each matching workspace"
        ),
        clap::param!(
            "-r, --recursive                        Check outdated packages in all workspaces"
        ),
        clap::param!("<POS> ...                              Package patterns to filter by"),
    ],
];

static AUDIT_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!(
            "<POS> ...                              Check installed packages for vulnerabilities"
        ),
        clap::param!("--json                                 Output in JSON format"),
        clap::param!(
            "--audit-level <STR>                    Only print advisories with severity greater than or equal to \\<level\\> (low, moderate, high, critical)"
        ),
        clap::param!(
            "--ignore <STR>...                      Ignore advisories by GHSA or numeric advisory ID (repeatable)"
        ),
        clap::param!(
            "-L, --latest                           Also apply fixes your declared ranges exclude, rewriting package.json"
        ),
    ],
];

const AUDIT_HELP_PARAMS: &[ParamType] = &[
    clap::param!(
        "--audit-level <STR>                    Only print advisories with severity greater than or equal to \\<level\\> (low, moderate, high, critical)"
    ),
    clap::param!(
        "-p, --production                       Skip packages that are only needed by devDependencies (alias: --prod)"
    ),
    clap::param!(
        "--omit <dev|optional|peer>...          Skip packages that are only needed by the given dependency types: dev, optional, or peer (repeatable)"
    ),
    clap::param!(
        "--ignore <STR>...                      Ignore advisories by GHSA or numeric advisory ID (repeatable)"
    ),
    clap::param!("--json                                 Output in JSON format"),
    clap::param!(
        "--dry-run                              Show what bun audit fix would change without changing anything"
    ),
    clap::param!(
        "-L, --latest                           Also apply fixes your declared ranges exclude, rewriting package.json"
    ),
    clap::param!("--cwd <STR>                            Set a specific cwd"),
    clap::param!("-h, --help                             Print this help menu"),
];

static INFO_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!("<POS> ...                              Package name or path to package.json"),
        clap::param!("--json                                 Output in JSON format"),
    ],
];

static PACK_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        // clap::param!("--filter <STR>...                      Pack each matching workspace"),
        clap::param!(
            "--destination <STR>                    The directory the tarball will be saved in"
        ),
        clap::param!("--filename <STR>                       The filename of the tarball"),
        clap::param!(
            "--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9."
        ),
        clap::param!("<POS> ...                              "),
    ],
];

static PUBLISH_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!("<POS> ...                              Package tarball to publish"),
        clap::param!("--access <STR>                         Set access level for scoped packages"),
        clap::param!(
            "--tag <STR>                            Tag the release. Default is \"latest\""
        ),
        clap::param!(
            "--otp <STR>                            Provide a one-time password for authentication"
        ),
        clap::param!(
            "--auth-type <STR>                      Specify the type of one-time password authentication (default is 'web')"
        ),
        clap::param!(
            "--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9."
        ),
        clap::param!(
            "--tolerate-republish                   Don't exit with code 1 when republishing over an existing version number"
        ),
        clap::param!(
            "-F, --filter <STR>...                  Publish each matching workspace package"
        ),
        clap::param!(
            "-r, --recursive                        Publish every workspace package whose version is not on the registry"
        ),
        clap::param!("--provenance <STR>?"),
        clap::param!("--no-provenance"),
        clap::param!("--provenance-file <STR>"),
    ],
];

static WHY_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!(
            "<POS> ...                              Package name to explain why it's installed"
        ),
        clap::param!(
            "--top                                  Show only the top dependency tree instead of nested ones"
        ),
        clap::param!(
            "--depth <NUM>                          Maximum depth of the dependency tree to display"
        ),
    ],
];

static DEDUPE_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!(
            "--check                                Exit with code 1 if the lockfile has duplicate versions that can be removed, without changing anything"
        ),
        clap::param!("<POS> ...                              "),
    ],
];

const DEDUPE_HELP_PARAMS: &[ParamType] = &[
    clap::param!(
        "--check                                Exit with code 1 if the lockfile has duplicate versions that can be removed, without changing anything"
    ),
    clap::param!(
        "--dry-run                              Print the duplicate versions that would be removed without changing anything"
    ),
    clap::param!("--lockfile-only                        Rewrite bun.lock without installing"),
    clap::param!(
        "--frozen-lockfile                      Fail instead of rewriting bun.lock when duplicate versions can be removed"
    ),
    clap::param!(
        "--linker <STR>                         Install with the given linker (one of \"isolated\" or \"hoisted\")"
    ),
    clap::param!("--silent                               Don't log anything"),
    clap::param!("--cwd <STR>                            Set a specific cwd"),
    clap::param!("-h, --help                             Print this help menu"),
];

static PRUNE_PARAMS: ParamTable = &[
    SHARED_PARAMS,
    &[
        clap::param!(
            "--check                                Exit with code 1 if node_modules has packages that can be removed, without deleting anything"
        ),
        clap::param!(
            "-F, --filter <STR>...                  Only prune the node_modules folders of the matching workspaces"
        ),
        clap::param!("<POS> ...                              "),
    ],
];

const PRUNE_HELP_PARAMS: &[ParamType] = &[
    clap::param!(
        "-p, --production                       Also remove packages that are only needed by devDependencies (alias: --prod)"
    ),
    clap::param!(
        "--omit <dev|optional|peer>...          Also remove packages that are only needed by the given dependency types"
    ),
    clap::param!(
        "--check                                Exit with code 1 if node_modules has packages that can be removed, without deleting anything"
    ),
    clap::param!(
        "--dry-run                              Print what would be removed without deleting anything"
    ),
    clap::param!(
        "--os <STR>...                          Prune for a different operating system than the current one"
    ),
    clap::param!(
        "--cpu <STR>...                         Prune for a different CPU architecture than the current one"
    ),
    clap::param!(
        "--libc <STR>...                        Prune for a different libc than the current one"
    ),
    clap::param!(
        "--linker <STR>                         Linker to assume when node_modules mixes isolated and hoisted installs (one of \"isolated\" or \"hoisted\")"
    ),
    clap::param!(
        "-F, --filter <STR>...                  Only prune the node_modules folders of the matching workspaces"
    ),
    clap::param!("--silent                               Don't log anything"),
    clap::param!("--cwd <STR>                            Set a specific cwd"),
    clap::param!("-h, --help                             Print this help menu"),
];

// NOTE: `string` (= `[]const u8`) fields here are slices into process argv (owned by `clap::Args`
// which itself lives for the program duration). They are never freed. Mapped to `&'static [u8]`
// per PORTING.md (no `deinit`, never `allocator.free`d). An explicit lifetime would only
// become necessary if `clap::Args` ever becomes scoped.
#[derive(Default)]
pub struct CommandLineArguments {
    pub cache_dir: Option<&'static [u8]>,
    pub lockfile: &'static [u8],
    pub(crate) global: bool,
    pub(crate) config: Option<&'static [u8]>,
    pub(crate) network_concurrency: Option<u16>,
    pub(crate) backend: Option<package_install::Method>,
    pub analyze: bool,
    pub(crate) only_missing: bool,
    pub(crate) add_catalog: Option<&'static [u8]>,
    pub positionals: &'static [&'static [u8]],

    pub(crate) yarn: bool,
    pub production: bool,
    pub(crate) frozen_lockfile: bool,
    pub(crate) no_save: bool,
    pub dry_run: bool,
    pub(crate) check: bool,
    pub(crate) force: bool,
    pub(crate) no_cache: bool,
    pub log_level: Options::LogLevel,
    pub(crate) no_progress: bool,
    pub(crate) no_verify: bool,
    pub(crate) offline: bool,
    pub(crate) prefer_offline: bool,
    pub(crate) ignore_scripts: bool,
    pub(crate) trusted: bool,
    pub(crate) no_summary: bool,
    pub(crate) latest: bool,
    pub interactive: bool,
    pub json_output: bool,
    pub(crate) recursive: bool,
    pub(crate) filters: &'static [&'static [u8]],
    pub update_groups: UpdateGroups,

    pub(crate) pack_destination: &'static [u8],
    pub(crate) pack_filename: &'static [u8],
    pub(crate) pack_gzip_level: Option<&'static [u8]>,

    pub(crate) dependency_group: Options::DependencyGroup,
    /// True if `--dev`, `--optional`, `--peer` or `--save-prod` was passed. An entry that's in
    /// another group then moves.
    pub(crate) names_group: bool,

    pub(crate) omit: Option<Omit>,

    pub(crate) exact: bool,

    pub(crate) concurrent_scripts: Option<usize>,

    pub(crate) patch: PatchOpts,

    pub(crate) registry: &'static [u8],

    pub(crate) publish_config: Options::PublishConfig,

    pub(crate) tolerate_republish: bool,

    pub(crate) ca: &'static [&'static [u8]],
    pub(crate) ca_file_name: &'static [u8],

    pub(crate) save_text_lockfile: Option<bool>,

    pub(crate) lockfile_only: bool,

    pub(crate) node_linker: Option<Options::NodeLinker>,

    pub(crate) minimum_release_age_ms: Option<f64>,
    /// As typed. Each value is a comma-separated list.
    pub(crate) minimum_release_age_excludes: &'static [&'static [u8]],

    // `bun pm version` options
    pub(crate) no_git_tag_version: bool,
    pub(crate) allow_same_version: bool,
    pub(crate) preid: &'static [u8],
    pub(crate) message: Option<&'static [u8]>,

    // `bun pm why` options
    pub top_only: bool,
    /// Also `bun update --depth 0`.
    pub(crate) depth: Option<usize>,

    // `bun pm ls` and `bun pm trust` options
    pub all: bool,
    pub trusted_only: bool,

    // `bun pm licenses` options
    pub dev_only: bool,
    pub long: bool,

    // `bun pm diff` options
    pub diff_args: Vec<&'static [u8]>,
    pub diff_name_only: bool,
    pub diff_raw: bool,
    /// The subcommand only needs registry configuration; a missing package.json is not an error.
    pub no_project_ok: bool,
    pub diff_unminify: bool,
    pub diff_minify: bool,
    pub diff_ignore_space: bool,
    pub diff_stat: bool,
    pub diff_context: Option<usize>,

    // `bun pm cache prune` options
    pub cache_max_age_days: Option<u32>,

    // `bun audit` options
    pub audit_level: Option<AuditLevel>,
    pub audit_ignore_list: &'static [&'static [u8]],

    // CPU, OS and libc overrides for optional dependencies
    pub(crate) cpu: Option<Npm::Architecture>,
    pub(crate) os: Option<Npm::OperatingSystem>,
    pub(crate) libc: Option<Npm::Libc>,

    pub(crate) env_files: &'static [&'static [u8]],
    pub(crate) no_env_file: bool,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, PartialOrd, Ord)]
pub enum AuditLevel {
    Low,
    Moderate,
    High,
    Critical,
}

bun_core::comptime_string_map! {
    static AUDIT_LEVEL_MAP: AuditLevel = {
        b"low" => AuditLevel::Low,
        b"moderate" => AuditLevel::Moderate,
        b"high" => AuditLevel::High,
        b"critical" => AuditLevel::Critical,
    };
}

impl AuditLevel {
    pub fn from_string(str: &[u8]) -> Option<AuditLevel> {
        AUDIT_LEVEL_MAP.get(str).copied()
    }

    pub fn name(self) -> &'static str {
        match self {
            AuditLevel::Low => "low",
            AuditLevel::Moderate => "moderate",
            AuditLevel::High => "high",
            AuditLevel::Critical => "critical",
        }
    }
}

#[derive(Copy, Clone, Default)]
pub enum PatchOpts {
    #[default]
    Nothing,
    Patch,
    Commit {
        patches_dir: &'static [u8],
    },
}

#[derive(Default, Copy, Clone)]
pub struct Omit {
    pub(crate) dev: bool,
    pub(crate) optional: bool,
    pub(crate) peer: bool,
}

#[derive(Default, Copy, Clone, PartialEq, Eq)]
pub struct UpdateGroups {
    pub dev: bool,
    pub prod: bool,
    pub no_optional: bool,
}

impl UpdateGroups {
    pub fn is_default(self) -> bool {
        self == UpdateGroups::default()
    }
}

impl CommandLineArguments {
    pub fn print_help(subcommand: Subcommand) {
        // the output of --help uses the following syntax highlighting
        // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
        // use [foo] for multiple arguments or flags for foo.
        // use <bar> to emphasize 'bar'

        let (intro_text, params, outro_text): (&str, ParamTable, &str) = match subcommand {
            Subcommand::Install => (
                r"
<b>Usage<r>: <b><green>bun install<r> <cyan>[flags]<r> <blue>\<name\><r><d>@\<version\><r>
<b>Alias<r>: <b><green>bun i<r>

  Install the dependencies listed in package.json.

<b>Flags:<r>",
                INSTALL_PARAMS,
                r"

<b>Examples:<r>
  <d>Install the dependencies for the current project<r>
  <b><green>bun install<r>

  <d>Skip devDependencies<r>
  <b><green>bun install<r> <cyan>--production<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/install<r>.
",
            ),
            Subcommand::Update => (
                r"
<b>Usage<r>: <b><green>bun update<r> <cyan>[flags]<r> <blue>\<name\><r><d>@\<version\><r>
<b>Alias<r>: <b><green>bun up<r>

  Update dependencies to their most recent versions within the version range in package.json.

<b>Flags:<r>",
                UPDATE_PARAMS,
                r"

<b>Examples:<r>
  <d>Update all dependencies:<r>
  <b><green>bun update<r>

  <d>Update all dependencies to latest:<r>
  <b><green>bun update<r> <cyan>--latest<r>

  <d>Interactive update (select packages to update):<r>
  <b><green>bun update<r> <cyan>-i<r>

  <d>Update specific packages:<r>
  <b><green>bun update<r> <blue>zod jquery@3<r>

  <d>Update every @types package, or everything except webpack:<r>
  <b><green>bun update<r> <blue>'@types/*'<r>
  <b><green>bun update<r> <blue>'!webpack'<r>

  <d>Only update devDependencies:<r>
  <b><green>bun update<r> <cyan>--dev<r>

  <d>Only update dependencies and optionalDependencies:<r>
  <b><green>bun update<r> <cyan>--prod<r>

  <d>Only update direct dependencies, keep transitive dependencies locked:<r>
  <b><green>bun update<r> <cyan>--depth 0<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/update<r>.
",
            ),
            Subcommand::Patch => (
                r"
<b>Usage<r>: <b><green>bun patch<r> <cyan>[flags or options]<r> <blue>\<package\><r><d>@\<version\><r>

  Prepare a package for patching, or generate and save a patch.

<b>Flags:<r>",
                PATCH_PARAMS,
                r"

<b>Examples:<r>
  <d>Prepare jquery for patching<r>
  <b><green>bun patch jquery<r>

  <d>Generate a patch file for changes made to jquery<r>
  <b><green>bun patch --commit 'node_modules/jquery'<r>

  <d>Generate a patch file in a custom directory for changes made to jquery<r>
  <b><green>bun patch --patches-dir 'my-patches' 'node_modules/jquery'<r>

Full documentation is available at <magenta>https://bun.com/docs/install/patch<r>.
",
            ),
            Subcommand::PatchCommit => (
                r"
<b>Usage<r>: <b><green>bun patch-commit<r> <cyan>[flags or options]<r> <blue>\<directory\><r>

  Generate a patch out of a directory and save it. This is equivalent to <b><green>bun patch --commit<r>.

<b>Flags:<r>",
                PATCH_COMMIT_PARAMS,
                r#"

<b>Examples:<r>
  <d>Generate a patch in the default "./patches" directory for changes in "./node_modules/jquery"<r>
  <b><green>bun patch-commit 'node_modules/jquery'<r>

  <d>Generate a patch in a custom directory ("./my-patches")<r>
  <b><green>bun patch-commit --patches-dir 'my-patches' 'node_modules/jquery'<r>

Full documentation is available at <magenta>https://bun.com/docs/install/patch<r>.
"#,
            ),
            Subcommand::Pm => return PackageManagerCommand::print_help(),
            Subcommand::Add => (
                r"
<b>Usage<r>: <b><green>bun add<r> <cyan>[flags]<r> <blue>\<package\><r><d>\<@version\><r>
<b>Alias<r>: <b><green>bun a<r>

  Add a new dependency to package.json and install it.

<b>Flags:<r>",
                ADD_PARAMS,
                r"

<b>Examples:<r>
  <d>Add a dependency from the npm registry<r>
  <b><green>bun add<r> <blue>zod<r>
  <b><green>bun add<r> <blue>zod@next<r>
  <b><green>bun add<r> <blue>zod@3.0.0<r>

  <d>Add a dev, optional, or peer dependency <r>
  <b><green>bun add<r> <cyan>-d<r> <blue>typescript<r>
  <b><green>bun add<r> <cyan>--optional<r> <blue>lodash<r>
  <b><green>bun add<r> <cyan>--peer<r> <blue>esbuild<r>

  <d>Add a dependency to a specific workspace in a monorepo<r>
  <b><green>bun add<r> <blue>zod<r> <cyan>--filter<r> <blue>api<r>

  <d>Add to the workspace catalog instead of pinning a version<r>
  <b><green>bun add<r> <cyan>--catalog<r> <blue>react<r>
  <b><green>bun add<r> <cyan>--catalog=testing<r> <blue>vitest<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/add<r>.
",
            ),
            Subcommand::Remove => (
                r"
<b>Usage<r>: <b><green>bun remove<r> <cyan>[flags]<r> <blue>[\<packages\>]<r>
<b>Alias<r>: <b><green>bun r<r>

  Remove a package from package.json and uninstall from node_modules.

<b>Flags:<r>",
                REMOVE_PARAMS,
                r"

<b>Examples:<r>
  <d>Remove a dependency<r>
  <b><green>bun remove<r> <blue>ts-node<r>

  <d>Remove a dependency from a specific workspace in a monorepo<r>
  <b><green>bun remove<r> <blue>zod<r> <cyan>--filter<r> <blue>api<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/remove<r>.
",
            ),
            Subcommand::Link => (
                r#"
<b>Usage<r>: <b><green>bun link<r> <cyan>[flags]<r> <blue>[\<packages\>]<r>

  Register a local directory as a "linkable" package, or link a "linkable" package to the current project.

<b>Flags:<r>"#,
                LINK_PARAMS,
                r"

<b>Examples:<r>
  <d>Register the current directory as a linkable package.<r>
  <d>Directory should contain a package.json.<r>
  <b><green>bun link<r>

  <d>Link a previously-registered linkable package into the current project's node_modules.<r>
  <b><green>bun link<r> <blue>\<package\><r>

  <d>Also add it to the current project's package.json as a link: dependency.<r>
  <b><green>bun link<r> <cyan>--save<r> <blue>\<package\><r>

Full documentation is available at <magenta>https://bun.com/docs/cli/link<r>.
",
            ),
            Subcommand::Unlink => (
                r#"
<b>Usage<r>: <b><green>bun unlink<r> <cyan>[flags]<r>

  Unregister the current directory as a "linkable" package.

<b>Flags:<r>"#,
                UNLINK_PARAMS,
                r"

<b>Examples:<r>
  <d>Unregister the current directory as a linkable package.<r>
  <b><green>bun unlink<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/unlink<r>.
",
            ),
            Subcommand::Outdated => (
                r"
<b>Usage<r>: <b><green>bun outdated<r> <cyan>[flags]<r> <blue>[filter]<r>

  Display outdated dependencies for each matching workspace.

<b>Flags:<r>",
                OUTDATED_PARAMS,
                r#"

<b>Examples:<r>
  <d>Display outdated dependencies in the current workspace.<r>
  <b><green>bun outdated<r>

  <d>Use --filter to include more than one workspace.<r>
  <b><green>bun outdated<r> <cyan>--filter="*"<r>
  <b><green>bun outdated<r> <cyan>--filter="./app/*"<r>
  <b><green>bun outdated<r> <cyan>--filter="!frontend"<r>

  <d>Filter dependencies with name patterns.<r>
  <b><green>bun outdated<r> <blue>jquery<r>
  <b><green>bun outdated<r> <blue>"is-*"<r>
  <b><green>bun outdated<r> <blue>"!is-even"<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/outdated<r>.
"#,
            ),
            Subcommand::Pack => (
                r"
<b>Usage<r>: <b><green>bun pm pack<r> <cyan>[flags]<r>

  Create a tarball for the current project.

<b>Flags:<r>",
                PACK_PARAMS,
                r"

<b>Examples:<r>
  <b><green>bun pm pack<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/pm#pack<r>.
",
            ),
            Subcommand::Publish => (
                r"
<b>Usage<r>: <b><green>bun publish<r> <cyan>[flags]<r> <blue>[dist]<r>

  Publish a package to the npm registry.

<b>Flags:<r>",
                PUBLISH_PARAMS,
                r"

<b>Examples:<r>
  <d>Display files that would be published, without publishing to the registry.<r>
  <b><green>bun publish<r> <cyan>--dry-run<r>

  <d>Publish the current package with public access.<r>
  <b><green>bun publish<r> <cyan>--access public<r>

  <d>Publish a pre-existing package tarball with tag 'next'.<r>
  <b><green>bun publish<r> <cyan>--tag next<r> <blue>./path/to/tarball.tgz<r>

  <d>Publish without failing when republishing over an existing version.<r>
  <b><green>bun publish<r> <cyan>--tolerate-republish<r>

  <d>Publish every workspace package that is not on the registry yet, dependencies first.<r>
  <b><green>bun publish<r> <cyan>--recursive<r>

  <d>Publish only the matching workspace packages.<r>
  <b><green>bun publish<r> <cyan>--filter '@scope/*'<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/publish<r>.
",
            ),
            Subcommand::Audit => (
                r"
<b>Usage<r>: <b><green>bun audit<r> <cyan>[flags]<r>

  Check installed packages for vulnerabilities.
  <b><green>bun audit fix<r> upgrades vulnerable packages to the lowest safe version that still satisfies every dependent's range.

<b>Flags:<r>",
                &[AUDIT_HELP_PARAMS],
                r"

<b>Examples:<r>
  <d>Check the current project's packages for vulnerabilities.<r>
  <b><green>bun audit<r>

  <d>Output package vulnerabilities in JSON format.<r>
  <b><green>bun audit --json<r>

  <d>Upgrade vulnerable packages in bun.lock and node_modules; package.json is only changed when an exact pin has to be bumped.<r>
  <b><green>bun audit fix<r>

  <d>Show what bun audit fix would change without changing anything.<r>
  <b><green>bun audit fix --dry-run<r>

  <d>Also apply fixes that your package.json ranges exclude, rewriting those ranges.<r>
  <b><green>bun audit fix --latest<r>

Full documentation is available at <magenta>https://bun.com/docs/install/audit<r>.
",
            ),
            Subcommand::Info => (
                r"
<b>Usage<r>: <b><green>bun info<r> <cyan>[flags]<r> <blue>\<package\><r><d>[@\<version\>]<r> <d>[\<property\>...]<r>

  View package metadata from the registry.

<b>Flags:<r>",
                INFO_PARAMS,
                r"

<b>Examples:<r>
  <d>Display metadata for the 'react' package<r>
  <b><green>bun info<r> <blue>react<r>

  <d>Display a specific version of a package<r>
  <b><green>bun info<r> <blue>react@18.0.0<r>

  <d>Display properties (npm view path syntax)<r>
  <b><green>bun info<r> <blue>react<r> version license
  <b><green>bun info<r> <blue>react<r> maintainers.name dist-tags.latest

  <d>Display a specific property in JSON format<r>
  <b><green>bun info<r> <blue>react<r> version <cyan>--json<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/info<r>.
",
            ),
            Subcommand::Why => (
                r"
<b>Usage<r>: <b><green>bun why<r> <cyan>[flags]<r> <blue>\<package\><r>

  Explain why a package is installed.

<b>Flags:<r>",
                WHY_PARAMS,
                r#"

<b>Examples:<r>
  <d>$<r> <b><green>bun why<r> <blue>react<r>
  <d>$<r> <b><green>bun why<r> <blue>"@types/*"<r> <cyan>--depth<r> <blue>2<r>
  <d>$<r> <b><green>bun why<r> <blue>"*-lodash"<r> <cyan>--top<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/why<r>.
"#,
            ),
            Subcommand::Dedupe => (
                r"
<b>Usage<r>: <b><green>bun dedupe<r> <cyan>[flags]<r>

  Remove duplicate versions from bun.lock by re-resolving dependency ranges onto versions that are already in the lockfile, then install.

<b>Flags:<r>",
                &[DEDUPE_HELP_PARAMS],
                r"

<b>Examples:<r>
  <d>Remove duplicate versions and install<r>
  <b><green>bun dedupe<r>

  <d>Only report removable duplicates; exit code 1 if there are any (for CI)<r>
  <b><green>bun dedupe<r> <cyan>--check<r>

  <d>Show what would be removed without changing anything<r>
  <b><green>bun dedupe<r> <cyan>--dry-run<r>

  <d>Rewrite bun.lock without installing<r>
  <b><green>bun dedupe<r> <cyan>--lockfile-only<r>

Full documentation is available at <magenta>https://bun.com/docs/pm/cli/dedupe<r>.
",
            ),
            Subcommand::Prune => (
                r"
<b>Usage<r>: <b><green>bun prune<r> <cyan>[flags]<r>

  Remove packages from node_modules that are not in bun.lock. With <cyan>--production<r>, also remove packages that are only needed by devDependencies.

<b>Flags:<r>",
                &[PRUNE_HELP_PARAMS],
                r"

<b>Examples:<r>
  <d>Remove packages that are not in bun.lock from node_modules<r>
  <b><green>bun prune<r>

  <d>Also remove devDependencies, e.g. after the build step in a Dockerfile<r>
  <b><green>bun prune<r> <cyan>--production<r>

  <d>Show what would be removed without deleting anything<r>
  <b><green>bun prune<r> <cyan>--dry-run<r>

  <d>Only report what would be removed; exit code 1 if there is anything (for CI)<r>
  <b><green>bun prune<r> <cyan>--check<r>

  <d>Only prune what the app workspace no longer needs<r>
  <b><green>bun prune<r> <cyan>--production --filter app<r>

Full documentation is available at <magenta>https://bun.com/docs/pm/cli/prune<r>.
",
            ),
        };
        pretty_help(intro_text);
        clap::simple_help(&params.concat());
        pretty_help(outro_text);
        Output::flush();
    }

    pub fn parse(subcommand: Subcommand) -> Result<CommandLineArguments, crate::Error> {
        Output::set_is_verbose(Output::is_verbose());
        crate::bin::Linker::ensure_umask();

        let table: ParamTable = match subcommand {
            Subcommand::Install => INSTALL_PARAMS,
            Subcommand::Update => UPDATE_PARAMS,
            Subcommand::Pm => PM_PARAMS,
            Subcommand::Add => ADD_PARAMS,
            Subcommand::Remove => REMOVE_PARAMS,
            Subcommand::Link => LINK_PARAMS,
            Subcommand::Unlink => UNLINK_PARAMS,
            Subcommand::Patch => PATCH_PARAMS,
            Subcommand::PatchCommit => PATCH_COMMIT_PARAMS,
            Subcommand::Outdated => OUTDATED_PARAMS,
            Subcommand::Pack => PACK_PARAMS,
            Subcommand::Publish => PUBLISH_PARAMS,
            Subcommand::Why => WHY_PARAMS,
            Subcommand::Dedupe => DEDUPE_PARAMS,
            Subcommand::Prune => PRUNE_PARAMS,
            Subcommand::Audit => AUDIT_PARAMS,
            Subcommand::Info => INFO_PARAMS,
        };
        // `clap::parse` caches what it builds from a table, keyed by the table's address.
        let params: &'static [ParamType] = table.concat().leak();
        debug_assert!(
            (RUNTIME_FLAGS_PARAM.names.long_aliases.iter())
                .all(|alias| params.iter().all(|param| param.names.long != Some(*alias))),
            "RUNTIME_FLAGS_PARAM shadows a flag of this command",
        );

        let has = |name: &[u8]| params.iter().any(|param| param.names.matches_long(name));
        let foreign_flags: &[(&[u8], ForeignFlag)] = match subcommand {
            Subcommand::Install | Subcommand::Add | Subcommand::Remove | Subcommand::Update => {
                FOREIGN_FLAGS
            }
            _ => &[],
        };
        // A foreign flag is skipped if the command has its own flag of that name, and an alias only
        // applies if the command accepts the Bun flag it maps to.
        let rewrites: Vec<(&'static [u8], &'static [u8])> = (foreign_flags.iter())
            .filter(|(flag, _)| !has(&flag[2..]))
            .filter_map(|&(flag, kind)| match kind {
                AliasOf(own) => {
                    let name_end = strings::index_of_char_usize(own, b'=').unwrap_or(own.len());
                    let is_filter =
                        subcommand == Subcommand::Update && UPDATE_FILTERS.contains(&own);
                    if has(&own[2..name_end]) && !is_filter {
                        Some((flag, own))
                    } else {
                        // `--save-*` only picks the group a new dependency is saved to, so a
                        // command that adds no dependency ignores it.
                        flag.starts_with(b"--save-")
                            .then_some((flag, b"".as_slice()))
                    }
                }
                Satisfied => Some((flag, b"".as_slice())),
            })
            .collect();

        let mut diag = clap::Diagnostic::default();

        // `args` must stay alive for the program duration —
        // `cli` stores slices into it. Park the parsed `Args` in a process-global
        // `OnceLock` so outer slice borrows (`positionals()`, `options()`) are
        // `'static`; inner `&[u8]` are argv-backed and already `'static`. CLI args
        // are parsed twice by `update`, `link` and `unlink`: the first `Args` stays.
        static PARSED_ARGS: OnceLock<clap::Args<clap::Help>> = OnceLock::new();
        static REWRITES: OnceLock<Vec<(&'static [u8], &'static [u8])>> = OnceLock::new();
        let first_parse;
        let args: &'static clap::Args<clap::Help> = match clap::parse::<clap::Help>(
            params,
            clap::ParseOptions {
                diagnostic: Some(&mut diag),
                stop_after_positional_at: 0,
                short_aliases: REWRITES.get_or_init(|| rewrites),
                unknown_long_flags_are_errors: true,
                ignored_long_flags: if foreign_flags.is_empty() {
                    Default::default()
                } else {
                    IGNORED_FOREIGN_FLAGS
                },
                ..Default::default()
            },
        ) {
            Ok(a) => {
                first_parse = PARSED_ARGS.set(a).is_ok();
                PARSED_ARGS.get().unwrap()
            }
            Err(err) => {
                if let (clap::Error::InvalidArgument, Some(flag)) = (err, diag.long()) {
                    let command: &'static str = subcommand.into();
                    Output::err_generic(
                        "bun {} has no <b>--{}<r> flag.",
                        (command, bstr::BStr::new(flag)),
                    );
                    bun_core::note!("Run 'bun {} --help' for more information", command);
                    Global::exit(1);
                }
                Self::print_help(subcommand);
                let _ = diag.report(Output::error_writer(), err);
                Global::exit(1);
            }
        };

        if args.flag(b"--help") {
            Self::print_help(subcommand);
            Global::exit(0);
        }

        let mut cli = CommandLineArguments::default();
        cli.positionals = args.positionals();
        cli.yarn = args.flag(b"--yarn");
        cli.production = args.flag(b"--production") || args.flag(b"--prod");
        cli.frozen_lockfile = args.flag(b"--frozen-lockfile")
            || (!cli.positionals.is_empty() && cli.positionals[0] == b"ci");
        cli.no_progress = args.flag(b"--no-progress");
        cli.dry_run = args.flag(b"--dry-run");
        cli.global = args.flag(b"--global");
        cli.force = args.flag(b"--force");
        cli.no_verify = args.flag(b"--no-verify");
        cli.offline = args.flag(b"--offline");
        cli.prefer_offline = args.flag(b"--prefer-offline");
        cli.no_cache = args.flag(b"--no-cache");
        // --silent checked first so `is_silent()` matches `--silent` exactly:
        // callers read it to suppress summaries/errors independently of verbose.
        cli.log_level = if args.flag(b"--silent") {
            Options::LogLevel::Silent
        } else if args.flag(b"--verbose") || Output::is_verbose() {
            Options::LogLevel::Verbose
        } else if args.flag(b"--quiet") {
            Options::LogLevel::Quiet
        } else {
            Options::LogLevel::Default
        };
        cli.ignore_scripts = args.flag(b"--ignore-scripts");
        cli.trusted = args.flag(b"--trust");
        cli.no_summary = args.flag(b"--no-summary");
        cli.ca = args.options(b"--ca");
        cli.lockfile_only = args.flag(b"--lockfile-only");
        cli.env_files = args.options(b"--env-file");
        cli.no_env_file = args.flag(b"--no-env-file");

        if let Some(linker) = args.option(b"--linker") {
            cli.node_linker = Some(match Options::NodeLinker::from_str(linker) {
                Some(l) => l,
                None => {
                    Output::err_generic(
                        "Invalid value for --linker: {}. Must be 'isolated' or 'hoisted'.",
                        (bun_core::fmt::quote(linker),),
                    );
                    Global::exit(1);
                }
            });
        }

        cli.cache_dir = args.option(b"--cache-dir");
        cli.ca_file_name = args.option(b"--cafile").unwrap_or_default();
        Global::set_ca_store_from_flags(|flag| args.flag(flag));

        if let Some(network_concurrency) = args.option(b"--network-concurrency") {
            cli.network_concurrency =
                Some(match strings::parse_int::<u16>(network_concurrency, 10) {
                    Ok(n) => n,
                    Err(_) => {
                        Output::err_generic(
                            "Expected --network-concurrency to be a number between 0 and 65535: {}",
                            (bstr::BStr::new(network_concurrency),),
                        );
                        Global::crash();
                    }
                });
        }

        cli.save_text_lockfile = args.flag(b"--save-text-lockfile").then_some(true);

        if let Some(min_age_secs) = args.option(b"--minimum-release-age") {
            let Some(secs) = bun_core::fmt::parse_seconds(min_age_secs) else {
                Output::err_generic(
                    "Expected --minimum-release-age to be a positive number: {}",
                    (bstr::BStr::new(min_age_secs),),
                );
                Global::crash();
            };
            const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;
            cli.minimum_release_age_ms = Some(secs * MS_PER_S);
        }
        cli.minimum_release_age_excludes = args.options(b"--minimum-release-age-excludes");

        let omit_values = args.options(b"--omit");

        if !omit_values.is_empty() {
            let mut omit = Omit::default();
            for omit_value in omit_values {
                if *omit_value == *b"dev" {
                    omit.dev = true;
                } else if *omit_value == *b"optional" {
                    omit.optional = true;
                } else if *omit_value == *b"peer" {
                    omit.peer = true;
                } else {
                    Output::err_generic(
                        "invalid `omit` value: '{}'",
                        (bstr::BStr::new(omit_value),),
                    );
                    Global::crash();
                }
            }
            cli.omit = Some(omit);
        }

        // commands that support --filter
        if subcommand.supports_workspace_filtering() {
            cli.filters = args.options(b"--filter");
        }

        if subcommand.supports_json_output() {
            cli.json_output = args.flag(b"--json");
        }

        if subcommand == Subcommand::Outdated {
            // fake --dry-run, we don't actually resolve+clean the lockfile
            cli.dry_run = true;
            cli.recursive = args.flag(b"--recursive");
            // cli.json_output = args.flag(b"--json");
        }

        if matches!(subcommand, Subcommand::Dedupe | Subcommand::Prune) && args.flag(b"--check") {
            cli.check = true;
            cli.dry_run = true;
        }

        if matches!(
            subcommand,
            Subcommand::Pack | Subcommand::Pm | Subcommand::Publish
        ) {
            if subcommand != Subcommand::Publish {
                cli.pack_destination = args.option(b"--destination").unwrap_or_default();
                cli.pack_filename = args.option(b"--filename").unwrap_or_default();
            }

            cli.pack_gzip_level = args.option(b"--gzip-level");
        }

        if subcommand == Subcommand::Publish {
            cli.publish_config.tag = args.option(b"--tag").unwrap_or_default();

            if let Some(access) = args.option(b"--access") {
                cli.publish_config.access = Some(match Options::Access::from_str(access) {
                    Some(a) => a,
                    None => {
                        Output::err_generic(
                            "invalid `access` value: '{}'",
                            (bstr::BStr::new(access),),
                        );
                        Global::crash();
                    }
                });
            }

            if let Some(otp) = args.option(b"--otp") {
                if bun_http::async_http::breaks_header_line(otp) {
                    Output::err_generic(
                        "invalid `otp` value: must not contain a newline or NUL byte",
                        (),
                    );
                    Global::exit(1);
                }
                cli.publish_config.otp = otp;
            }

            if let Some(auth_type) = args.option(b"--auth-type") {
                cli.publish_config.auth_type = Some(match Options::AuthType::from_str(auth_type) {
                    Some(a) => a,
                    None => {
                        Output::err_generic(
                            "invalid `auth-type` value: '{}'",
                            (bstr::BStr::new(auth_type),),
                        );
                        Global::crash();
                    }
                });
            }

            cli.publish_config.provenance_flag = match args.option(b"--provenance") {
                _ if args.option(b"--provenance-file").is_some() => Some(true),
                Some(value) => Some(bun_ini::npm_config_bool(value)),
                None => args.flag(b"--no-provenance").then_some(false),
            };

            cli.tolerate_republish = args.flag(b"--tolerate-republish");
            cli.recursive = args.flag(b"--recursive");
        }

        // link and unlink default to not saving, all others default to
        // saving.
        if matches!(subcommand, Subcommand::Link | Subcommand::Unlink) {
            cli.no_save = !args.flag(b"--save");
        } else {
            cli.no_save = args.flag(b"--no-save");
        }

        if subcommand == Subcommand::PatchCommit
            || (subcommand == Subcommand::Patch && args.flag(b"--commit"))
        {
            cli.patch = PatchOpts::Commit {
                patches_dir: args.option(b"--patches-dir").unwrap_or(b"patches"),
            };
        } else if subcommand == Subcommand::Patch {
            cli.patch = PatchOpts::Patch;
        }

        if subcommand == Subcommand::Audit {
            if let Some(level) = args.option(b"--audit-level") {
                cli.audit_level = Some(match AuditLevel::from_string(level) {
                    Some(l) => l,
                    None => {
                        Output::err_generic(
                            "invalid `--audit-level` value: '{}'. valid values: low, moderate, high, critical",
                            (bstr::BStr::new(level),),
                        );
                        Global::crash();
                    }
                });
            }

            cli.audit_ignore_list = args.options(b"--ignore");
            cli.latest = args.flag(b"--latest");
            if cli.latest && !(cli.positionals.len() > 1 && cli.positionals[1] == b"fix") {
                Output::err_generic("--latest only applies to bun audit fix", ());
                Global::crash();
            }
        }

        cli.config = args.option(b"--config");

        cli.cpu = parse_platform_flag(
            args.options(b"--cpu"),
            "CPU architecture",
            "arm, arm64, ia32, mips, mipsel, ppc, ppc64, s390, s390x, x32, x64",
        );
        cli.os = parse_platform_flag(
            args.options(b"--os"),
            "operating system",
            "aix, darwin, freebsd, linux, openbsd, sunos, win32, android",
        );
        cli.libc = parse_platform_flag(args.options(b"--libc"), "libc", "glibc, musl");

        if matches!(subcommand, Subcommand::Add | Subcommand::Install) {
            cli.dependency_group = if args.flag(b"--development") || args.flag(b"--dev") {
                Options::DependencyGroup::DEV
            } else if args.flag(b"--optional") {
                Options::DependencyGroup::OPTIONAL
            } else if args.flag(b"--peer") {
                Options::DependencyGroup::PEER
            } else {
                Options::DependencyGroup::DEPENDENCIES
            };
            cli.names_group = args.flag(b"--save-prod")
                || cli.dependency_group.prop != Options::DependencyGroup::DEPENDENCIES.prop;
            cli.exact = args.flag(b"--exact");
            cli.analyze = args.flag(b"--analyze");
            cli.only_missing = args.flag(b"--only-missing");
            cli.add_catalog = args
                .option(b"--catalog")
                .map(|name| strings::trim(name, &strings::WHITESPACE_CHARS));
        }

        if let Some(concurrency) = args.option(b"--concurrent-scripts") {
            // 0 means the default, like in bunfig.toml. With a real limit of 0, no script would
            // ever start.
            cli.concurrent_scripts = strings::parse_int::<usize>(concurrency, 10)
                .ok()
                .filter(|&n| n != 0);
        }

        // A second `chdir` would resolve a relative path from inside the first one's target.
        if let Some(cwd_) = args.option(b"--cwd").filter(|_| first_parse) {
            let mut buf = bun_paths::path_buffer_pool::get();
            let mut buf2 = bun_paths::path_buffer_pool::get();

            let final_path: Option<&bun_core::ZStr> = if !cwd_.is_empty() && cwd_[0] == b'.' {
                let cwd_len = bun_sys::getcwd(&mut buf[..])?;
                let cwd = &buf[..cwd_len];
                let parts: [&[u8]; 1] = [cwd_];
                Path::resolve_path::join_abs_string_buf_z_checked::<Path::platform::Auto>(
                    cwd,
                    &mut buf2[..],
                    &parts,
                )
            } else if cwd_.len() < buf.len() {
                buf[..cwd_.len()].copy_from_slice(cwd_);
                buf[cwd_.len()] = 0;
                Some(bun_core::ZStr::from_buf(&buf[..], cwd_.len()))
            } else {
                None
            };
            let too_long = bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::chdir);
            if let Err(err) = final_path.map_or(Err(too_long), bun_sys::chdir) {
                Output::err_generic(
                    "failed to change directory to \"{}\": {}\n",
                    (
                        bstr::BStr::new(final_path.map_or(cwd_, |p| p.as_bytes())),
                        bstr::BStr::new(err.name()),
                    ),
                );
                Global::crash();
            }
        }

        // `FileSystem::init` only takes effect once, so `initial_top_level_dir()` stays the
        // directory the command was run in, even after `PackageManager::init` changes directory.
        let mut cwd_buf = bun_paths::path_buffer_pool::get();
        let cwd = bun_core::getcwd(&mut cwd_buf)?.as_bytes();
        let start_dir = bun_paths::fs::FileSystem::init(cwd).initial_top_level_dir();
        // Every `parse` call reads the same `PARSED_ARGS`, so these paths are resolved only once.
        static TYPED_PATHS: OnceLock<[Box<[u8]>; 3]> = OnceLock::new();
        let [config, cache_dir, ca_file_name] = TYPED_PATHS.get_or_init(|| {
            [cli.config, cli.cache_dir, Some(cli.ca_file_name)]
                .map(|path| BunInstall::resolve_path(start_dir, path.unwrap_or_default()))
        });
        cli.config = cli.config.map(|_| &**config);
        cli.cache_dir = cli.cache_dir.map(|_| &**cache_dir);
        cli.ca_file_name = &**ca_file_name;

        if subcommand == Subcommand::Update {
            cli.latest = args.flag(b"--latest");
            cli.interactive = args.flag(b"--interactive");
            cli.recursive = args.flag(b"--recursive");
            cli.exact = args.flag(b"--exact");
            cli.update_groups = UpdateGroups {
                dev: args.flag(b"--dev") || args.flag(b"--development"),
                prod: cli.production,
                no_optional: args.flag(b"--no-optional"),
            };
            cli.production = false;
            if let Some(depth) = args.option(b"--depth") {
                if depth != b"0" {
                    Output::err_generic(
                        "bun update --depth only accepts 0 (update direct dependencies, keep transitive dependencies locked), got '{}'",
                        (bstr::BStr::new(depth),),
                    );
                    Global::exit(1);
                }
                cli.depth = Some(0);
            }
        }

        cli.backend = args
            .option(b"--backend")
            .and_then(|backend| package_install::METHOD_MAP.get(backend).copied())
            .filter(|backend| backend.is_supported());

        if let Some(registry) = args.option(b"--registry") {
            if !strings::has_prefix(registry, b"https://")
                && !strings::has_prefix(registry, b"http://")
            {
                Output::err_generic(
                    "Registry URL must start with 'https://' or 'http://': {}\n",
                    (bun_core::fmt::quote(
                        bun_core::fmt::redacted_npm_url(registry)
                            .to_string()
                            .as_bytes(),
                    ),),
                );
                Global::crash();
            }
            cli.registry = registry;
        }

        if subcommand == Subcommand::Patch && cli.positionals.len() < 2 {
            if let PatchOpts::Commit { .. } = cli.patch {
                Output::err_generic(
                    "Missing path to the package directory containing your changes.\n  <d>Usage:<r> bun patch --commit <cyan>node_modules/\\<package\\><r>",
                    (),
                );
            } else {
                Output::err_generic(
                    "Missing package name to patch.\n  <d>Usage:<r> bun patch <cyan>\\<package\\><r><d>[@\\<version\\>]<r>",
                    (),
                );
            }
            bun_core::note!("Run 'bun patch --help' for more information");
            Global::crash();
        }

        if subcommand == Subcommand::PatchCommit && cli.positionals.len() < 2 {
            Output::err_generic(
                "Missing path to the package directory containing your changes.\n  <d>Usage:<r> bun patch-commit <cyan>node_modules/\\<package\\><r>",
                (),
            );
            bun_core::note!("Run 'bun patch-commit --help' for more information");
            Global::crash();
        }

        if cli.production && cli.trusted {
            Output::err_generic(
                "The '--production' and '--trust' flags together are not supported because the --trust flag potentially modifies the lockfile after installing packages\n",
                (),
            );
            Global::crash();
        }

        if cli.frozen_lockfile && cli.trusted {
            Output::err_generic(
                "The '--frozen-lockfile' and '--trust' flags together are not supported because the --trust flag potentially modifies the lockfile after installing packages\n",
                (),
            );
            Global::crash();
        }

        if cli.analyze && cli.positionals.is_empty() {
            Output::err_generic(
                "Missing script(s) to analyze. Pass paths to scripts to analyze their dependencies and add any missing ones to the lockfile.\n",
                (),
            );
            Global::crash();
        }

        if cli.add_catalog.is_some() && cli.global {
            Output::err_generic("--catalog cannot be used with --global\n", ());
            Global::crash();
        }

        if cli.global
            && matches!(
                subcommand,
                Subcommand::Install | Subcommand::Add | Subcommand::Remove | Subcommand::Update
            )
        {
            if !cli.filters.is_empty() {
                Output::err_generic("--filter cannot be used with --global\n", ());
                Global::crash();
            }
            // The global dir has no workspaces, so --recursive selects nothing
            // extra. Pre-1.4 accepted the combination, so treat it as a no-op
            // instead of an error.
            cli.recursive = false;
        }

        // With `-g` they would run in the global folder, on its own package.json.
        if matches!(subcommand, Subcommand::Link | Subcommand::Unlink) {
            cli.global = false;
        }

        if cli.global && subcommand == Subcommand::Prune {
            Output::err_generic("--global cannot be used with bun prune\n", ());
            bun_core::note!(
                "the global folder is also the 'bun link' registry, and bun.lock does not list linked packages"
            );
            Global::crash();
        }

        if cli.add_catalog.is_some()
            && subcommand == Subcommand::Install
            && cli.positionals.len() < 2
        {
            Output::err_generic("no package specified to add\n", ());
            Global::crash();
        }

        if subcommand == Subcommand::Pm {
            // `bun pm version` command options
            cli.no_git_tag_version = match args.option(b"--git-tag-version") {
                Some(git_tag_version) => git_tag_version == b"false",
                None => args.flag(b"--no-git-tag-version"),
            };
            cli.allow_same_version = args.flag(b"--allow-same-version");
            cli.preid = args.option(b"--preid").unwrap_or_default();
            cli.message = args.option(b"--message");
            cli.all = args.flag(b"--all");
            cli.trusted_only = args.flag(b"--trusted");
            cli.dev_only = args.flag(b"--dev");
            cli.long = args.flag(b"--long");
            cli.diff_args = args.options(b"--diff").to_vec();
            cli.diff_name_only = args.flag(b"--name-only");
            cli.diff_raw = args.flag(b"--raw") || args.flag(b"--unformatted");
            let pm_command: &[u8] = match cli.positionals {
                [first, rest @ ..] if *first == b"pm" => rest.first().copied().unwrap_or(b""),
                [first, ..] => *first,
                [] => b"",
            };
            let flags_of: &[u8] = if pm_command == b"list" {
                b"ls"
            } else {
                pm_command
            };
            for &flag in PM_SUBCOMMAND_FLAGS.iter().flat_map(|(_, flags)| *flags) {
                let takes_it = || {
                    (PM_SUBCOMMAND_FLAGS.iter())
                        .filter(move |(_, flags)| flags.contains(&flag))
                        .map(|(name, _)| *name)
                };
                if args.has(flag) && !takes_it().any(|name| name == flags_of) {
                    let commands: Vec<String> = takes_it()
                        .map(|name| format!("`bun pm {}`", bstr::BStr::new(name)))
                        .collect();
                    Output::err_generic(
                        "{} is only supported by {}",
                        (bstr::BStr::new(flag), commands.join(", ")),
                    );
                    Global::exit(1);
                }
            }
            cli.no_project_ok = match pm_command {
                b"" | b"diff" | b"view" | b"cache" | b"whoami" | b"default-trusted" => true,
                b"bin" | b"ls" | b"list" => cli.global,
                _ => false,
            };
            cli.diff_unminify = args.flag(b"--unminify");
            cli.diff_minify = args.flag(b"--minify");
            cli.diff_ignore_space = args.flag(b"--ignore-space");
            cli.diff_stat = args.flag(b"--stat");
            if let Some(n) = args.option(b"--unified") {
                match strings::parse_int::<usize>(n, 10) {
                    Ok(v) => cli.diff_context = Some(v),
                    Err(_) => {
                        Output::err_generic(
                            "invalid --unified value: {}, expected a non-negative integer",
                            (bstr::BStr::new(n),),
                        );
                        Global::exit(1);
                    }
                }
            }
            if let Some(n) = args.option(b"--max-age") {
                match strings::parse_int::<u32>(n, 10) {
                    Ok(v) => cli.cache_max_age_days = Some(v),
                    Err(_) => {
                        Output::err_generic(
                            "invalid --max-age value: {}, expected a number of days",
                            (bstr::BStr::new(n),),
                        );
                        Global::exit(1);
                    }
                }
            }
        } else if subcommand == Subcommand::Info {
            cli.no_project_ok = true;
        }

        // `bun pm why` and `bun why` options
        if matches!(subcommand, Subcommand::Pm | Subcommand::Why) {
            cli.top_only = args.flag(b"--top");
            if let Some(depth) = args.option(b"--depth") {
                cli.depth = Some(match strings::parse_int::<usize>(depth, 10) {
                    Ok(d) => d,
                    Err(_) => {
                        Output::err_generic(
                            "invalid depth value: '{}', must be a positive integer",
                            (bstr::BStr::new(depth),),
                        );
                        Global::exit(1);
                    }
                });
            }
        }

        Ok(cli)
    }
}
