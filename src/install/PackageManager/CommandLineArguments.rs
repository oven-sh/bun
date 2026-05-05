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

use bun_clap as clap;
use bun_core::{Global, Output};
use bun_str::strings;
use bun_paths::{self as Path, PathBuffer};
use bun_install::npm as Npm;
use bun_install::PackageInstall;
use bun_install::package_manager::Subcommand;
// TODO(b0): PackageManagerCommand arrives from move-in
// (bun_runtime::cli::package_manager_command::PackageManagerCommand → install::PackageManager::CommandLineArguments).
use crate::package_manager::PackageManagerCommand;

use super::package_manager_options as Options;

type ParamType = clap::Param<clap::Help>;

#[cfg(target_os = "macos")]
const PLATFORM_SPECIFIC_BACKEND_LABEL: &str =
    "Possible values: \"clonefile\" (default), \"hardlink\", \"symlink\", \"copyfile\"";
#[cfg(not(target_os = "macos"))]
const PLATFORM_SPECIFIC_BACKEND_LABEL: &str =
    "Possible values: \"hardlink\" (default), \"symlink\", \"copyfile\"";

// TODO(port): `clap.parseParam` is comptime in Zig (`catch unreachable`). In Rust this needs a
// `const fn` parser or a proc-macro (`bun_clap::param!`). Phase B should pick one; written here
// as `clap::param!(...)` which is assumed to expand to a `ParamType` value usable in a `static`.
// TODO(port): Zig `++` does comptime array concatenation. `concat_params![a, b]` is a placeholder
// for a `const`-capable concat (Phase B: `const_concat` crate, a build-time generator, or a
// `LazyLock<Vec<ParamType>>`).

static SHARED_PARAMS: &[ParamType] = &[
    clap::param!("-c, --config <STR>?                   Specify path to config file (bunfig.toml)"),
    clap::param!("-y, --yarn                            Write a yarn.lock file (yarn v1)"),
    clap::param!("-p, --production                      Don't install devDependencies"),
    clap::param!("-P, --prod"),
    clap::param!("--no-save                             Don't update package.json or save a lockfile"),
    clap::param!("--save                                Save to package.json (true by default)"),
    clap::param!("--ca <STR>...                         Provide a Certificate Authority signing certificate"),
    clap::param!("--cafile <STR>                        The same as `--ca`, but is a file path to the certificate"),
    clap::param!("--dry-run                             Perform a dry run without making changes"),
    clap::param!("--frozen-lockfile                     Disallow changes to lockfile"),
    clap::param!("-f, --force                           Always request the latest versions from the registry & reinstall all dependencies"),
    clap::param!("--cache-dir <PATH>                    Store & load cached data from a specific directory path"),
    clap::param!("--no-cache                            Ignore manifest cache entirely"),
    clap::param!("--silent                              Don't log anything"),
    clap::param!("--quiet                               Only show tarball name when packing"),
    clap::param!("--verbose                             Excessively verbose logging"),
    clap::param!("--no-progress                         Disable the progress bar"),
    clap::param!("--no-summary                          Don't print a summary"),
    clap::param!("--no-verify                           Skip verifying integrity of newly downloaded packages"),
    clap::param!("--ignore-scripts                      Skip lifecycle scripts in the project's package.json (dependency scripts are never run)"),
    clap::param!("--trust                               Add to trustedDependencies in the project's package.json and install the package(s)"),
    clap::param!("-g, --global                          Install globally"),
    clap::param!("--cwd <STR>                           Set a specific cwd"),
    clap::param!(const_format::concatcp!("--backend <STR>                       Platform-specific optimizations for installing dependencies. ", PLATFORM_SPECIFIC_BACKEND_LABEL)),
    clap::param!("--registry <STR>                      Use a specific registry by default, overriding .npmrc, bunfig.toml and environment variables"),
    clap::param!("--concurrent-scripts <NUM>            Maximum number of concurrent jobs for lifecycle scripts (default: 2x CPU cores)"),
    clap::param!("--network-concurrency <NUM>           Maximum number of concurrent network requests (default 48)"),
    clap::param!("--save-text-lockfile                  Save a text-based lockfile"),
    clap::param!("--omit <dev|optional|peer>...         Exclude 'dev', 'optional', or 'peer' dependencies from install"),
    clap::param!("--lockfile-only                       Generate a lockfile without installing dependencies"),
    clap::param!("--linker <STR>                        Linker strategy (one of \"isolated\" or \"hoisted\")"),
    clap::param!("--minimum-release-age <NUM>           Only install packages published at least N seconds ago (security feature)"),
    clap::param!("--cpu <STR>...                        Override CPU architecture for optional dependencies (e.g., x64, arm64, * for all)"),
    clap::param!("--os <STR>...                         Override operating system for optional dependencies (e.g., linux, darwin, * for all)"),
    clap::param!("-h, --help                            Print this help menu"),
];

pub static INSTALL_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("-d, --dev                 Add dependency to \"devDependencies\""),
    clap::param!("-D, --development"),
    clap::param!("--optional                        Add dependency to \"optionalDependencies\""),
    clap::param!("--peer                        Add dependency to \"peerDependencies\""),
    clap::param!("-E, --exact                  Add the exact version instead of the ^range"),
    clap::param!("--filter <STR>...                 Install packages for the matching workspaces"),
    clap::param!("-a, --analyze                   Analyze & install all dependencies of files passed as arguments recursively (using Bun's bundler)"),
    clap::param!("--only-missing                  Only add dependencies to package.json if they are not already present"),
    clap::param!("<POS> ...                         "),
]];

pub static UPDATE_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("--latest                              Update packages to their latest versions"),
    clap::param!("-i, --interactive                     Show an interactive list of outdated packages to select for update"),
    clap::param!("--filter <STR>...                     Update packages for the matching workspaces"),
    clap::param!("-r, --recursive                       Update packages in all workspaces"),
    clap::param!("<POS> ...                             \"name\" of packages to update"),
]];

pub static PM_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("-a, --all"),
    clap::param!("--json                              Output in JSON format"),
    // clap::param!("--filter <STR>...                      Pack each matching workspace"),
    clap::param!("--destination <STR>                    The directory the tarball will be saved in"),
    clap::param!("--filename <STR>                       The filename of the tarball"),
    clap::param!("--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9."),
    clap::param!("--git-tag-version <BOOL>               Create a git commit and tag"),
    clap::param!("--no-git-tag-version"),
    clap::param!("--allow-same-version                   Allow bumping to the same version"),
    clap::param!("-m, --message <STR>                    Use the given message for the commit"),
    clap::param!("--preid <STR>                          Identifier to be used to prefix premajor, preminor, prepatch or prerelease version increments"),
    clap::param!("--top                                Show only the first level of dependencies"),
    clap::param!("--depth <NUM>                          Maximum depth of the dependency tree to display"),
    clap::param!("<POS> ...                         "),
]];

pub static ADD_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("-d, --dev                 Add dependency to \"devDependencies\""),
    clap::param!("-D, --development"),
    clap::param!("--optional                        Add dependency to \"optionalDependencies\""),
    clap::param!("--peer                        Add dependency to \"peerDependencies\""),
    clap::param!("-E, --exact                  Add the exact version instead of the ^range"),
    clap::param!("-a, --analyze                   Recursively analyze & install dependencies of files passed as arguments (using Bun's bundler)"),
    clap::param!("--only-missing                  Only add dependencies to package.json if they are not already present"),
    clap::param!("<POS> ...                         \"name\" or \"name@version\" of package(s) to install"),
]];

pub static REMOVE_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("<POS> ...                         \"name\" of package(s) to remove from package.json"),
]];

pub static LINK_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("<POS> ...                         \"name\" install package as a link"),
]];

pub static UNLINK_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("<POS> ...                         \"name\" uninstall package as a link"),
]];

static PATCH_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("<POS> ...                         \"name\" of the package to patch"),
    clap::param!("--commit                         Install a package containing modifications in `dir`"),
    clap::param!("--patches-dir <dir>                    The directory to put the patch file in (only if --commit is used)"),
]];

static PATCH_COMMIT_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("<POS> ...                         \"dir\" containing changes to a package"),
    clap::param!("--patches-dir <dir>                    The directory to put the patch file"),
]];

static OUTDATED_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    // clap::param!("--json                                 Output outdated information in JSON format"),
    clap::param!("-F, --filter <STR>...                  Display outdated dependencies for each matching workspace"),
    clap::param!("-r, --recursive                        Check outdated packages in all workspaces"),
    clap::param!("<POS> ...                              Package patterns to filter by"),
]];

static AUDIT_PARAMS: &[ParamType] = &[
    clap::param!("<POS> ...                              Check installed packages for vulnerabilities"),
    clap::param!("--json                                 Output in JSON format"),
    clap::param!("--audit-level <STR>                    Only print advisories with severity greater than or equal to <level> (low, moderate, high, critical)"),
    clap::param!("--ignore <STR>...                      Ignore specific CVE IDs from audit"),
];

static INFO_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("<POS> ...                              Package name or path to package.json"),
    clap::param!("--json                                 Output in JSON format"),
]];

static PACK_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    // clap::param!("--filter <STR>...                      Pack each matching workspace"),
    clap::param!("--destination <STR>                    The directory the tarball will be saved in"),
    clap::param!("--filename <STR>                       The filename of the tarball"),
    clap::param!("--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9."),
    clap::param!("<POS> ...                              "),
]];

static PUBLISH_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("<POS> ...                              Package tarball to publish"),
    clap::param!("--access <STR>                         Set access level for scoped packages"),
    clap::param!("--tag <STR>                            Tag the release. Default is \"latest\""),
    clap::param!("--otp <STR>                            Provide a one-time password for authentication"),
    clap::param!("--auth-type <STR>                      Specify the type of one-time password authentication (default is 'web')"),
    clap::param!("--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9."),
    clap::param!("--tolerate-republish                   Don't exit with code 1 when republishing over an existing version number"),
]];

static WHY_PARAMS: &[ParamType] = concat_params![SHARED_PARAMS, &[
    clap::param!("<POS> ...                              Package name to explain why it's installed"),
    clap::param!("--top                                  Show only the top dependency tree instead of nested ones"),
    clap::param!("--depth <NUM>                          Maximum depth of the dependency tree to display"),
]];

// NOTE: `string` (= `[]const u8`) fields here are slices into process argv (owned by `clap::Args`
// which itself lives for the program duration). They are never freed. Mapped to `&'static [u8]`
// per PORTING.md (no `deinit`, never `allocator.free`d). Phase B may want to thread an explicit
// lifetime if `clap::Args` ever becomes scoped.
pub struct CommandLineArguments {
    pub cache_dir: Option<&'static [u8]>,
    pub lockfile: &'static [u8],
    pub token: &'static [u8],
    pub global: bool,
    pub config: Option<&'static [u8]>,
    pub network_concurrency: Option<u16>,
    pub backend: Option<PackageInstall::Method>,
    pub analyze: bool,
    pub only_missing: bool,
    pub positionals: &'static [&'static [u8]],

    pub yarn: bool,
    pub production: bool,
    pub frozen_lockfile: bool,
    pub no_save: bool,
    pub dry_run: bool,
    pub force: bool,
    pub no_cache: bool,
    pub silent: bool,
    pub quiet: bool,
    pub verbose: bool,
    pub no_progress: bool,
    pub no_verify: bool,
    pub ignore_scripts: bool,
    pub trusted: bool,
    pub no_summary: bool,
    pub latest: bool,
    pub interactive: bool,
    pub json_output: bool,
    pub recursive: bool,
    pub filters: &'static [&'static [u8]],

    pub pack_destination: &'static [u8],
    pub pack_filename: &'static [u8],
    pub pack_gzip_level: Option<&'static [u8]>,

    pub development: bool,
    pub optional: bool,
    pub peer: bool,

    pub omit: Option<Omit>,

    pub exact: bool,

    pub concurrent_scripts: Option<usize>,

    pub patch: PatchOpts,

    pub registry: &'static [u8],

    pub publish_config: Options::PublishConfig,

    pub tolerate_republish: bool,

    pub ca: &'static [&'static [u8]],
    pub ca_file_name: &'static [u8],

    pub save_text_lockfile: Option<bool>,

    pub lockfile_only: bool,

    pub node_linker: Option<Options::NodeLinker>,

    pub minimum_release_age_ms: Option<f64>,

    // `bun pm version` options
    pub git_tag_version: bool,
    pub allow_same_version: bool,
    pub preid: &'static [u8],
    pub message: Option<&'static [u8]>,

    // `bun pm why` options
    pub top_only: bool,
    pub depth: Option<usize>,

    // `bun audit` options
    pub audit_level: Option<AuditLevel>,
    pub audit_ignore_list: &'static [&'static [u8]],

    // CPU and OS overrides for optional dependencies
    pub cpu: Npm::Architecture,
    pub os: Npm::OperatingSystem,
}

impl Default for CommandLineArguments {
    fn default() -> Self {
        Self {
            cache_dir: None,
            lockfile: b"",
            token: b"",
            global: false,
            config: None,
            network_concurrency: None,
            backend: None,
            analyze: false,
            only_missing: false,
            positionals: &[],

            yarn: false,
            production: false,
            frozen_lockfile: false,
            no_save: false,
            dry_run: false,
            force: false,
            no_cache: false,
            silent: false,
            quiet: false,
            verbose: false,
            no_progress: false,
            no_verify: false,
            ignore_scripts: false,
            trusted: false,
            no_summary: false,
            latest: false,
            interactive: false,
            json_output: false,
            recursive: false,
            filters: &[],

            pack_destination: b"",
            pack_filename: b"",
            pack_gzip_level: None,

            development: false,
            optional: false,
            peer: false,

            omit: None,

            exact: false,

            concurrent_scripts: None,

            patch: PatchOpts::Nothing,

            registry: b"",

            publish_config: Options::PublishConfig::default(),

            tolerate_republish: false,

            ca: &[],
            ca_file_name: b"",

            save_text_lockfile: None,

            lockfile_only: false,

            node_linker: None,

            minimum_release_age_ms: None,

            git_tag_version: true,
            allow_same_version: false,
            preid: b"",
            message: None,

            top_only: false,
            depth: None,

            audit_level: None,
            audit_ignore_list: &[],

            cpu: Npm::Architecture::CURRENT,
            os: Npm::OperatingSystem::CURRENT,
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum AuditLevel {
    Low,
    Moderate,
    High,
    Critical,
}

static AUDIT_LEVEL_MAP: phf::Map<&'static [u8], AuditLevel> = phf::phf_map! {
    b"low" => AuditLevel::Low,
    b"moderate" => AuditLevel::Moderate,
    b"high" => AuditLevel::High,
    b"critical" => AuditLevel::Critical,
};

impl AuditLevel {
    pub fn from_string(str: &[u8]) -> Option<AuditLevel> {
        AUDIT_LEVEL_MAP.get(str).copied()
    }

    pub fn should_include_severity(self, severity: &[u8]) -> bool {
        let severity_level = AuditLevel::from_string(severity).unwrap_or(AuditLevel::Moderate);
        (severity_level as u8) >= (self as u8)
    }
}

pub enum PatchOpts {
    Nothing,
    Patch,
    Commit { patches_dir: &'static [u8] },
}

impl Default for PatchOpts {
    fn default() -> Self {
        PatchOpts::Nothing
    }
}

#[derive(Default, Copy, Clone)]
pub struct Omit {
    pub dev: bool,
    pub optional: bool,
    pub peer: bool,
}

impl CommandLineArguments {
    pub fn print_help(subcommand: Subcommand) {
        // the output of --help uses the following syntax highlighting
        // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
        // use [foo] for multiple arguments or flags for foo.
        // use <bar> to emphasize 'bar'

        match subcommand {
            // fall back to HelpCommand.printWithReason
            Subcommand::Install => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun install<r> <cyan>[flags]<r> <blue>\<name\><r><d>@\<version\><r>
<b>Alias<r>: <b><green>bun i<r>

  Install the dependencies listed in package.json.

<b>Flags:<r>";
                let outro_text = r"

<b>Examples:<r>
  <d>Install the dependencies for the current project<r>
  <b><green>bun install<r>

  <d>Skip devDependencies<r>
  <b><green>bun install<r> <cyan>--production<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/install<r>.
";
                Output::pretty(intro_text);
                clap::simple_help(INSTALL_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Update => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun update<r> <cyan>[flags]<r> <blue>\<name\><r><d>@\<version\><r>

  Update dependencies to their most recent versions within the version range in package.json.

<b>Flags:<r>";
                let outro_text = r"

<b>Examples:<r>
  <d>Update all dependencies:<r>
  <b><green>bun update<r>

  <d>Update all dependencies to latest:<r>
  <b><green>bun update<r> <cyan>--latest<r>

  <d>Interactive update (select packages to update):<r>
  <b><green>bun update<r> <cyan>-i<r>

  <d>Update specific packages:<r>
  <b><green>bun update<r> <blue>zod jquery@3<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/update<r>.
";
                Output::pretty(intro_text);
                clap::simple_help(UPDATE_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Patch => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun patch<r> <cyan>[flags or options]<r> <blue>\<package\><r><d>@\<version\><r>

  Prepare a package for patching, or generate and save a patch.

<b>Flags:<r>";

                let outro_text = r"

<b>Examples:<r>
  <d>Prepare jquery for patching<r>
  <b><green>bun patch jquery<r>

  <d>Generate a patch file for changes made to jquery<r>
  <b><green>bun patch --commit 'node_modules/jquery'<r>

  <d>Generate a patch file in a custom directory for changes made to jquery<r>
  <b><green>bun patch --patches-dir 'my-patches' 'node_modules/jquery'<r>

Full documentation is available at <magenta>https://bun.com/docs/install/patch<r>.
";

                Output::pretty(intro_text);
                clap::simple_help(PATCH_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::PatchCommit => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun patch-commit<r> <cyan>[flags or options]<r> <blue>\<directory\><r>

  Generate a patch out of a directory and save it. This is equivalent to <b><green>bun patch --commit<r>.

<b>Flags:<r>";
                let outro_text = r"

<b>Examples:<r>
  <d>Generate a patch in the default "./patches" directory for changes in "./node_modules/jquery"<r>
  <b><green>bun patch-commit 'node_modules/jquery'<r>

  <d>Generate a patch in a custom directory ("./my-patches")<r>
  <b><green>bun patch-commit --patches-dir 'my-patches' 'node_modules/jquery'<r>

Full documentation is available at <magenta>https://bun.com/docs/install/patch<r>.
";
                Output::pretty(intro_text);
                clap::simple_help(PATCH_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Pm => {
                PackageManagerCommand::print_help();
            }
            Subcommand::Add => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun add<r> <cyan>[flags]<r> <blue>\<package\><r><d>\<@version\><r>
<b>Alias<r>: <b><green>bun a<r>

  Add a new dependency to package.json and install it.

<b>Flags:<r>";
                let outro_text = r"

<b>Examples:<r>
  <d>Add a dependency from the npm registry<r>
  <b><green>bun add<r> <blue>zod<r>
  <b><green>bun add<r> <blue>zod@next<r>
  <b><green>bun add<r> <blue>zod@3.0.0<r>

  <d>Add a dev, optional, or peer dependency <r>
  <b><green>bun add<r> <cyan>-d<r> <blue>typescript<r>
  <b><green>bun add<r> <cyan>--optional<r> <blue>lodash<r>
  <b><green>bun add<r> <cyan>--peer<r> <blue>esbuild<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/add<r>.
";
                Output::pretty(intro_text);
                clap::simple_help(ADD_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Remove => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun remove<r> <cyan>[flags]<r> <blue>[\<packages\>]<r>
<b>Alias<r>: <b><green>bun r<r>

  Remove a package from package.json and uninstall from node_modules.

<b>Flags:<r>";
                let outro_text = r"

<b>Examples:<r>
  <d>Remove a dependency<r>
  <b><green>bun remove<r> <blue>ts-node<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/remove<r>.
";
                Output::pretty(intro_text);
                clap::simple_help(REMOVE_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Link => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun link<r> <cyan>[flags]<r> <blue>[\<packages\>]<r>

  Register a local directory as a "linkable" package, or link a "linkable" package to the current project.

<b>Flags:<r>";
                let outro_text = r"

<b>Examples:<r>
  <d>Register the current directory as a linkable package.<r>
  <d>Directory should contain a package.json.<r>
  <b><green>bun link<r>

  <d>Add a previously-registered linkable package as a dependency of the current project.<r>
  <b><green>bun link<r> <blue>\<package\><r>

Full documentation is available at <magenta>https://bun.com/docs/cli/link<r>.
";
                Output::pretty(intro_text);
                clap::simple_help(LINK_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Unlink => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun unlink<r> <cyan>[flags]<r>

  Unregister the current directory as a "linkable" package.

<b>Flags:<r>";

                let outro_text = r"

<b>Examples:<r>
  <d>Unregister the current directory as a linkable package.<r>
  <b><green>bun unlink<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/unlink<r>.
";

                Output::pretty(intro_text);
                clap::simple_help(UNLINK_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Outdated => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun outdated<r> <cyan>[flags]<r> <blue>[filter]<r>

  Display outdated dependencies for each matching workspace.

<b>Flags:<r>";

                let outro_text = r#"

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
"#;

                Output::pretty(intro_text);
                clap::simple_help(OUTDATED_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Pack => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun pm pack<r> <cyan>[flags]<r>

  Create a tarball for the current project.

<b>Flags:<r>";

                let outro_text = r"

<b>Examples:<r>
  <b><green>bun pm pack<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/pm#pack<r>.
";

                Output::pretty(intro_text);
                clap::simple_help(PACK_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Publish => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun publish<r> <cyan>[flags]<r> <blue>[dist]<r>

  Publish a package to the npm registry.

<b>Flags:<r>";

                let outro_text = r"

<b>Examples:<r>
  <d>Display files that would be published, without publishing to the registry.<r>
  <b><green>bun publish<r> <cyan>--dry-run<r>

  <d>Publish the current package with public access.<r>
  <b><green>bun publish<r> <cyan>--access public<r>

  <d>Publish a pre-existing package tarball with tag 'next'.<r>
  <b><green>bun publish<r> <cyan>--tag next<r> <blue>./path/to/tarball.tgz<r>

  <d>Publish without failing when republishing over an existing version.<r>
  <b><green>bun publish<r> <cyan>--tolerate-republish<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/publish<r>.
";

                Output::pretty(intro_text);
                clap::simple_help(PUBLISH_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Audit => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun audit<r> <cyan>[flags]<r>

  Check installed packages for vulnerabilities.

<b>Flags:<r>";

                let outro_text = r"

<b>Examples:<r>
  <d>Check the current project's packages for vulnerabilities.<r>
  <b><green>bun audit<r>

  <d>Output package vulnerabilities in JSON format.<r>
  <b><green>bun audit --json<r>

Full documentation is available at <magenta>https://bun.com/docs/install/audit<r>.
";

                Output::pretty(intro_text);
                clap::simple_help(AUDIT_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Info => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun info<r> <cyan>[flags]<r> <blue>\<package\><r><d>[@\<version\>]<r>

  View package metadata from the registry.

<b>Flags:<r>";

                let outro_text = r"

<b>Examples:<r>
  <d>Display metadata for the 'react' package<r>
  <b><green>bun info<r> <blue>react<r>

  <d>Display a specific version of a package<r>
  <b><green>bun info<r> <blue>react@18.0.0<r>

  <d>Display a specific property in JSON format<r>
  <b><green>bun info<r> <blue>react<r> version <cyan>--json<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/info<r>.
";

                Output::pretty(intro_text);
                clap::simple_help(INFO_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Why => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun why<r> <cyan>[flags]<r> <blue>\<package\><r>

  Explain why a package is installed.

<b>Flags:<r>";

                let outro_text = r#"

<b>Examples:<r>
  <d>$<r> <b><green>bun why<r> <blue>react<r>
  <d>$<r> <b><green>bun why<r> <blue>"@types/*"<r> <cyan>--depth<r> <blue>2<r>
  <d>$<r> <b><green>bun why<r> <blue>"*-lodash"<r> <cyan>--top<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/why<r>.
"#;

                Output::pretty(intro_text);
                clap::simple_help(WHY_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
            Subcommand::Scan => {
                let intro_text = r"
<b>Usage<r>: <b><green>bun pm scan<r> <cyan>[flags]<r>

  Scan all packages in lockfile for security vulnerabilities.

<b>Flags:<r>";

                let outro_text = r"

<b>Examples:<r>
  <d>Scan all packages for vulnerabilities<r>
  <b><green>bun pm scan<r>

  <d>Output results as JSON<r>
  <b><green>bun pm scan<r> <cyan>--json<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/pm#scan<r>.
";

                Output::pretty(intro_text);
                clap::simple_help(PM_PARAMS);
                Output::pretty(outro_text);
                Output::flush();
            }
        }
    }

    // TODO(port): narrow error set
    pub fn parse<const SUBCOMMAND: Subcommand>() -> Result<CommandLineArguments, bun_core::Error> {
        // PERF(port): was comptime monomorphization on `subcommand` — profile in Phase B
        Output::set_is_verbose(Output::is_verbose());

        let params: &'static [ParamType] = match SUBCOMMAND {
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

            // TODO: we will probably want to do this for other *_params. this way extra params
            // are not included in the help text
            // TODO(port): comptime `shared_params ++ audit_params` — needs const concat
            Subcommand::Audit => concat_params![SHARED_PARAMS, AUDIT_PARAMS],
            Subcommand::Info => INFO_PARAMS,
            Subcommand::Scan => PM_PARAMS, // scan uses the same params as pm command
        };

        let mut diag = clap::Diagnostic::default();

        let args = match clap::parse::<clap::Help>(params, clap::ParseOptions {
            diagnostic: Some(&mut diag),
        }) {
            Ok(a) => a,
            Err(err) => {
                Self::print_help(SUBCOMMAND);
                let _ = diag.report(Output::error_writer(), err);
                Global::exit(1);
            }
        };

        if args.flag("--help") {
            Self::print_help(SUBCOMMAND);
            Global::exit(0);
        }

        let mut cli = CommandLineArguments::default();
        cli.positionals = args.positionals();
        cli.yarn = args.flag("--yarn");
        cli.production = args.flag("--production") || args.flag("--prod");
        cli.frozen_lockfile = args.flag("--frozen-lockfile")
            || (!cli.positionals.is_empty() && cli.positionals[0] == b"ci");
        cli.no_progress = args.flag("--no-progress");
        cli.dry_run = args.flag("--dry-run");
        cli.global = args.flag("--global");
        cli.force = args.flag("--force");
        cli.no_verify = args.flag("--no-verify");
        cli.no_cache = args.flag("--no-cache");
        cli.silent = args.flag("--silent");
        cli.quiet = args.flag("--quiet");
        cli.verbose = args.flag("--verbose") || Output::is_verbose();
        cli.ignore_scripts = args.flag("--ignore-scripts");
        cli.trusted = args.flag("--trust");
        cli.no_summary = args.flag("--no-summary");
        cli.ca = args.options("--ca");
        cli.lockfile_only = args.flag("--lockfile-only");

        if let Some(linker) = args.option("--linker") {
            cli.node_linker = Some(match Options::NodeLinker::from_str(linker) {
                Some(l) => l,
                None => {
                    Output::err_generic("Expected --linker to be one of 'isolated' or 'hoisted'");
                    Global::exit(1);
                }
            });
        }

        if let Some(cache_dir) = args.option("--cache-dir") {
            cli.cache_dir = Some(cache_dir);
        }

        if let Some(ca_file_name) = args.option("--cafile") {
            cli.ca_file_name = ca_file_name;
        }

        if let Some(network_concurrency) = args.option("--network-concurrency") {
            // TODO(port): parse u16 from &[u8] — bun_str helper or core::str::from_utf8 + parse
            cli.network_concurrency = Some(match bun_str::parse_int::<u16>(network_concurrency, 10) {
                Ok(n) => n,
                Err(_) => {
                    Output::err_generic(format_args!(
                        "Expected --network-concurrency to be a number between 0 and 65535: {}",
                        bstr::BStr::new(network_concurrency)
                    ));
                    Global::crash();
                }
            });
        }

        if args.flag("--save-text-lockfile") {
            cli.save_text_lockfile = Some(true);
        }

        if let Some(min_age_secs) = args.option("--minimum-release-age") {
            // TODO(port): parse f64 from &[u8]
            let secs: f64 = match bun_str::parse_float(min_age_secs) {
                Ok(s) => s,
                Err(_) => {
                    Output::err_generic(format_args!(
                        "Expected --minimum-release-age to be a positive number: {}",
                        bstr::BStr::new(min_age_secs)
                    ));
                    Global::crash();
                }
            };
            if secs < 0.0 {
                Output::err_generic(format_args!(
                    "Expected --minimum-release-age to be a positive number: {}",
                    bstr::BStr::new(min_age_secs)
                ));
                Global::crash();
            }
            const MS_PER_S: f64 = 1000.0;
            cli.minimum_release_age_ms = Some(secs * MS_PER_S);
        }

        let omit_values = args.options("--omit");

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
                    Output::err_generic(format_args!(
                        "invalid `omit` value: '{}'",
                        bstr::BStr::new(omit_value)
                    ));
                    Global::crash();
                }
            }
            cli.omit = Some(omit);
        }

        // commands that support --filter
        if SUBCOMMAND.supports_workspace_filtering() {
            cli.filters = args.options("--filter");
        }

        if SUBCOMMAND.supports_json_output() {
            cli.json_output = args.flag("--json");
        }

        if SUBCOMMAND == Subcommand::Outdated {
            // fake --dry-run, we don't actually resolve+clean the lockfile
            cli.dry_run = true;
            cli.recursive = args.flag("--recursive");
            // cli.json_output = args.flag("--json");
        }

        if matches!(SUBCOMMAND, Subcommand::Pack | Subcommand::Pm | Subcommand::Publish) {
            if SUBCOMMAND != Subcommand::Publish {
                if let Some(dest) = args.option("--destination") {
                    cli.pack_destination = dest;
                }
                if let Some(file) = args.option("--filename") {
                    cli.pack_filename = file;
                }
            }

            if let Some(level) = args.option("--gzip-level") {
                cli.pack_gzip_level = Some(level);
            }
        }

        if SUBCOMMAND == Subcommand::Publish {
            if let Some(tag) = args.option("--tag") {
                cli.publish_config.tag = tag;
            }

            if let Some(access) = args.option("--access") {
                cli.publish_config.access = Some(match Options::Access::from_str(access) {
                    Some(a) => a,
                    None => {
                        Output::err_generic(format_args!(
                            "invalid `access` value: '{}'",
                            bstr::BStr::new(access)
                        ));
                        Global::crash();
                    }
                });
            }

            if let Some(otp) = args.option("--otp") {
                cli.publish_config.otp = otp;
            }

            if let Some(auth_type) = args.option("--auth-type") {
                cli.publish_config.auth_type = Some(match Options::AuthType::from_str(auth_type) {
                    Some(a) => a,
                    None => {
                        Output::err_generic(format_args!(
                            "invalid `auth-type` value: '{}'",
                            bstr::BStr::new(auth_type)
                        ));
                        Global::crash();
                    }
                });
            }

            cli.tolerate_republish = args.flag("--tolerate-republish");
        }

        // link and unlink default to not saving, all others default to
        // saving.
        if matches!(SUBCOMMAND, Subcommand::Link | Subcommand::Unlink) {
            cli.no_save = !args.flag("--save");
        } else {
            cli.no_save = args.flag("--no-save");
        }

        if SUBCOMMAND == Subcommand::Patch {
            let patch_commit = args.flag("--commit");
            if patch_commit {
                cli.patch = PatchOpts::Commit {
                    patches_dir: args.option("--patches-dir").unwrap_or(b"patches"),
                };
            } else {
                cli.patch = PatchOpts::Patch;
            }
        }
        if SUBCOMMAND == Subcommand::PatchCommit {
            cli.patch = PatchOpts::Commit {
                patches_dir: args.option("--patches-dir").unwrap_or(b"patches"),
            };
        }

        if SUBCOMMAND == Subcommand::Audit {
            if let Some(level) = args.option("--audit-level") {
                cli.audit_level = Some(match AuditLevel::from_string(level) {
                    Some(l) => l,
                    None => {
                        Output::err_generic(format_args!(
                            "invalid `--audit-level` value: '{}'. Valid values are: low, moderate, high, critical",
                            bstr::BStr::new(level)
                        ));
                        Global::crash();
                    }
                });
            }

            cli.audit_ignore_list = args.options("--ignore");
        }

        if let Some(opt) = args.option("--config") {
            cli.config = Some(opt);
        }

        // Parse multiple --cpu flags and combine them using Negatable
        let cpu_values = args.options("--cpu");
        if !cpu_values.is_empty() {
            let mut cpu_negatable = Npm::Architecture::NONE.negatable();
            for cpu_str in cpu_values {
                // apply() already handles "any" as wildcard and negation with !
                cpu_negatable.apply(cpu_str);

                // Support * as an alias for "any"
                if *cpu_str == *b"*" {
                    cpu_negatable.had_wildcard = true;
                    cpu_negatable.had_unrecognized_values = false;
                } else if cpu_negatable.had_unrecognized_values
                    && *cpu_str != *b"any"
                    && *cpu_str != *b"none"
                {
                    // Only error for truly unrecognized values (not "any" or "none")
                    Output::err_generic(format_args!(
                        "Invalid CPU architecture: '{}'. Valid values are: *, any, arm, arm64, ia32, mips, mipsel, ppc, ppc64, s390, s390x, x32, x64. Use !name to negate.",
                        bstr::BStr::new(cpu_str)
                    ));
                    Global::crash();
                }
            }
            cli.cpu = cpu_negatable.combine();
        }

        // Parse multiple --os flags and combine them using Negatable
        let os_values = args.options("--os");
        if !os_values.is_empty() {
            let mut os_negatable = Npm::OperatingSystem::NONE.negatable();
            for os_str in os_values {
                // apply() already handles "any" as wildcard and negation with !
                os_negatable.apply(os_str);

                // Support * as an alias for "any"
                if *os_str == *b"*" {
                    os_negatable.had_wildcard = true;
                    os_negatable.had_unrecognized_values = false;
                } else if os_negatable.had_unrecognized_values
                    && *os_str != *b"any"
                    && *os_str != *b"none"
                {
                    // Only error for truly unrecognized values (not "any" or "none")
                    Output::err_generic(format_args!(
                        "Invalid operating system: '{}'. Valid values are: *, any, aix, darwin, freebsd, linux, openbsd, sunos, win32, android. Use !name to negate.",
                        bstr::BStr::new(os_str)
                    ));
                    Global::crash();
                }
            }
            cli.os = os_negatable.combine();
        }

        if matches!(SUBCOMMAND, Subcommand::Add | Subcommand::Install) {
            cli.development = args.flag("--development") || args.flag("--dev");
            cli.optional = args.flag("--optional");
            cli.peer = args.flag("--peer");
            cli.exact = args.flag("--exact");
            cli.analyze = args.flag("--analyze");
            cli.only_missing = args.flag("--only-missing");
        }

        if let Some(concurrency) = args.option("--concurrent-scripts") {
            cli.concurrent_scripts = bun_str::parse_int::<usize>(concurrency, 10).ok();
        }

        if let Some(cwd_) = args.option("--cwd") {
            let mut buf = PathBuffer::uninit();
            let mut buf2 = PathBuffer::uninit();
            let final_path: &mut bun_str::ZStr;
            if !cwd_.is_empty() && cwd_[0] == b'.' {
                let cwd = bun_sys::getcwd(&mut buf)?;
                let parts: [&[u8]; 1] = [cwd_];
                let path_ = Path::join_abs_string_buf(cwd, &mut buf2, &parts, Path::Style::Auto);
                let len = path_.len();
                buf2[len] = 0;
                // SAFETY: buf2[len] == 0 written above
                final_path = unsafe { bun_str::ZStr::from_raw_mut(buf2.as_mut_ptr(), len) };
            } else {
                buf[..cwd_.len()].copy_from_slice(cwd_);
                buf[cwd_.len()] = 0;
                // SAFETY: buf[cwd_.len()] == 0 written above
                final_path = unsafe { bun_str::ZStr::from_raw_mut(buf.as_mut_ptr(), cwd_.len()) };
            }
            if let Err(err) = bun_sys::chdir(b"", final_path).into_result() {
                Output::err_generic(format_args!(
                    "failed to change directory to \"{}\": {}\n",
                    bstr::BStr::new(final_path.as_bytes()),
                    err.name()
                ));
                Global::crash();
            }
        }

        if SUBCOMMAND == Subcommand::Update {
            cli.latest = args.flag("--latest");
            cli.interactive = args.flag("--interactive");
            cli.recursive = args.flag("--recursive");
        }

        let specified_backend: Option<PackageInstall::Method> = 'brk: {
            if let Some(backend_) = args.option("--backend") {
                break 'brk PackageInstall::Method::MAP.get(backend_).copied();
            }
            break 'brk None;
        };

        if let Some(backend) = specified_backend {
            if backend.is_supported() {
                cli.backend = Some(backend);
            }
        }

        if let Some(registry) = args.option("--registry") {
            if !strings::has_prefix(registry, b"https://") && !strings::has_prefix(registry, b"http://") {
                Output::err_generic(format_args!(
                    "Registry URL must start with 'https://' or 'http://': {}\n",
                    bun_core::fmt::quote(registry)
                ));
                Global::crash();
            }
            cli.registry = registry;
        }

        if SUBCOMMAND == Subcommand::Patch && cli.positionals.len() < 2 {
            Output::err_generic("Missing pkg to patch\n");
            Global::crash();
        }

        if SUBCOMMAND == Subcommand::PatchCommit && cli.positionals.len() < 2 {
            Output::err_generic("Missing pkg folder to patch\n");
            Global::crash();
        }

        if cli.production && cli.trusted {
            Output::err_generic("The '--production' and '--trust' flags together are not supported because the --trust flag potentially modifies the lockfile after installing packages\n");
            Global::crash();
        }

        if cli.frozen_lockfile && cli.trusted {
            Output::err_generic("The '--frozen-lockfile' and '--trust' flags together are not supported because the --trust flag potentially modifies the lockfile after installing packages\n");
            Global::crash();
        }

        if cli.analyze && cli.positionals.is_empty() {
            Output::err_generic("Missing script(s) to analyze. Pass paths to scripts to analyze their dependencies and add any missing ones to the lockfile.\n");
            Global::crash();
        }

        if SUBCOMMAND == Subcommand::Pm {
            // `bun pm version` command options
            if let Some(git_tag_version) = args.option("--git-tag-version") {
                if git_tag_version == b"true" {
                    cli.git_tag_version = true;
                } else if git_tag_version == b"false" {
                    cli.git_tag_version = false;
                }
            } else if args.flag("--no-git-tag-version") {
                cli.git_tag_version = false;
            } else {
                cli.git_tag_version = true;
            }
            cli.allow_same_version = args.flag("--allow-same-version");
            if let Some(preid) = args.option("--preid") {
                cli.preid = preid;
            }
            if let Some(message) = args.option("--message") {
                cli.message = Some(message);
            }
        }

        // `bun pm why` and `bun why` options
        if matches!(SUBCOMMAND, Subcommand::Pm | Subcommand::Why) {
            cli.top_only = args.flag("--top");
            if let Some(depth) = args.option("--depth") {
                cli.depth = Some(match bun_str::parse_int::<usize>(depth, 10) {
                    Ok(d) => d,
                    Err(_) => {
                        Output::err_generic(format_args!(
                            "invalid depth value: '{}', must be a positive integer",
                            bstr::BStr::new(depth)
                        ));
                        Global::exit(1);
                    }
                });
            }
        }

        Ok(cli)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/CommandLineArguments.zig (1159 lines)
//   confidence: medium
//   todos:      6
//   notes:      `clap::param!`/`concat_params!` are placeholder macros for comptime param parsing + array concat; string fields use &'static [u8] (argv-backed); some help raw-strings contain `"` and need `r#""#` review; `parse` is const-generic on Subcommand (was comptime).
// ──────────────────────────────────────────────────────────────────────────
