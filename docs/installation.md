Bun ships as a single executable that can be installed a few different ways.

{% callout %}
**Windows users** — Bun does not currently provide a native Windows build. We're working on this; progress can be tracked at [this issue](https://github.com/oven-sh/bun/issues/43). In the meantime, use one of the installation methods below for Windows Subsystem for Linux.

**Linux users** — The `unzip` package is required to install Bun. Kernel version 5.6 or higher is strongly recommended, but the minimum is 5.1.
{% /callout %}

{% codetabs %}

```bash#NPM
$ npm install -g bun # the last `npm` command you'll ever need
```

```bash#Native
$ curl -fsSL https://bun.sh/install | bash # for macOS, Linux, and WSL
```

```bash#Homebrew
$ brew tap oven-sh/bun # for macOS and Linux
$ brew install bun
```

```bash#Docker
$ docker pull oven/bun
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun
```

```bash#proto
$ proto install bun
```

```bash#asdf
# for macOS and Linux - add the bun plugin if not installed
# asdf lets you have multiple versions of bun installed
$ asdf plugin-add bun
# Install/use latest version
$ asdf install bun latest
$ asdf global bun latest
```

{% /codetabs %}

## Upgrading

Once installed, the binary can upgrade itself.

```sh
$ bun upgrade
```

{% callout %}
**Homebrew users** - To avoid conflicts with Homebrew, use `brew upgrade bun` instead.

**proto users** - Use `proto install bun --pin` instead.

**asdf users** - Use `asdf install bun latest` and `asdf global bun latest` instead.
{% /callout %}

Bun automatically releases an (untested) canary build on every commit to `main`. To upgrade to the latest canary build:

```sh
$ bun upgrade --canary
```

[View canary build](https://github.com/oven-sh/bun/releases/tag/canary)

<!--
## Native

Works on macOS x64 & Silicon, Linux x64, Windows Subsystem for Linux.

```sh
$ curl -fsSL https://bun.sh/install | bash
```

Once installed, the binary can upgrade itself.

```sh
$ bun upgrade
```

Bun automatically releases an (untested) canary build on every commit to `main`. To upgrade to the latest canary build:

```sh
$ bun upgrade --canary
```

## Homebrew

Works on macOS and Linux

```sh
$ brew tap oven-sh/bun
$ brew install bun
```

Homebrew recommends using `brew upgrade <package>` to install newer versions.

## Docker

Works on Linux x64

```sh
# this is a comment
$ docker pull oven/bun:edge
this is some output
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun:edge
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun:edge
this is some output
``` -->

## Uninstalling

Bun's binary and install cache is located in `~/.bun` by default. To uninstall bun, delete this directory and edit your shell config (`.bashrc`, `.zshrc`, or similar) to remove `~/.bun/bin` from the `$PATH` variable.

```sh
$ rm -rf ~/.bun # make sure to remove ~/.bun/bin from $PATH
```

## TypeScript

To install TypeScript definitions for Bun's built-in APIs in your project, install `bun-types`.

```sh
$ bun add -d bun-types # dev dependency
```

Then include `"bun-types"` in the `compilerOptions.types` in your `tsconfig.json`:

```json-diff
  {
    "compilerOptions": {
+     "types": ["bun-types"]
    }
  }
```

Refer to [Ecosystem > TypeScript](/docs/runtime/typescript) for a complete guide to TypeScript support in Bun.

## Completions

Shell auto-completion should be configured automatically when Bun is installed.

If not, run the following command. It uses `$SHELL` to determine which shell you're using and writes a completion file to the appropriate place on disk. It's automatically re-run on every `bun upgrade`.

```bash
$ bun completions
```

To write the completions to a custom location:

```bash
$ bun completions > path-to-file      # write to file
$ bun completions /path/to/directory  # write into directory
```
