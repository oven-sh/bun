Bun's behavior can be configured using its configuration file, `bunfig.toml`.

In general, Bun relies on pre-existing configuration files like `package.json` and `tsconfig.json` to configure its behavior. `bunfig.toml` is only necessary for configuring Bun-specific things. This file is optional, and Bun will work out of the box without it.

## Global vs. local

In general, it's recommended to add a `bunfig.toml` file to your project root, alongside your `package.json`.

To configure Bun globally, you can also create a `.bunfig.toml` file at one of the following paths:

- `$HOME/.bunfig.toml`
- `$XDG_CONFIG_HOME/.bunfig.toml`

If both a global and local `bunfig` are detected, the results are shallow-merged, with local overriding global. CLI flags will override `bunfig` setting where applicable.

## Runtime

Bun's runtime behavior is configured using top-level fields in the `bunfig.toml` file.

### `preload`

An array of scripts/plugins to execute before running a file or script.

```toml
# scripts to run before `bun run`-ing a file or script
# register plugins by adding them to this list
preload = ["./preload.ts"]
```

### `jsx`

Configure how Bun handles JSX. You can also set these fields in the `compilerOptions` of your `tsconfig.json`, but they are supported here as well for non-TypeScript projects.

```toml
jsx = "react"
jsxFactory = "h"
jsxFragment = "Fragment"
jsxImportSource = "react"
```

Refer to the tsconfig docs for more information on these fields.

- [jsx](https://www.typescriptlang.org/tsconfig#jsx)
- [jsxFactory](https://www.typescriptlang.org/tsconfig#jsxFactory)
- [jsxFragment](https://www.typescriptlang.org/tsconfig#jsxFragment)
- [jsxImportSource](https://www.typescriptlang.org/tsconfig#jsxImportSource)

### `smol`

Enable `smol` mode. This reduces memory usage at the cost of performance.

```toml
# Reduce memory usage at the cost of performance
smol = true
```

### `logLevel`

Set the log level. This can be one of `"debug"`, `"warn"`, or `"error"`.

```toml
logLevel = "debug" # "debug" | "warn" | "error"
```

### `define`

The `define` field allows you to replace certain global identifiers with constant expressions. Bun will replace any usage of the identifier with the expression. The expression should be a JSON string.

```toml
[define]
# Replace any usage of "process.env.bagel" with the string `lox`.
# The values are parsed as JSON, except single-quoted strings are supported and `'undefined'` becomes `undefined` in JS.
# This will probably change in a future release to be just regular TOML instead. It is a holdover from the CLI argument parsing.
"process.env.bagel" = "'lox'"
```

### `loader`

Configure how Bun maps file extensions to loaders. This is useful for loading files that aren't natively supported by Bun.

```toml
[loader]
# when a .bagel file is imported, treat it like a tsx file
".bagel" = "tsx"
```

Bun supports the following loaders:

- `jsx`
- `js`
- `ts`
- `tsx`
- `css`
- `file`
- `json`
- `toml`
- `yaml`
- `wasm`
- `napi`
- `base64`
- `dataurl`
- `text`

### `telemetry`

The `telemetry` field permit to enable/disable the analytics records. Bun records bundle timings (so we can answer with data, "is Bun getting faster?") and feature usage (e.g., "are people actually using macros?"). The request body size is about 60 bytes, so it's not a lot of data. By default the telemetry is enabled. Equivalent of `DO_NOT_TRACK` env variable.

```toml
telemetry = false
```

### `console`

Configure console output behavior.

#### `console.depth`

Set the default depth for `console.log()` object inspection. Default `2`.

```toml
[console]
depth = 3
```

This controls how deeply nested objects are displayed in console output. Higher values show more nested properties but may produce verbose output for complex objects. This setting can be overridden by the `--console-depth` CLI flag.

## Test runner

The test runner is configured under the `[test]` section of your bunfig.toml.

```toml
[test]
# configuration goes here
```

### `test.root`

The root directory to run tests from. Default `.`.

```toml
[test]
root = "./__tests__"
```

### `test.preload`

Same as the top-level `preload` field, but only applies to `bun test`.

```toml
[test]
preload = ["./setup.ts"]
```

### `test.smol`

Same as the top-level `smol` field, but only applies to `bun test`.

```toml
[test]
smol = true
```

### `test.coverage`

Enables coverage reporting. Default `false`. Use `--coverage` to override.

```toml
[test]
coverage = false
```

### `test.coverageThreshold`

To specify a coverage threshold. By default, no threshold is set. If your test suite does not meet or exceed this threshold, `bun test` will exit with a non-zero exit code to indicate the failure.

```toml
[test]

# to require 90% line-level and function-level coverage
coverageThreshold = 0.9
```

Different thresholds can be specified for line-wise, function-wise, and statement-wise coverage.

```toml
[test]
coverageThreshold = { line = 0.7, function = 0.8, statement = 0.9 }
```

### `test.coverageSkipTestFiles`

Whether to skip test files when computing coverage statistics. Default `false`.

```toml
[test]
coverageSkipTestFiles = false
```

### `test.coveragePathIgnorePatterns`

Exclude specific files or file patterns from coverage reports using glob patterns. Can be a single string pattern or an array of patterns.

```toml
[test]
# Single pattern
coveragePathIgnorePatterns = "**/*.spec.ts"

# Multiple patterns
coveragePathIgnorePatterns = [
  "**/*.spec.ts",
  "**/*.test.ts",
  "src/utils/**",
  "*.config.js"
]
```

### `test.coverageReporter`

By default, coverage reports will be printed to the console. For persistent code coverage reports in CI environments and for other tools use `lcov`.

```toml
[test]
coverageReporter  = ["text", "lcov"]  # default ["text"]
```

### `test.coverageDir`

Set path where coverage reports will be saved. Please notice, that it works only for persistent `coverageReporter` like `lcov`.

```toml
[test]
coverageDir = "path/to/somewhere"  # default "coverage"
```

### `test.concurrentTestGlob`

Specify a glob pattern to automatically run matching test files with concurrent test execution enabled. Test files matching this pattern will behave as if the `--concurrent` flag was passed, running all tests within those files concurrently.

```toml
[test]
concurrentTestGlob = "**/concurrent-*.test.ts"
```

This is useful for:

- Gradually migrating test suites to concurrent execution
- Running integration tests concurrently while keeping unit tests sequential
- Separating fast concurrent tests from tests that require sequential execution

The `--concurrent` CLI flag will override this setting when specified.

### `test.onlyFailures`

When enabled, only failed tests are displayed in the output. This helps reduce noise in large test suites by hiding passing tests. Default `false`.

```toml
[test]
onlyFailures = true
```

This is equivalent to using the `--only-failures` flag when running `bun test`.

### `test.reporter`

Configure the test reporter settings.

#### `test.reporter.dots`

Enable the dots reporter, which displays a compact output showing a dot for each test. Default `false`.

```toml
[test.reporter]
dots = true
```

#### `test.reporter.junit`

Enable JUnit XML reporting and specify the output file path.

```toml
[test.reporter]
junit = "test-results.xml"
```

This generates a JUnit XML report that can be consumed by CI systems and other tools.

### `test.randomize`

Run tests in random order. Default `false`.

```toml
[test]
randomize = true
```

This helps catch bugs related to test interdependencies by running tests in a different order each time. When combined with `seed`, the random order becomes reproducible.

The `--randomize` CLI flag will override this setting when specified.

### `test.seed`

Set the random seed for test randomization. This option requires `randomize` to be `true`.

```toml
[test]
randomize = true
seed = 2444615283
```

Using a seed makes the randomized test order reproducible across runs, which is useful for debugging flaky tests. When you encounter a test failure with randomization enabled, you can use the same seed to reproduce the exact test order.

The `--seed` CLI flag will override this setting when specified.

### `test.rerunEach`

Re-run each test file a specified number of times. Default `0` (run once).

```toml
[test]
rerunEach = 3
```

This is useful for catching flaky tests or non-deterministic behavior. Each test file will be executed the specified number of times.

The `--rerun-each` CLI flag will override this setting when specified.

## Package manager

Package management is a complex issue; to support a range of use cases, the behavior of `bun install` can be configured under the `[install]` section.

```toml
[install]
# configuration here
```

### `install.optional`

Whether to install optional dependencies. Default `true`.

```toml
[install]
optional = true
```

### `install.dev`

Whether to install development dependencies. Default `true`.

```toml
[install]
dev = true
```

### `install.peer`

Whether to install peer dependencies. Default `true`.

```toml
[install]
peer = true
```

### `install.production`

Whether `bun install` will run in "production mode". Default `false`.

In production mode, `"devDependencies"` are not installed. You can use `--production` in the CLI to override this setting.

```toml
[install]
production = false
```

### `install.exact`

Whether to set an exact version in `package.json`. Default `false`.

By default Bun uses caret ranges; if the `latest` version of a package is `2.4.1`, the version range in your `package.json` will be `^2.4.1`. This indicates that any version from `2.4.1` up to (but not including) `3.0.0` is acceptable.

```toml
[install]
exact = false
```

### `install.saveTextLockfile`

If false, generate a binary `bun.lockb` instead of a text-based `bun.lock` file when running `bun install` and no lockfile is present.

Default `true` (since Bun v1.2).

```toml
[install]
saveTextLockfile = false
```

<!--
### `install.prefer`

Whether the package manager should prefer offline or online dependency resolution. Default `"online"`.

```toml
[install]
prefer = "online"
```

Valid values are:

{% table %}

---

- `"online"`
- Prefer online resolution. This is the default. If a package is not found in the local cache, it will be downloaded from the registry.

---

- `"offline"`
- Prefer offline resolution. When possible, packages will be installed from the global cache. This minimizes the fraction of the time Bun will check for newer versions from the registry. If a package is not found in the global cache, it will be downloaded from the registry.

{% /table %} -->

### `install.auto`

To configure Bun's package auto-install behavior. Default `"auto"` — when no `node_modules` folder is found, Bun will automatically install dependencies on the fly during execution.

```toml
[install]
auto = "auto"
```

Valid values are:

{% table %}

- Value
- Description

---

- `"auto"`
- Resolve modules from local `node_modules` if it exists. Otherwise, auto-install dependencies on the fly.

---

- `"force"`
- Always auto-install dependencies, even if `node_modules` exists.

---

- `"disable"`
- Never auto-install dependencies.

---

- `"fallback"`
- Check local `node_modules` first, then auto-install any packages that aren't found. You can enable this from the CLI with `bun -i`.

{% /table %}

### `install.frozenLockfile`

When true, `bun install` will not update `bun.lock`. Default `false`. If `package.json` and the existing `bun.lock` are not in agreement, this will error.

```toml
[install]
frozenLockfile = false
```

### `install.dryRun`

Whether `bun install` will actually install dependencies. Default `false`. When true, it's equivalent to setting `--dry-run` on all `bun install` commands.

```toml
[install]
dryRun = false
```

### `install.globalDir`

To configure the directory where Bun puts globally installed packages.

Environment variable: `BUN_INSTALL_GLOBAL_DIR`

```toml
[install]
# where `bun install --global` installs packages
globalDir = "~/.bun/install/global"
```

### `install.globalBinDir`

To configure the directory where Bun installs globally installed binaries and CLIs.

Environment variable: `BUN_INSTALL_BIN`

```toml
# where globally-installed package bins are linked
globalBinDir = "~/.bun/bin"
```

### `install.registry`

The default registry is `https://registry.npmjs.org/`. This can be globally configured in `bunfig.toml`:

```toml
[install]
# set default registry as a string
registry = "https://registry.npmjs.org"
# set a token
registry = { url = "https://registry.npmjs.org", token = "123456" }
# set a username/password
registry = "https://username:password@registry.npmjs.org"
```

### `install.linkWorkspacePackages`

To configure how workspace packages are linked, use the `install.linkWorkspacePackages` option.

Whether to link workspace packages from the monorepo root to their respective `node_modules` directories. Default `true`.

```toml
[install]
linkWorkspacePackages = true
```

### `install.scopes`

To configure a registry for a particular scope (e.g. `@myorg/<package>`) use `install.scopes`. You can reference environment variables with `$variable` notation.

```toml
[install.scopes]
# registry as string
myorg = "https://username:password@registry.myorg.com/"

# registry with username/password
# you can reference environment variables
myorg = { username = "myusername", password = "$npm_password", url = "https://registry.myorg.com/" }

# registry with token
myorg = { token = "$npm_token", url = "https://registry.myorg.com/" }
```

### `install.ca` and `install.cafile`

To configure a CA certificate, use `install.ca` or `install.cafile` to specify a path to a CA certificate file.

```toml
[install]
# The CA certificate as a string
ca = "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"

# A path to a CA certificate file. The file can contain multiple certificates.
cafile = "path/to/cafile"
```

### `install.cache`

To configure the cache behavior:

```toml
[install.cache]

# the directory to use for the cache
dir = "~/.bun/install/cache"

# when true, don't load from the global cache.
# Bun may still write to node_modules/.cache
disable = false

# when true, always resolve the latest versions from the registry
disableManifest = false
```

### `install.lockfile`

To configure lockfile behavior, use the `install.lockfile` section.

Whether to generate a lockfile on `bun install`. Default `true`.

```toml
[install.lockfile]
save = true
```

Whether to generate a non-Bun lockfile alongside `bun.lock`. (A `bun.lock` will always be created.) Currently `"yarn"` is the only supported value.

```toml
[install.lockfile]
print = "yarn"
```

### `install.security.scanner`

Configure a security scanner to scan packages for vulnerabilities before installation.

First, install a security scanner from npm:

```bash
$ bun add -d @acme/bun-security-scanner
```

Then configure it in your `bunfig.toml`:

```toml
[install.security]
scanner = "@acme/bun-security-scanner"
```

When a security scanner is configured:

- Auto-install is automatically disabled for security
- Packages are scanned before installation
- Installation is cancelled if fatal issues are found
- Security warnings are displayed during installation

Learn more about [using and writing security scanners](/docs/install/security-scanner-api).

### `install.linker`

Configure the default linker strategy. Default `"hoisted"`.

For complete documentation refer to [Package manager > Isolated installs](https://bun.com/docs/install/isolated).

```toml
[install]
linker = "hoisted"
```

Valid values are:

{% table %}

- Value
- Description

---

- `"hoisted"`
- Link dependencies in a shared `node_modules` directory.

---

- `"isolated"`
- Link dependencies inside each package installation.

{% /table %}

### `install.minimumReleaseAge`

Configure a minimum age (in seconds) for npm package versions. Package versions published more recently than this threshold will be filtered out during installation. Default is `null` (disabled).

```toml
[install]
# Only install package versions published at least 3 days ago
minimumReleaseAge = 259200
# These packages will bypass the 3-day minimum age requirement
minimumReleaseAgeExcludes = ["@types/bun", "typescript"]
```

For more details see [Minimum release age](https://bun.com/docs/cli/install#minimum-release-age) in the install documentation.

<!-- ## Debugging -->

<!--
```toml
[debug]
# When navigating to a blob: or src: link, open the file in your editor
# If not, it tries $EDITOR or $VISUAL
# If that still fails, it will try Visual Studio Code, then Sublime Text, then a few others
# This is used by Bun.openInEditor()
editor = "code"

# List of editors:
# - "subl", "sublime"
# - "vscode", "code"
# - "textmate", "mate"
# - "idea"
# - "webstorm"
# - "nvim", "neovim"
# - "vim","vi"
# - "emacs"
```
-->

## `bun run`

The `bun run` command can be configured under the `[run]` section. These apply to the `bun run` command and the `bun` command when running a file or executable or script.

Currently, `bunfig.toml` is only automatically loaded for `bun run` in a local project (it doesn't check for a global `.bunfig.toml`).

### `run.shell` - use the system shell or Bun's shell

The shell to use when running package.json scripts via `bun run` or `bun`. On Windows, this defaults to `"bun"` and on other platforms it defaults to `"system"`.

To always use the system shell instead of Bun's shell (default behavior unless Windows):

```toml
[run]
# default outside of Windows
shell = "system"
```

To always use Bun's shell instead of the system shell:

```toml
[run]
# default on Windows
shell = "bun"
```

### `run.bun` - auto alias `node` to `bun`

When `true`, this prepends `$PATH` with a `node` symlink that points to the `bun` binary for all scripts or executables invoked by `bun run` or `bun`.

This means that if you have a script that runs `node`, it will actually run `bun` instead, without needing to change your script. This works recursively, so if your script runs another script that runs `node`, it will also run `bun` instead. This applies to shebangs as well, so if you have a script with a shebang that points to `node`, it will actually run `bun` instead.

By default, this is enabled if `node` is not already in your `$PATH`.

```toml
[run]
# equivalent to `bun --bun` for all `bun run` commands
bun = true
```

You can test this by running:

```sh
$ bun --bun which node # /path/to/bun
$ bun which node # /path/to/node
```

This option is equivalent to prefixing all `bun run` commands with `--bun`:

```sh
bun --bun run dev
bun --bun dev
bun run --bun dev
```

If set to `false`, this will disable the `node` symlink.

### `run.silent` - suppress reporting the command being run

When `true`, suppresses the output of the command being run by `bun run` or `bun`.

```toml
[run]
silent = true
```

Without this option, the command being run will be printed to the console:

```sh
$ bun run dev
> $ echo "Running \"dev\"..."
Running "dev"...
```

With this option, the command being run will not be printed to the console:

```sh
$ bun run dev
Running "dev"...
```

This is equivalent to passing `--silent` to all `bun run` commands:

```sh
bun --silent run dev
bun --silent dev
bun run --silent dev
```
