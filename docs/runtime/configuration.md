There are two primary mechanisms for configuring the behavior of Bun.

- environment variables
- `bunfig.toml`: Bun's configuration file

Configuring with `bunfig.toml` is optional. Bun aims to be zero-configuration out of the box, but is also highly configurable for advanced use cases. Your `bunfig.toml` should live in your project root alongside `package.json`.

You can also create a global configuration file at the following paths:

- `$HOME/.bunfig.toml`
- `$XDG_CONFIG_HOME/.bunfig.toml`

If both a global and local `bunfig` are detected, the results are shallow-merged, with local overridding global. CLI flags will override `bunfig` setting where applicable.

## Environment variables

<!-- - `GOMAXPROCS`: For `bun bun`, this sets the maximum number of threads to use. If you’re experiencing an issue with `bun bun`, try setting `GOMAXPROCS=1` to force Bun to run single-threaded -->

- `DISABLE_BUN_ANALYTICS=1` this disables Bun's analytics. Bun records bundle timings (so we can answer with data, "is Bun getting faster?") and feature usage (e.g., "are people actually using macros?"). The request body size is about 60 bytes, so it’s not a lot of data
- `TMPDIR`: Bun occasionally requires a directory to store intermediate assets during bundling or other operations. If unset, `TMPDIR` defaults to the platform-specific temporary directory (on Linux, `/tmp` and on macOS `/private/tmp`).

## Configure `bun install`

Package management is a complex issue; to support a range of use cases, the behavior of `bun install` can be configured in [`bunfig.toml`](/docs/project/configuration).

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

```toml {% disabled %}
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

## Configure `bun dev`

Here is an example:

```toml
# Set a default framework to use
# By default, Bun will look for an npm package like `bun-framework-${framework}`, followed by `${framework}`
framework = "next"
logLevel = "debug"

# publicDir = "public"
# external = ["jquery"]

[macros]
# Remap any import like this:
#     import {graphql} from 'react-relay';
# To:
#     import {graphql} from 'macro:bun-macro-relay';
react-relay = { "graphql" = "bun-macro-relay" }

[bundle]
saveTo = "node_modules.bun"
# Don't need this if `framework` is set, but showing it here as an example anyway
entryPoints = ["./app/index.ts"]

[bundle.packages]
# If you're bundling packages that do not actually live in a `node_modules` folder or do not have the full package name in the file path, you can pass this to bundle them anyway
"@bigapp/design-system" = true

[dev]
# Change the default port from 3000 to 5000
# Also inherited by Bun.serve
port = 5000

[define]
# Replace any usage of "process.env.bagel" with the string `lox`.
# The values are parsed as JSON, except single-quoted strings are supported and `'undefined'` becomes `undefined` in JS.
# This will probably change in a future release to be just regular TOML instead. It is a holdover from the CLI argument parsing.
"process.env.bagel" = "'lox'"

[loaders]
# When loading a .bagel file, run the JS parser
".bagel" = "js"

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
# - "atom"
# If you pass it a file path, it will open with the file path instead
# It will recognize non-GUI editors, but I don't think it will work yet
```
