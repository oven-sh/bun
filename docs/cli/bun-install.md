### `bun install`

bun install is a fast package manager & npm client.

bun install can be configured via `bunfig.toml`, environment variables, and CLI flags.

#### Configuring `bun install` with `bunfig.toml`

`bunfig.toml` is searched for in the following paths on `bun install`, `bun remove`, and `bun add`:

1. `$XDG_CONFIG_HOME/.bunfig.toml` or `$HOME/.bunfig.toml`
2. `./bunfig.toml`

If both are found, the results are merged together.

Configuring with `bunfig.toml` is optional. Bun tries to be zero configuration in general, but that's not always possible.

```toml
# Using scoped packages with bun install
[install.scopes]

# Scope name      The value can be a URL string or an object
"@mybigcompany" = { token = "123456", url = "https://registry.mybigcompany.com" }
# URL is optional and falls back to the default registry

# The "@" in the scope is optional
mybigcompany2 = { token = "123456" }

# Environment variables can be referenced as a string that starts with $ and it will be replaced
mybigcompany3 = { token = "$npm_config_token" }

# Setting username and password turns it into a Basic Auth header by taking base64("username:password")
mybigcompany4 = { username = "myusername", password = "$npm_config_password", url = "https://registry.yarnpkg.com/" }
# You can set username and password in the registry URL. This is the same as above.
mybigcompany5 = "https://username:password@registry.yarnpkg.com/"

# You can set a token for a registry URL:
mybigcompany6 = "https://:$NPM_CONFIG_TOKEN@registry.yarnpkg.com/"

[install]
# Default registry
# can be a URL string or an object
registry = "https://registry.yarnpkg.com/"
# as an object
#registry = { url = "https://registry.yarnpkg.com/", token = "123456" }

# Install for production? This is the equivalent to the "--production" CLI argument
production = false

# Save a text-based lockfile? This is equivalent to the "--save-text-lockfile" CLI argument
saveTextLockfile = false

# Disallow changes to lockfile? This is the equivalent to the "--frozen-lockfile" CLI argument
frozenLockfile = false

# Don't actually install
dryRun = true

# Install optionalDependencies (default: true)
# Setting this to false is equivalent to the `--omit=optional` CLI argument
optional = true

# Install local devDependencies (default: true)
# Setting this to false is equivalent to the `--omit=dev` CLI argument
dev = true

# Install peerDependencies (default: true)
# Setting this to false is equivalent to the `--omit=peer` CLI argument
peer = true

# Max number of concurrent lifecycle scripts (default: (cpu count or GOMAXPROCS) x2)
concurrentScripts = 16

# When using `bun install -g`, install packages here
globalDir = "~/.bun/install/global"

# When using `bun install -g`, link package bins here
globalBinDir = "~/.bun/bin"

# cache-related configuration
[install.cache]
# The directory to use for the cache
dir = "~/.bun/install/cache"

# Don't load from the global cache.
# Note: Bun may still write to node_modules/.cache
disable = false


# Always resolve the latest versions from the registry
disableManifest = false


# Lockfile-related configuration
[install.lockfile]

# Print a yarn v1 lockfile
# Note: it does not load the lockfile, it just converts bun.lock into a yarn.lock
print = "yarn"

# Save the lockfile to disk
save = true

```

If it's easier to read as TypeScript types:

```ts
export interface Root {
  install: Install;
}

export interface Install {
  scopes: Scopes;
  registry: Registry;
  production: boolean;
  saveTextLockfile: boolean;
  frozenLockfile: boolean;
  dryRun: boolean;
  optional: boolean;
  dev: boolean;
  peer: boolean;
  globalDir: string;
  globalBinDir: string;
  cache: Cache;
  lockfile: Lockfile;
  logLevel: "debug" | "error" | "warn";
}

type Registry =
  | string
  | {
      url?: string;
      token?: string;
      username?: string;
      password?: string;
    };

type Scopes = Record<string, Registry>;

export interface Cache {
  dir: string;
  disable: boolean;
  disableManifest: boolean;
}

export interface Lockfile {
  print?: "yarn";
  save: boolean;
}
```

## Configuring with environment variables

Environment variables have a higher priority than `bunfig.toml`.

| Name                             | Description                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| BUN_CONFIG_REGISTRY              | Set an npm registry (default: <https://registry.npmjs.org>)   |
| BUN_CONFIG_TOKEN                 | Set an auth token (currently does nothing)                    |
| BUN_CONFIG_YARN_LOCKFILE         | Save a Yarn v1-style yarn.lock                                |
| BUN_CONFIG_LINK_NATIVE_BINS      | Point `bin` in package.json to a platform-specific dependency |
| BUN_CONFIG_SKIP_SAVE_LOCKFILE    | Don’t save a lockfile                                         |
| BUN_CONFIG_SKIP_LOAD_LOCKFILE    | Don’t load a lockfile                                         |
| BUN_CONFIG_SKIP_INSTALL_PACKAGES | Don’t install any packages                                    |

Bun always tries to use the fastest available installation method for the target platform. On macOS, that’s `clonefile` and on Linux, that’s `hardlink`. You can change which installation method is used with the `--backend` flag. When unavailable or on error, `clonefile` and `hardlink` fallsback to a platform-specific implementation of copying files.

Bun stores installed packages from npm in `~/.bun/install/cache/${name}@${version}`. Note that if the semver version has a `build` or a `pre` tag, it is replaced with a hash of that value instead. This is to reduce the chances of errors from long file paths, but unfortunately complicates figuring out where a package was installed on disk.

When the `node_modules` folder exists, before installing, Bun checks if the `"name"` and `"version"` in `package/package.json` in the expected node_modules folder matches the expected `name` and `version`. This is how it determines whether it should install. It uses a custom JSON parser which stops parsing as soon as it finds `"name"` and `"version"`.

When a `bun.lock` doesn’t exist or `package.json` has changed dependencies, tarballs are downloaded & extracted eagerly while resolving.

When a `bun.lock` exists and `package.json` hasn’t changed, Bun downloads missing dependencies lazily. If the package with a matching `name` & `version` already exists in the expected location within `node_modules`, Bun won’t attempt to download the tarball.

## Platform-specific dependencies?

bun stores normalized `cpu` and `os` values from npm in the lockfile, along with the resolved packages. It skips downloading, extracting, and installing packages disabled for the current target at runtime. This means the lockfile won't change between platforms/architectures even if the packages ultimately installed do change.

### `--cpu` and `--os` flags

You can override the target platform for package selection:

```bash
bun install --cpu=x64 --os=linux
```

This installs packages for the specified platform instead of the current system. Useful for cross-platform builds or when preparing deployments for different environments.

**Accepted values for `--cpu`**: `arm64`, `x64`, `ia32`, `ppc64`, `s390x`

**Accepted values for `--os`**: `linux`, `darwin`, `win32`, `freebsd`, `openbsd`, `sunos`, `aix`

## Peer dependencies?

Peer dependencies are handled similarly to yarn. `bun install` will automatically install peer dependencies. If the dependency is marked optional in `peerDependenciesMeta`, an existing dependency will be chosen if possible.

## Lockfile

`bun.lock` is Bun’s lockfile format. See [our blogpost about the text lockfile](https://bun.com/blog/bun-lock-text-lockfile).

Prior to Bun 1.2, the lockfile was binary and called `bun.lockb`. Old lockfiles can be upgraded to the new format by running `bun install --save-text-lockfile --frozen-lockfile --lockfile-only`, and then deleting `bun.lockb`.

## Cache

To delete the cache:

```bash
$ rm -rf ~/.bun/install/cache
```

## Platform-specific backends

`bun install` uses different system calls to install dependencies depending on the platform. This is a performance optimization. You can force a specific backend with the `--backend` flag.

**`hardlink`** is the default backend on Linux. Benchmarking showed it to be the fastest on Linux.

```bash
$ rm -rf node_modules
$ bun install --backend hardlink
```

**`clonefile`** is the default backend on macOS. Benchmarking showed it to be the fastest on macOS. It is only available on macOS.

```bash
$ rm -rf node_modules
$ bun install --backend clonefile
```

**`clonefile_each_dir`** is similar to `clonefile`, except it clones each file individually per directory. It is only available on macOS and tends to perform slower than `clonefile`. Unlike `clonefile`, this does not recursively clone subdirectories in one system call.

```bash
$ rm -rf node_modules
$ bun install --backend clonefile_each_dir
```

**`copyfile`** is the fallback used when any of the above fail, and is the slowest. on macOS, it uses `fcopyfile()` and on linux it uses `copy_file_range()`.

```bash
$ rm -rf node_modules
$ bun install --backend copyfile
```

**`symlink`** is typically only used for `file:` dependencies (and eventually `link:`) internally. To prevent infinite loops, it skips symlinking the `node_modules` folder.

If you install with `--backend=symlink`, Node.js won't resolve node_modules of dependencies unless each dependency has its own node_modules folder or you pass `--preserve-symlinks` to `node` or `bun`. See [Node.js documentation on `--preserve-symlinks`](https://nodejs.org/api/cli.html#--preserve-symlinks).

```bash
$ rm -rf node_modules
$ bun install --backend symlink
$ bun --preserve-symlinks ./my-file.js
$ node --preserve-symlinks ./my-file.js # https://nodejs.org/api/cli.html#--preserve-symlinks
```

## npm registry metadata

bun uses a binary format for caching NPM registry responses. This loads much faster than JSON and tends to be smaller on disk.
You will see these files in `~/.bun/install/cache/*.npm`. The filename pattern is `${hash(packageName)}.npm`. It’s a hash so that extra directories don’t need to be created for scoped packages.

Bun's usage of `Cache-Control` ignores `Age`. This improves performance, but means bun may be about 5 minutes out of date to receive the latest package version metadata from npm.

## pnpm migration

Bun automatically migrates projects from pnpm to bun. When a `pnpm-lock.yaml` file is detected and no `bun.lock` file exists, Bun will automatically migrate the lockfile to `bun.lock` during installation. The original `pnpm-lock.yaml` file remains unmodified.

```bash
bun install
```

**Note**: Migration only runs when `bun.lock` is absent. There is currently no opt-out flag for pnpm migration.

The migration process handles:

### Lockfile Migration

- Converts `pnpm-lock.yaml` to `bun.lock` format
- Preserves package versions and resolution information
- Maintains dependency relationships and peer dependencies
- Handles patched dependencies with integrity hashes

### Workspace Configuration

When a `pnpm-workspace.yaml` file exists, Bun migrates workspace settings to your root `package.json`:

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  react: ^18.0.0
  typescript: ^5.0.0

catalogs:
  build:
    webpack: ^5.0.0
    babel: ^7.0.0
```

The workspace packages list and catalogs are moved to the `workspaces` field in `package.json`:

```json
{
  "workspaces": {
    "packages": ["apps/*", "packages/*"],
    "catalog": {
      "react": "^18.0.0",
      "typescript": "^5.0.0"
    },
    "catalogs": {
      "build": {
        "webpack": "^5.0.0",
        "babel": "^7.0.0"
      }
    }
  }
}
```

### Catalog Dependencies

Dependencies using pnpm's `catalog:` protocol are preserved:

```json
{
  "dependencies": {
    "react": "catalog:",
    "webpack": "catalog:build"
  }
}
```

### Configuration Migration

The following pnpm configuration is migrated from both `pnpm-lock.yaml` and `pnpm-workspace.yaml`:

- **Overrides**: Moved from `pnpm.overrides` to root-level `overrides` in `package.json`
- **Patched Dependencies**: Moved from `pnpm.patchedDependencies` to root-level `patchedDependencies` in `package.json`
- **Workspace Overrides**: Applied from `pnpm-workspace.yaml` to root `package.json`

### Requirements

- Requires pnpm lockfile version 7 or higher
- Workspace packages must have a `name` field in their `package.json`
- All catalog entries referenced by dependencies must exist in the catalogs definition

After migration, you can safely remove `pnpm-lock.yaml` and `pnpm-workspace.yaml` files.
