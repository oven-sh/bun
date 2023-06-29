The `bun` CLI contains a Node.js-compatible package manager designed to be a dramatically faster replacement for `npm`, `yarn`, and `pnpm`. It's a standalone tool that will work in pre-existing Node.js projects; if your project has a `package.json`, `bun install` can help you speed up your workflow.

{% callout %}

**⚡️ 25x faster** — Switch from `npm install` to `bun install` in any Node.js project to make your installations up to 25x faster.

{% image src="https://user-images.githubusercontent.com/709451/147004342-571b6123-17a9-49a2-8bfd-dcfc5204047e.png" height="200" /%}

{% /callout %}

{% details summary="For Linux users" %}
The minimum Linux Kernel version is 5.1. If you're on Linux kernel 5.1 - 5.5, `bun install` should still work, but HTTP requests will be slow due to a lack of support for io_uring's `connect()` operation.

If you're using Ubuntu 20.04, here's how to install a [newer kernel](https://wiki.ubuntu.com/Kernel/LTSEnablementStack):

```bash
# If this returns a version >= 5.6, you don't need to do anything
uname -r

# Install the official Ubuntu hardware enablement kernel
sudo apt install --install-recommends linux-generic-hwe-20.04
```

{% /details %}

## Manage dependencies

### `bun install`

To install all dependencies of a project:

```bash
$ bun install
```

On Linux, `bun install` tends to install packages 20-100x faster than `npm install`. On macOS, it's more like 4-80x.

![package install benchmark](https://user-images.githubusercontent.com/709451/147004342-571b6123-17a9-49a2-8bfd-dcfc5204047e.png)

Running `bun install` will:

- **Install** all `dependencies`, `devDependencies`, and `optionalDependencies`. Bun does not install `peerDependencies` by default.
- **Run** your project's `{pre|post}install` scripts at the appropriate time. For security reasons Bun _does not execute_ lifecycle scripts of installed dependencies.
- **Write** a `bun.lockb` lockfile to the project root.

To install in production mode (i.e. without `devDependencies`):

```bash
$ bun install --production
```

To install dependencies without allowing changes to lockfile (useful on CI):

```bash
$ bun install --frozen-lockfile
```

To perform a dry run (i.e. don't actually install anything):

```bash
$ bun install --dry-run
```

To modify logging verbosity:

```bash
$ bun install --verbose # debug logging
$ bun install --silent  # no logging
```

{% details summary="Configuring behavior" %}
The default behavior of `bun install` can be configured in `bun.toml`:

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

{% /details %}

### `bun add`

To add a particular package:

```bash
$ bun add preact
```

To specify a version, version range, or tag:

```bash
$ bun add zod@3.20.0
$ bun add zod@^3.0.0
$ bun add zod@latest
```

To add a package as a dev dependency (`"devDependencies"`):

```bash
$ bun add --development @types/react
$ bun add -d @types/react
```

To add a package as an optional dependency (`"optionalDependencies"`):

```bash
$ bun add --optional lodash
```

To install a package globally:

```bash
$ bun add --global cowsay # or `bun add -g cowsay`
$ cowsay "Bun!"
 ______
< Bun! >
 ------
        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||
```

{% details summary="Configuring global installation behavior" %}

```toml
[install]
# where `bun install --global` installs packages
globalDir = "~/.bun/install/global"

# where globally-installed package bins are linked
globalBinDir = "~/.bun/bin"
```

{% /details %}
To view a complete list of options for a given command:

```bash
$ bun add --help
```

### `bun remove`

To remove a dependency:

```bash
$ bun remove preact
```

## Local packages (`bun link`)

Use `bun link` in a local directory to register the current package as a "linkable" package.

```bash
$ cd /path/to/cool-pkg
$ cat package.json
{
  "name": "cool-pkg",
  "version": "1.0.0"
}
$ bun link
bun link v0.5.7 (7416672e)
Success! Registered "cool-pkg"

To use cool-pkg in a project, run:
  bun link cool-pkg

Or add it in dependencies in your package.json file:
  "cool-pkg": "link:cool-pkg"
```

This package can now be "linked" into other projects using `bun link cool-pkg`. This will create a symlink in the `node_modules` directory of the target project, pointing to the local directory.

```bash
$ cd /path/to/my-app
$ bun link cool-pkg
```

In addition, the `--save` flag can be used to add `cool-pkg` to the `dependencies` field of your app's package.json with a special version specifier that tells Bun to load from the registered local directory instead of installing from `npm`:

```json-diff
  {
    "name": "my-app",
    "version": "1.0.0",
    "dependencies": {
+     "cool-pkg": "link:cool-pkg"
    }
  }
```

## Trusted dependencies

Unlike other npm clients, Bun does not execute arbitrary lifecycle scripts for installed dependencies, such as `postinstall`. These scripts represent a potential security risk, as they can execute arbitrary code on your machine.

<!-- Bun maintains an allow-list of popular packages containing `postinstall` scripts that are known to be safe. To run lifecycle scripts for packages that aren't on this list, add the package to `trustedDependencies` in your package.json. -->

To tell Bun to allow lifecycle scripts for a particular package, add the package to `trustedDependencies` in your package.json.

```json-diff
  {
    "name": "my-app",
    "version": "1.0.0",
+   "trustedDependencies": {
+     "my-trusted-package": "*"
+   }
  }
```

Bun reads this field and will run lifecycle scripts for `my-trusted-package`. If you specify a version range, Bun will only execute lifecycle scripts if the resolved package version matches the range.

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "trustedDependencies": {
    "my-trusted-package": "^1.0.0"
  }
}
```

## Git dependencies

To add a dependency from a git repository:

```bash
$ bun install git@github.com:moment/moment.git
```

Bun supports a variety of protocols, including [`github`](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#github-urls), [`git`](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#git-urls-as-dependencies), `git+ssh`, `git+https`, and many more.

```json
{
  "dependencies": {
    "dayjs": "git+https://github.com/iamkun/dayjs.git",
    "lodash": "git+ssh://github.com/lodash/lodash.git#4.17.21",
    "moment": "git@github.com:moment/moment.git",
    "zod": "github:colinhacks/zod"
  }
}
```

## Tarball dependencies

A package name can correspond to a publically hosted `.tgz` file. During `bun install`, Bun will download and install the package from the specified tarball URL, rather than from the package registry.

```json#package.json
{
  "dependencies": {
    "zod": "https://registry.npmjs.org/zod/-/zod-3.21.4.tgz"
  }
}
```

## CI/CD

Looking to speed up your CI? Use the official `oven-sh/setup-bun` action to install `bun` in a GitHub Actions pipeline.

```yaml#.github/workflows/release.yml
name: bun-types
jobs:
  build:
    name: build-app
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v3
      - name: Install bun
        uses: oven-sh/setup-bun@v1
      - name: Install dependencies
        run: bun install
      - name: Build app
        run: bun run build
```
