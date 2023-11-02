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

Configure how Bun maps file extensions to loaders. This is useful for loading files that aren't natively supported by Bun. If

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
- Check local `node_modules` first, the auto-install any packages that aren't found. You can enable this from the CLI with `bun -i`.

{% /table %}

### `install.frozenLockfile`

When true, `bun install` will not update `bun.lockb`. Default `false`. If `package.json` and the existing `bun.lockb` are not in agreement, this will error.

```toml
[install]
frozenLockfile = false
```

### `install.dryRun`

Whether to install optional dependencies. Default `false`. When true, it's equivalent to setting `--dry-run` on all `bun install` commands.

```toml
[install]
dryRun = false
```

### `install.globalDir`

To configure the directory where Bun puts globally installed packages.

```toml
[install]
# where `bun install --global` installs packages
globalDir = "~/.bun/install/global"
```

### `install.globalBinDir`

To configure the directory where Bun installs globally installed binaries and CLIs.

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

Whether to generate a non-Bun lockfile alongside `bun.lockb`. (A `bun.lockb` will always be created.) Currently `"yarn"` is the only supported value.

```toml
[install.lockfile]
print = "yarn"
```

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
``` -->
