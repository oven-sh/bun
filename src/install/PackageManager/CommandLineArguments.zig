/// CLI Arguments for:
///
/// - bun install
/// - bun update
/// - bun patch
/// - bun patch-commit
/// - bun pm
/// - bun add
/// - bun remove
/// - bun link
/// - bun audit
///
const CommandLineArguments = @This();

const ParamType = clap.Param(clap.Help);
const platform_specific_backend_label = if (Environment.isMac)
    "Possible values: \"clonefile\" (default), \"hardlink\", \"symlink\", \"copyfile\""
else
    "Possible values: \"hardlink\" (default), \"symlink\", \"copyfile\"";

const shared_params = [_]ParamType{
    clap.parseParam("-c, --config <STR>?                   Specify path to config file (bunfig.toml)") catch unreachable,
    clap.parseParam("-y, --yarn                            Write a yarn.lock file (yarn v1)") catch unreachable,
    clap.parseParam("-p, --production                      Don't install devDependencies") catch unreachable,
    clap.parseParam("-P, --prod") catch unreachable,
    clap.parseParam("--no-save                             Don't update package.json or save a lockfile") catch unreachable,
    clap.parseParam("--save                                Save to package.json (true by default)") catch unreachable,
    clap.parseParam("--ca <STR>...                         Provide a Certificate Authority signing certificate") catch unreachable,
    clap.parseParam("--cafile <STR>                        The same as `--ca`, but is a file path to the certificate") catch unreachable,
    clap.parseParam("--dry-run                             Perform a dry run without making changes") catch unreachable,
    clap.parseParam("--frozen-lockfile                     Disallow changes to lockfile") catch unreachable,
    clap.parseParam("-f, --force                           Always request the latest versions from the registry & reinstall all dependencies") catch unreachable,
    clap.parseParam("--cache-dir <PATH>                    Store & load cached data from a specific directory path") catch unreachable,
    clap.parseParam("--no-cache                            Ignore manifest cache entirely") catch unreachable,
    clap.parseParam("--silent                              Don't log anything") catch unreachable,
    clap.parseParam("--quiet                               Only show tarball name when packing") catch unreachable,
    clap.parseParam("--verbose                             Excessively verbose logging") catch unreachable,
    clap.parseParam("--no-progress                         Disable the progress bar") catch unreachable,
    clap.parseParam("--no-summary                          Don't print a summary") catch unreachable,
    clap.parseParam("--no-verify                           Skip verifying integrity of newly downloaded packages") catch unreachable,
    clap.parseParam("--ignore-scripts                      Skip lifecycle scripts in the project's package.json (dependency scripts are never run)") catch unreachable,
    clap.parseParam("--trust                               Add to trustedDependencies in the project's package.json and install the package(s)") catch unreachable,
    clap.parseParam("-g, --global                          Install globally") catch unreachable,
    clap.parseParam("--cwd <STR>                           Set a specific cwd") catch unreachable,
    clap.parseParam("--backend <STR>                       Platform-specific optimizations for installing dependencies. " ++ platform_specific_backend_label) catch unreachable,
    clap.parseParam("--registry <STR>                      Use a specific registry by default, overriding .npmrc, bunfig.toml and environment variables") catch unreachable,
    clap.parseParam("--concurrent-scripts <NUM>            Maximum number of concurrent jobs for lifecycle scripts (default 5)") catch unreachable,
    clap.parseParam("--network-concurrency <NUM>           Maximum number of concurrent network requests (default 48)") catch unreachable,
    clap.parseParam("--save-text-lockfile                  Save a text-based lockfile") catch unreachable,
    clap.parseParam("--omit <dev|optional|peer>...         Exclude 'dev', 'optional', or 'peer' dependencies from install") catch unreachable,
    clap.parseParam("--lockfile-only                       Generate a lockfile without installing dependencies") catch unreachable,
    clap.parseParam("--linker <STR>                        Linker strategy (one of \"isolated\" or \"hoisted\")") catch unreachable,
    clap.parseParam("--minimum-release-age <NUM>           Only install packages published at least N seconds ago (security feature)") catch unreachable,
    clap.parseParam("--cpu <STR>...                        Override CPU architecture for optional dependencies (e.g., x64, arm64, * for all)") catch unreachable,
    clap.parseParam("--os <STR>...                         Override operating system for optional dependencies (e.g., linux, darwin, * for all)") catch unreachable,
    clap.parseParam("-h, --help                            Print this help menu") catch unreachable,
};

pub const install_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("-d, --dev                 Add dependency to \"devDependencies\"") catch unreachable,
    clap.parseParam("-D, --development") catch unreachable,
    clap.parseParam("--optional                        Add dependency to \"optionalDependencies\"") catch unreachable,
    clap.parseParam("--peer                        Add dependency to \"peerDependencies\"") catch unreachable,
    clap.parseParam("-E, --exact                  Add the exact version instead of the ^range") catch unreachable,
    clap.parseParam("--filter <STR>...                 Install packages for the matching workspaces") catch unreachable,
    clap.parseParam("-a, --analyze                   Analyze & install all dependencies of files passed as arguments recursively (using Bun's bundler)") catch unreachable,
    clap.parseParam("--only-missing                  Only add dependencies to package.json if they are not already present") catch unreachable,
    clap.parseParam("<POS> ...                         ") catch unreachable,
});

pub const update_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("--latest                              Update packages to their latest versions") catch unreachable,
    clap.parseParam("-i, --interactive                     Show an interactive list of outdated packages to select for update") catch unreachable,
    clap.parseParam("--filter <STR>...                     Update packages for the matching workspaces") catch unreachable,
    clap.parseParam("-r, --recursive                       Update packages in all workspaces") catch unreachable,
    clap.parseParam("<POS> ...                             \"name\" of packages to update") catch unreachable,
});

pub const pm_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("-a, --all") catch unreachable,
    clap.parseParam("--json                              Output in JSON format") catch unreachable,
    // clap.parseParam("--filter <STR>...                      Pack each matching workspace") catch unreachable,
    clap.parseParam("--destination <STR>                    The directory the tarball will be saved in") catch unreachable,
    clap.parseParam("--filename <STR>                       The filename of the tarball") catch unreachable,
    clap.parseParam("--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9.") catch unreachable,
    clap.parseParam("--git-tag-version <BOOL>               Create a git commit and tag") catch unreachable,
    clap.parseParam("--no-git-tag-version") catch unreachable,
    clap.parseParam("--allow-same-version                   Allow bumping to the same version") catch unreachable,
    clap.parseParam("-m, --message <STR>                    Use the given message for the commit") catch unreachable,
    clap.parseParam("--preid <STR>                          Identifier to be used to prefix premajor, preminor, prepatch or prerelease version increments") catch unreachable,
    clap.parseParam("--top                                Show only the first level of dependencies") catch unreachable,
    clap.parseParam("--depth <NUM>                          Maximum depth of the dependency tree to display") catch unreachable,
    clap.parseParam("<POS> ...                         ") catch unreachable,
});

pub const add_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("-d, --dev                 Add dependency to \"devDependencies\"") catch unreachable,
    clap.parseParam("-D, --development") catch unreachable,
    clap.parseParam("--optional                        Add dependency to \"optionalDependencies\"") catch unreachable,
    clap.parseParam("--peer                        Add dependency to \"peerDependencies\"") catch unreachable,
    clap.parseParam("-E, --exact                  Add the exact version instead of the ^range") catch unreachable,
    clap.parseParam("-a, --analyze                   Recursively analyze & install dependencies of files passed as arguments (using Bun's bundler)") catch unreachable,
    clap.parseParam("--only-missing                  Only add dependencies to package.json if they are not already present") catch unreachable,
    clap.parseParam("<POS> ...                         \"name\" or \"name@version\" of package(s) to install") catch unreachable,
});

pub const remove_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("<POS> ...                         \"name\" of package(s) to remove from package.json") catch unreachable,
});

pub const link_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("<POS> ...                         \"name\" install package as a link") catch unreachable,
});

pub const unlink_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("<POS> ...                         \"name\" uninstall package as a link") catch unreachable,
});

const patch_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("<POS> ...                         \"name\" of the package to patch") catch unreachable,
    clap.parseParam("--commit                         Install a package containing modifications in `dir`") catch unreachable,
    clap.parseParam("--patches-dir <dir>                    The directory to put the patch file in (only if --commit is used)") catch unreachable,
});

const patch_commit_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("<POS> ...                         \"dir\" containing changes to a package") catch unreachable,
    clap.parseParam("--patches-dir <dir>                    The directory to put the patch file") catch unreachable,
});

const outdated_params: []const ParamType = &(shared_params ++ [_]ParamType{
    // clap.parseParam("--json                                 Output outdated information in JSON format") catch unreachable,
    clap.parseParam("-F, --filter <STR>...                  Display outdated dependencies for each matching workspace") catch unreachable,
    clap.parseParam("-r, --recursive                        Check outdated packages in all workspaces") catch unreachable,
    clap.parseParam("<POS> ...                              Package patterns to filter by") catch unreachable,
});

const audit_params: []const ParamType = &([_]ParamType{
    clap.parseParam("<POS> ...                              Check installed packages for vulnerabilities") catch unreachable,
    clap.parseParam("--json                                 Output in JSON format") catch unreachable,
    clap.parseParam("--audit-level <STR>                    Only print advisories with severity greater than or equal to <level> (low, moderate, high, critical)") catch unreachable,
    clap.parseParam("--ignore <STR>...                      Ignore specific CVE IDs from audit") catch unreachable,
});

const info_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("<POS> ...                              Package name or path to package.json") catch unreachable,
    clap.parseParam("--json                                 Output in JSON format") catch unreachable,
});

const pack_params: []const ParamType = &(shared_params ++ [_]ParamType{
    // clap.parseParam("--filter <STR>...                      Pack each matching workspace") catch unreachable,
    clap.parseParam("--destination <STR>                    The directory the tarball will be saved in") catch unreachable,
    clap.parseParam("--filename <STR>                       The filename of the tarball") catch unreachable,
    clap.parseParam("--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9.") catch unreachable,
    clap.parseParam("<POS> ...                              ") catch unreachable,
});

const publish_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("<POS> ...                              Package tarball to publish") catch unreachable,
    clap.parseParam("--access <STR>                         Set access level for scoped packages") catch unreachable,
    clap.parseParam("--tag <STR>                            Tag the release. Default is \"latest\"") catch unreachable,
    clap.parseParam("--otp <STR>                            Provide a one-time password for authentication") catch unreachable,
    clap.parseParam("--auth-type <STR>                      Specify the type of one-time password authentication (default is 'web')") catch unreachable,
    clap.parseParam("--gzip-level <STR>                     Specify a custom compression level for gzip. Default is 9.") catch unreachable,
    clap.parseParam("--tolerate-republish                   Don't exit with code 1 when republishing over an existing version number") catch unreachable,
});

const why_params: []const ParamType = &(shared_params ++ [_]ParamType{
    clap.parseParam("<POS> ...                              Package name to explain why it's installed") catch unreachable,
    clap.parseParam("--top                                  Show only the top dependency tree instead of nested ones") catch unreachable,
    clap.parseParam("--depth <NUM>                          Maximum depth of the dependency tree to display") catch unreachable,
});

cache_dir: ?string = null,
lockfile: string = "",
token: string = "",
global: bool = false,
config: ?string = null,
network_concurrency: ?u16 = null,
backend: ?PackageInstall.Method = null,
analyze: bool = false,
only_missing: bool = false,
positionals: []const string = &[_]string{},

yarn: bool = false,
production: bool = false,
frozen_lockfile: bool = false,
no_save: bool = false,
dry_run: bool = false,
force: bool = false,
no_cache: bool = false,
silent: bool = false,
quiet: bool = false,
verbose: bool = false,
no_progress: bool = false,
no_verify: bool = false,
ignore_scripts: bool = false,
trusted: bool = false,
no_summary: bool = false,
latest: bool = false,
interactive: bool = false,
json_output: bool = false,
recursive: bool = false,
filters: []const string = &.{},

pack_destination: string = "",
pack_filename: string = "",
pack_gzip_level: ?string = null,

development: bool = false,
optional: bool = false,
peer: bool = false,

omit: ?Omit = null,

exact: bool = false,

concurrent_scripts: ?usize = null,

patch: PatchOpts = .{ .nothing = .{} },

registry: string = "",

publish_config: Options.PublishConfig = .{},

tolerate_republish: bool = false,

ca: []const string = &.{},
ca_file_name: string = "",

save_text_lockfile: ?bool = null,

lockfile_only: bool = false,

node_linker: ?Options.NodeLinker = null,

minimum_release_age_ms: ?f64 = null,

// `bun pm version` options
git_tag_version: bool = true,
allow_same_version: bool = false,
preid: string = "",
message: ?string = null,

// `bun pm why` options
top_only: bool = false,
depth: ?usize = null,

// `bun audit` options
audit_level: ?AuditLevel = null,
audit_ignore_list: []const string = &.{},

// CPU and OS overrides for optional dependencies
cpu: Npm.Architecture = Npm.Architecture.current,
os: Npm.OperatingSystem = Npm.OperatingSystem.current,

pub const AuditLevel = enum {
    low,
    moderate,
    high,
    critical,

    const Map = bun.ComptimeStringMap(AuditLevel, .{
        .{ "low", .low },
        .{ "moderate", .moderate },
        .{ "high", .high },
        .{ "critical", .critical },
    });

    pub fn fromString(str: []const u8) ?AuditLevel {
        return Map.get(str);
    }

    pub fn shouldIncludeSeverity(self: AuditLevel, severity: []const u8) bool {
        const severity_level = AuditLevel.fromString(severity) orelse .moderate;
        return @intFromEnum(severity_level) >= @intFromEnum(self);
    }
};

const PatchOpts = union(enum) {
    nothing: struct {},
    patch: struct {},
    commit: struct {
        patches_dir: []const u8 = "patches",
    },
};

const Omit = struct {
    dev: bool = false,
    optional: bool = false,
    peer: bool = false,
};

pub fn printHelp(subcommand: Subcommand) void {

    // the output of --help uses the following syntax highlighting
    // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
    // use [foo] for multiple arguments or flags for foo.
    // use <bar> to emphasize 'bar'

    switch (subcommand) {
        // fall back to HelpCommand.printWithReason
        Subcommand.install => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun install<r> <cyan>[flags]<r> <blue>\<name\><r><d>@\<version\><r>
                \\<b>Alias<r>: <b><green>bun i<r>
                \\
                \\  Install the dependencies listed in package.json.
                \\
                \\<b>Flags:<r>
            ;
            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Install the dependencies for the current project<r>
                \\  <b><green>bun install<r>
                \\
                \\  <d>Skip devDependencies<r>
                \\  <b><green>bun install<r> <cyan>--production<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/install<r>.
                \\
            ;
            Output.pretty(intro_text, .{});
            clap.simpleHelp(install_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        Subcommand.update => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun update<r> <cyan>[flags]<r> <blue>\<name\><r><d>@\<version\><r>
                \\
                \\  Update dependencies to their most recent versions within the version range in package.json.
                \\
                \\<b>Flags:<r>
            ;
            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Update all dependencies:<r>
                \\  <b><green>bun update<r>
                \\
                \\  <d>Update all dependencies to latest:<r>
                \\  <b><green>bun update<r> <cyan>--latest<r>
                \\
                \\  <d>Interactive update (select packages to update):<r>
                \\  <b><green>bun update<r> <cyan>-i<r>
                \\
                \\  <d>Update specific packages:<r>
                \\  <b><green>bun update<r> <blue>zod jquery@3<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/update<r>.
                \\
            ;
            Output.pretty(intro_text, .{});
            clap.simpleHelp(update_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        Subcommand.patch => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun patch<r> <cyan>[flags or options]<r> <blue>\<package\><r><d>@\<version\><r>
                \\
                \\  Prepare a package for patching, or generate and save a patch.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Prepare jquery for patching<r>
                \\  <b><green>bun patch jquery<r>
                \\
                \\  <d>Generate a patch file for changes made to jquery<r>
                \\  <b><green>bun patch --commit 'node_modules/jquery'<r>
                \\
                \\  <d>Generate a patch file in a custom directory for changes made to jquery<r>
                \\  <b><green>bun patch --patches-dir 'my-patches' 'node_modules/jquery'<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/install/patch<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(patch_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        Subcommand.@"patch-commit" => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun patch-commit<r> <cyan>[flags or options]<r> <blue>\<directory\><r>
                \\
                \\  Generate a patch out of a directory and save it. This is equivalent to <b><green>bun patch --commit<r>.
                \\
                \\<b>Flags:<r>
            ;
            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Generate a patch in the default "./patches" directory for changes in "./node_modules/jquery"<r>
                \\  <b><green>bun patch-commit 'node_modules/jquery'<r>
                \\
                \\  <d>Generate a patch in a custom directory ("./my-patches")<r>
                \\  <b><green>bun patch-commit --patches-dir 'my-patches' 'node_modules/jquery'<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/install/patch<r>.
                \\
            ;
            Output.pretty(intro_text, .{});
            clap.simpleHelp(patch_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        Subcommand.pm => {
            PackageManagerCommand.printHelp();
        },
        Subcommand.add => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun add<r> <cyan>[flags]<r> <blue>\<package\><r><d>\<@version\><r>
                \\<b>Alias<r>: <b><green>bun a<r>
                \\
                \\  Add a new dependency to package.json and install it.
                \\
                \\<b>Flags:<r>
            ;
            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Add a dependency from the npm registry<r>
                \\  <b><green>bun add<r> <blue>zod<r>
                \\  <b><green>bun add<r> <blue>zod@next<r>
                \\  <b><green>bun add<r> <blue>zod@3.0.0<r>
                \\
                \\  <d>Add a dev, optional, or peer dependency <r>
                \\  <b><green>bun add<r> <cyan>-d<r> <blue>typescript<r>
                \\  <b><green>bun add<r> <cyan>--optional<r> <blue>lodash<r>
                \\  <b><green>bun add<r> <cyan>--peer<r> <blue>esbuild<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/add<r>.
                \\
            ;
            Output.pretty(intro_text, .{});
            clap.simpleHelp(add_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        Subcommand.remove => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun remove<r> <cyan>[flags]<r> <blue>[\<packages\>]<r>
                \\<b>Alias<r>: <b><green>bun r<r>
                \\
                \\  Remove a package from package.json and uninstall from node_modules.
                \\
                \\<b>Flags:<r>
            ;
            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Remove a dependency<r>
                \\  <b><green>bun remove<r> <blue>ts-node<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/remove<r>.
                \\
            ;
            Output.pretty(intro_text, .{});
            clap.simpleHelp(remove_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        Subcommand.link => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun link<r> <cyan>[flags]<r> <blue>[\<packages\>]<r>
                \\
                \\  Register a local directory as a "linkable" package, or link a "linkable" package to the current project.
                \\
                \\<b>Flags:<r>
            ;
            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Register the current directory as a linkable package.<r>
                \\  <d>Directory should contain a package.json.<r>
                \\  <b><green>bun link<r>
                \\
                \\  <d>Add a previously-registered linkable package as a dependency of the current project.<r>
                \\  <b><green>bun link<r> <blue>\<package\><r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/link<r>.
                \\
            ;
            Output.pretty(intro_text, .{});
            clap.simpleHelp(link_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        Subcommand.unlink => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun unlink<r> <cyan>[flags]<r>
                \\
                \\  Unregister the current directory as a "linkable" package.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Unregister the current directory as a linkable package.<r>
                \\  <b><green>bun unlink<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/unlink<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(unlink_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        .outdated => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun outdated<r> <cyan>[flags]<r> <blue>[filter]<r>
                \\
                \\  Display outdated dependencies for each matching workspace.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Display outdated dependencies in the current workspace.<r>
                \\  <b><green>bun outdated<r>
                \\
                \\  <d>Use --filter to include more than one workspace.<r>
                \\  <b><green>bun outdated<r> <cyan>--filter="*"<r>
                \\  <b><green>bun outdated<r> <cyan>--filter="./app/*"<r>
                \\  <b><green>bun outdated<r> <cyan>--filter="!frontend"<r>
                \\
                \\  <d>Filter dependencies with name patterns.<r>
                \\  <b><green>bun outdated<r> <blue>jquery<r>
                \\  <b><green>bun outdated<r> <blue>"is-*"<r>
                \\  <b><green>bun outdated<r> <blue>"!is-even"<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/outdated<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(outdated_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        .pack => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun pm pack<r> <cyan>[flags]<r>
                \\
                \\  Create a tarball for the current project.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <b><green>bun pm pack<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/pm#pack<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(pack_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        .publish => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun publish<r> <cyan>[flags]<r> <blue>[dist]<r>
                \\
                \\  Publish a package to the npm registry.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Display files that would be published, without publishing to the registry.<r>
                \\  <b><green>bun publish<r> <cyan>--dry-run<r>
                \\
                \\  <d>Publish the current package with public access.<r>
                \\  <b><green>bun publish<r> <cyan>--access public<r>
                \\
                \\  <d>Publish a pre-existing package tarball with tag 'next'.<r>
                \\  <b><green>bun publish<r> <cyan>--tag next<r> <blue>./path/to/tarball.tgz<r>
                \\
                \\  <d>Publish without failing when republishing over an existing version.<r>
                \\  <b><green>bun publish<r> <cyan>--tolerate-republish<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/publish<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(publish_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        .audit => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun audit<r> <cyan>[flags]<r>
                \\
                \\  Check installed packages for vulnerabilities.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Check the current project's packages for vulnerabilities.<r>
                \\  <b><green>bun audit<r>
                \\
                \\  <d>Output package vulnerabilities in JSON format.<r>
                \\  <b><green>bun audit --json<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/install/audit<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(audit_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        .info => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun info<r> <cyan>[flags]<r> <blue>\<package\><r><d>[@\<version\>]<r>
                \\
                \\  View package metadata from the registry.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Display metadata for the 'react' package<r>
                \\  <b><green>bun info<r> <blue>react<r>
                \\
                \\  <d>Display a specific version of a package<r>
                \\  <b><green>bun info<r> <blue>react@18.0.0<r>
                \\
                \\  <d>Display a specific property in JSON format<r>
                \\  <b><green>bun info<r> <blue>react<r> version <cyan>--json<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/info<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(info_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        .why => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun why<r> <cyan>[flags]<r> <blue>\<package\><r>
                \\
                \\  Explain why a package is installed.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>$<r> <b><green>bun why<r> <blue>react<r>
                \\  <d>$<r> <b><green>bun why<r> <blue>"@types/*"<r> <cyan>--depth<r> <blue>2<r>
                \\  <d>$<r> <b><green>bun why<r> <blue>"*-lodash"<r> <cyan>--top<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/why<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(why_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
        .scan => {
            const intro_text =
                \\
                \\<b>Usage<r>: <b><green>bun pm scan<r> <cyan>[flags]<r>
                \\
                \\  Scan all packages in lockfile for security vulnerabilities.
                \\
                \\<b>Flags:<r>
            ;

            const outro_text =
                \\
                \\
                \\<b>Examples:<r>
                \\  <d>Scan all packages for vulnerabilities<r>
                \\  <b><green>bun pm scan<r>
                \\
                \\  <d>Output results as JSON<r>
                \\  <b><green>bun pm scan<r> <cyan>--json<r>
                \\
                \\Full documentation is available at <magenta>https://bun.com/docs/cli/pm#scan<r>.
                \\
            ;

            Output.pretty(intro_text, .{});
            clap.simpleHelp(pm_params);
            Output.pretty(outro_text, .{});
            Output.flush();
        },
    }
}

pub fn parse(allocator: std.mem.Allocator, comptime subcommand: Subcommand) !CommandLineArguments {
    Output.is_verbose = Output.isVerbose();

    const params: []const ParamType = switch (subcommand) {
        .install => install_params,
        .update => update_params,
        .pm => pm_params,
        .add => add_params,
        .remove => remove_params,
        .link => link_params,
        .unlink => unlink_params,
        .patch => patch_params,
        .@"patch-commit" => patch_commit_params,
        .outdated => outdated_params,
        .pack => pack_params,
        .publish => publish_params,
        .why => why_params,

        // TODO: we will probably want to do this for other *_params. this way extra params
        // are not included in the help text
        .audit => shared_params ++ audit_params,
        .info => info_params,
        .scan => pm_params, // scan uses the same params as pm command
    };

    var diag = clap.Diagnostic{};

    var args = clap.parse(clap.Help, params, .{
        .diagnostic = &diag,
        .allocator = allocator,
    }) catch |err| {
        printHelp(subcommand);
        diag.report(Output.errorWriter(), err) catch {};
        Global.exit(1);
    };

    if (args.flag("--help")) {
        printHelp(subcommand);
        Global.exit(0);
    }

    var cli = CommandLineArguments{};
    cli.positionals = args.positionals();
    cli.yarn = args.flag("--yarn");
    cli.production = args.flag("--production") or args.flag("--prod");
    cli.frozen_lockfile = args.flag("--frozen-lockfile") or (cli.positionals.len > 0 and strings.eqlComptime(cli.positionals[0], "ci"));
    cli.no_progress = args.flag("--no-progress");
    cli.dry_run = args.flag("--dry-run");
    cli.global = args.flag("--global");
    cli.force = args.flag("--force");
    cli.no_verify = args.flag("--no-verify");
    cli.no_cache = args.flag("--no-cache");
    cli.silent = args.flag("--silent");
    cli.quiet = args.flag("--quiet");
    cli.verbose = args.flag("--verbose") or Output.is_verbose;
    cli.ignore_scripts = args.flag("--ignore-scripts");
    cli.trusted = args.flag("--trust");
    cli.no_summary = args.flag("--no-summary");
    cli.ca = args.options("--ca");
    cli.lockfile_only = args.flag("--lockfile-only");

    if (args.option("--linker")) |linker| {
        cli.node_linker = Options.NodeLinker.fromStr(linker) orelse {
            Output.errGeneric("Expected --linker to be one of 'isolated' or 'hoisted'", .{});
            Global.exit(1);
        };
    }

    if (args.option("--cache-dir")) |cache_dir| {
        cli.cache_dir = cache_dir;
    }

    if (args.option("--cafile")) |ca_file_name| {
        cli.ca_file_name = ca_file_name;
    }

    if (args.option("--network-concurrency")) |network_concurrency| {
        cli.network_concurrency = std.fmt.parseInt(u16, network_concurrency, 10) catch {
            Output.errGeneric("Expected --network-concurrency to be a number between 0 and 65535: {s}", .{network_concurrency});
            Global.crash();
        };
    }

    if (args.flag("--save-text-lockfile")) {
        cli.save_text_lockfile = true;
    }

    if (args.option("--minimum-release-age")) |min_age_secs| {
        const secs = std.fmt.parseFloat(f64, min_age_secs) catch {
            Output.errGeneric("Expected --minimum-release-age to be a positive number: {s}", .{min_age_secs});
            Global.crash();
        };
        if (secs < 0) {
            Output.errGeneric("Expected --minimum-release-age to be a positive number: {s}", .{min_age_secs});
            Global.crash();
        }
        cli.minimum_release_age_ms = secs * std.time.ms_per_s;
    }

    const omit_values = args.options("--omit");

    if (omit_values.len > 0) {
        var omit: Omit = .{};
        for (omit_values) |omit_value| {
            if (strings.eqlComptime(omit_value, "dev")) {
                omit.dev = true;
            } else if (strings.eqlComptime(omit_value, "optional")) {
                omit.optional = true;
            } else if (strings.eqlComptime(omit_value, "peer")) {
                omit.peer = true;
            } else {
                Output.errGeneric("invalid `omit` value: '{s}'", .{omit_value});
                Global.crash();
            }
        }
        cli.omit = omit;
    }

    // commands that support --filter
    if (comptime subcommand.supportsWorkspaceFiltering()) {
        cli.filters = args.options("--filter");
    }

    if (comptime subcommand.supportsJsonOutput()) {
        cli.json_output = args.flag("--json");
    }

    if (comptime subcommand == .outdated) {
        // fake --dry-run, we don't actually resolve+clean the lockfile
        cli.dry_run = true;
        cli.recursive = args.flag("--recursive");
        // cli.json_output = args.flag("--json");
    }

    if (comptime subcommand == .pack or subcommand == .pm or subcommand == .publish) {
        if (comptime subcommand != .publish) {
            if (args.option("--destination")) |dest| {
                cli.pack_destination = dest;
            }
            if (args.option("--filename")) |file| {
                cli.pack_filename = file;
            }
        }

        if (args.option("--gzip-level")) |level| {
            cli.pack_gzip_level = level;
        }
    }

    if (comptime subcommand == .publish) {
        if (args.option("--tag")) |tag| {
            cli.publish_config.tag = tag;
        }

        if (args.option("--access")) |access| {
            cli.publish_config.access = Options.Access.fromStr(access) orelse {
                Output.errGeneric("invalid `access` value: '{s}'", .{access});
                Global.crash();
            };
        }

        if (args.option("--otp")) |otp| {
            cli.publish_config.otp = otp;
        }

        if (args.option("--auth-type")) |auth_type| {
            cli.publish_config.auth_type = Options.AuthType.fromStr(auth_type) orelse {
                Output.errGeneric("invalid `auth-type` value: '{s}'", .{auth_type});
                Global.crash();
            };
        }

        cli.tolerate_republish = args.flag("--tolerate-republish");
    }

    // link and unlink default to not saving, all others default to
    // saving.
    if (comptime subcommand == .link or subcommand == .unlink) {
        cli.no_save = !args.flag("--save");
    } else {
        cli.no_save = args.flag("--no-save");
    }

    if (subcommand == .patch) {
        const patch_commit = args.flag("--commit");
        if (patch_commit) {
            cli.patch = .{
                .commit = .{
                    .patches_dir = args.option("--patches-dir") orelse "patches",
                },
            };
        } else {
            cli.patch = .{
                .patch = .{},
            };
        }
    }
    if (subcommand == .@"patch-commit") {
        cli.patch = .{
            .commit = .{
                .patches_dir = args.option("--patches-dir") orelse "patches",
            },
        };
    }

    if (comptime subcommand == .audit) {
        if (args.option("--audit-level")) |level| {
            cli.audit_level = AuditLevel.fromString(level) orelse {
                Output.errGeneric("invalid `--audit-level` value: '{s}'. Valid values are: low, moderate, high, critical", .{level});
                Global.crash();
            };
        }

        cli.audit_ignore_list = args.options("--ignore");
    }

    if (args.option("--config")) |opt| {
        cli.config = opt;
    }

    // Parse multiple --cpu flags and combine them using Negatable
    const cpu_values = args.options("--cpu");
    if (cpu_values.len > 0) {
        var cpu_negatable = Npm.Architecture.none.negatable();
        for (cpu_values) |cpu_str| {
            // apply() already handles "any" as wildcard and negation with !
            cpu_negatable.apply(cpu_str);

            // Support * as an alias for "any"
            if (strings.eqlComptime(cpu_str, "*")) {
                cpu_negatable.had_wildcard = true;
                cpu_negatable.had_unrecognized_values = false;
            } else if (cpu_negatable.had_unrecognized_values and
                !strings.eqlComptime(cpu_str, "any") and
                !strings.eqlComptime(cpu_str, "none"))
            {
                // Only error for truly unrecognized values (not "any" or "none")
                Output.errGeneric("Invalid CPU architecture: '{s}'. Valid values are: *, any, arm, arm64, ia32, mips, mipsel, ppc, ppc64, s390, s390x, x32, x64. Use !name to negate.", .{cpu_str});
                Global.crash();
            }
        }
        cli.cpu = cpu_negatable.combine();
    }

    // Parse multiple --os flags and combine them using Negatable
    const os_values = args.options("--os");
    if (os_values.len > 0) {
        var os_negatable = Npm.OperatingSystem.none.negatable();
        for (os_values) |os_str| {
            // apply() already handles "any" as wildcard and negation with !
            os_negatable.apply(os_str);

            // Support * as an alias for "any"
            if (strings.eqlComptime(os_str, "*")) {
                os_negatable.had_wildcard = true;
                os_negatable.had_unrecognized_values = false;
            } else if (os_negatable.had_unrecognized_values and
                !strings.eqlComptime(os_str, "any") and
                !strings.eqlComptime(os_str, "none"))
            {
                // Only error for truly unrecognized values (not "any" or "none")
                Output.errGeneric("Invalid operating system: '{s}'. Valid values are: *, any, aix, darwin, freebsd, linux, openbsd, sunos, win32, android. Use !name to negate.", .{os_str});
                Global.crash();
            }
        }
        cli.os = os_negatable.combine();
    }

    if (comptime subcommand == .add or subcommand == .install) {
        cli.development = args.flag("--development") or args.flag("--dev");
        cli.optional = args.flag("--optional");
        cli.peer = args.flag("--peer");
        cli.exact = args.flag("--exact");
        cli.analyze = args.flag("--analyze");
        cli.only_missing = args.flag("--only-missing");
    }

    if (args.option("--concurrent-scripts")) |concurrency| {
        cli.concurrent_scripts = std.fmt.parseInt(usize, concurrency, 10) catch null;
    }

    if (args.option("--cwd")) |cwd_| {
        var buf: bun.PathBuffer = undefined;
        var buf2: bun.PathBuffer = undefined;
        var final_path: [:0]u8 = undefined;
        if (cwd_.len > 0 and cwd_[0] == '.') {
            const cwd = try bun.getcwd(&buf);
            var parts = [_]string{cwd_};
            const path_ = Path.joinAbsStringBuf(cwd, &buf2, &parts, .auto);
            buf2[path_.len] = 0;
            final_path = buf2[0..path_.len :0];
        } else {
            bun.copy(u8, &buf, cwd_);
            buf[cwd_.len] = 0;
            final_path = buf[0..cwd_.len :0];
        }
        bun.sys.chdir("", final_path).unwrap() catch |err| {
            Output.errGeneric("failed to change directory to \"{s}\": {s}\n", .{ final_path, @errorName(err) });
            Global.crash();
        };
    }

    if (comptime subcommand == .update) {
        cli.latest = args.flag("--latest");
        cli.interactive = args.flag("--interactive");
        cli.recursive = args.flag("--recursive");
    }

    const specified_backend: ?PackageInstall.Method = brk: {
        if (args.option("--backend")) |backend_| {
            break :brk PackageInstall.Method.map.get(backend_);
        }
        break :brk null;
    };

    if (specified_backend) |backend| {
        if (backend.isSupported()) {
            cli.backend = backend;
        }
    }

    if (args.option("--registry")) |registry| {
        if (!strings.hasPrefixComptime(registry, "https://") and !strings.hasPrefixComptime(registry, "http://")) {
            Output.errGeneric("Registry URL must start with 'https://' or 'http://': {f}\n", .{bun.fmt.quote(registry)});
            Global.crash();
        }
        cli.registry = registry;
    }

    if (subcommand == .patch and cli.positionals.len < 2) {
        Output.errGeneric("Missing pkg to patch\n", .{});
        Global.crash();
    }

    if (subcommand == .@"patch-commit" and cli.positionals.len < 2) {
        Output.errGeneric("Missing pkg folder to patch\n", .{});
        Global.crash();
    }

    if (cli.production and cli.trusted) {
        Output.errGeneric("The '--production' and '--trust' flags together are not supported because the --trust flag potentially modifies the lockfile after installing packages\n", .{});
        Global.crash();
    }

    if (cli.frozen_lockfile and cli.trusted) {
        Output.errGeneric("The '--frozen-lockfile' and '--trust' flags together are not supported because the --trust flag potentially modifies the lockfile after installing packages\n", .{});
        Global.crash();
    }

    if (cli.analyze and cli.positionals.len == 0) {
        Output.errGeneric("Missing script(s) to analyze. Pass paths to scripts to analyze their dependencies and add any missing ones to the lockfile.\n", .{});
        Global.crash();
    }

    if (comptime subcommand == .pm) {
        // `bun pm version` command options
        if (args.option("--git-tag-version")) |git_tag_version| {
            if (strings.eqlComptime(git_tag_version, "true")) {
                cli.git_tag_version = true;
            } else if (strings.eqlComptime(git_tag_version, "false")) {
                cli.git_tag_version = false;
            }
        } else if (args.flag("--no-git-tag-version")) {
            cli.git_tag_version = false;
        } else {
            cli.git_tag_version = true;
        }
        cli.allow_same_version = args.flag("--allow-same-version");
        if (args.option("--preid")) |preid| {
            cli.preid = preid;
        }
        if (args.option("--message")) |message| {
            cli.message = message;
        }
    }

    // `bun pm why` and `bun why` options
    if (comptime subcommand == .pm or subcommand == .why) {
        cli.top_only = args.flag("--top");
        if (args.option("--depth")) |depth| {
            cli.depth = std.fmt.parseInt(usize, depth, 10) catch {
                Output.errGeneric("invalid depth value: '{s}', must be a positive integer", .{depth});
                Global.exit(1);
            };
        }
    }

    return cli;
}

const string = []const u8;

const Npm = @import("../npm.zig");
const Options = @import("./PackageManagerOptions.zig");
const std = @import("std");
const PackageManagerCommand = @import("../../cli/package_manager_command.zig").PackageManagerCommand;

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const JSON = bun.json;
const Output = bun.Output;
const Path = bun.path;
const URL = bun.URL;
const clap = bun.clap;
const strings = bun.strings;
const PackageInstall = bun.install.PackageInstall;
const Subcommand = bun.install.PackageManager.Subcommand;
