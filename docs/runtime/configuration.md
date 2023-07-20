There are two primary mechanisms for configuring the behavior of Bun.

- environment variables
- `bunfig.toml`: Bun's configuration file

Configuring with `bunfig.toml` is optional. Bun aims to be zero-configuration out of the box, but is also highly configurable for advanced use cases. Your `bunfig.toml` should live in your project root alongside `package.json`.

You can also create a global configuration file at the following paths:

- `$HOME/.bunfig.toml`
- `$XDG_CONFIG_HOME/.bunfig.toml`

If both a global and local `bunfig` are detected, the results are shallow-merged, with local overridding global. CLI flags will override `bunfig` setting where applicable.

## Runtime

```toml
# scripts to run before `bun run`ning a file or script
# useful for registering plugins
preload = ["./preload.ts"]

# equivalent to corresponding tsconfig compilerOptions
jsx = "react"
jsxFactory = "h"
jsxFragment = "Fragment"
jsxImportSource = "react"

# Reduce memory usage at the cost of performance
smol = true

# Set Bun's log level
logLevel = "debug" # "debug", "warn", "error"

[define]
# Replace any usage of "process.env.bagel" with the string `lox`.
# The values are parsed as JSON, except single-quoted strings are supported and `'undefined'` becomes `undefined` in JS.
# This will probably change in a future release to be just regular TOML instead. It is a holdover from the CLI argument parsing.
"process.env.bagel" = "'lox'"

[loaders]
# When loading a .bagel file, run the JS parser
".bagel" = "js"
```

## Test runner

```toml
[test]
# Scripts to run before all test files
preload = ["./setup.ts"]

# Reduce memory usage at the cost of performance
smol = true
```

## Package manager

Package management is a complex issue; to support a range of use cases, the behavior of `bun install` can be configured in [`bunfig.toml`](/docs/runtime/configuration).

### Default flags

The following settings modify the core behavior of Bun's package management commands. **The default values are shown below.**

```toml
[install]

# whether to install optionalDependencies
optional = true

# whether to install devDependencies
dev = true

# whether to install peerDependencies
peer = false

# equivalent to `--production` flag
production = false

# equivalent to `--frozen-lockfile` flag
frozenLockfile = false

# equivalent to `--dry-run` flag
dryRun = false
```

### Private scopes and registries

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

To configure scoped registries:

```toml
[install.scopes]
# registry as string
myorg1 = "https://username:password@registry.myorg.com/"

# registry with username/password
# you can reference environment variables
myorg12 = { username = "myusername", password = "$NPM_PASS", url = "https://registry.myorg.com/" }

# registry with token
myorg3 = { token = "$npm_token", url = "https://registry.myorg.com/" }
```

### Cache

To configure caching behavior:

```toml
[install]
# where `bun install --global` installs packages
globalDir = "~/.bun/install/global"

# where globally-installed package bins are linked
globalBinDir = "~/.bun/bin"

[install.cache]
# the directory to use for the cache
dir = "~/.bun/install/cache"

# when true, don't load from the global cache.
# Bun may still write to node_modules/.cache
disable = false

# when true, always resolve the latest versions from the registry
disableManifest = false
```

### Lockfile

To configure lockfile behavior:

```toml
[install.lockfile]

# path to read bun.lockb from
path = "bun.lockb"

# path to save bun.lockb to
savePath = "bun.lockb"

# whether to save the lockfile to disk
save = true

# whether to save a non-Bun lockfile alongside bun.lockb
# only "yarn" is supported
print = "yarn"
```

### Debugging

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

## Environment variables

These environment variables are checked by Bun to detect functionality and toggle features.

{% table %}

- Name
- Description

---

- `TMPDIR`
- Bun occasionally requires a directory to store intermediate assets during bundling or other operations. If unset, defaults to the platform-specific temporary directory: `/tmp` on Linux, `/private/tmp` on macOS.

---

- `NO_COLOR`
- If `NO_COLOR=1`, then ANSI color output is [disabled](https://no-color.org/).

---

- `FORCE_COLOR`
- If `FORCE_COLOR=1`, then ANSI color output is force enabled, even if `NO_COLOR` is set.

---

- `DO_NOT_TRACK`
- If `DO_NOT_TRACK=1`, then analytics are [disabled](https://do-not-track.dev/). Bun records bundle timings (so we can answer with data, "is Bun getting faster?") and feature usage (e.g., "are people actually using macros?"). The request body size is about 60 bytes, so it's not a lot of data.

{% /table %}
