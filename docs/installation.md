Bun ships as a single executable that can be installed a few different ways.

## macOS and Linux

{% callout %}
**Linux users** — The `unzip` package is required to install Bun. Kernel version 5.6 or higher is strongly recommended, but the minimum is 5.1.
{% /callout %}

{% codetabs %}

```bash#macOS/Linux_(curl)
$ curl -fsSL https://bun.sh/install | bash # for macOS, Linux, and WSL
# to install a specific version
$ curl -fsSL https://bun.sh/install | bash -s "bun-v1.0.0"
```

```bash#NPM
$ npm install -g bun # the last `npm` command you'll ever need
```

```bash#Homebrew
$ brew tap oven-sh/bun # for macOS and Linux
$ brew install bun
```

```bash#Docker
$ docker pull oven/bun
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun
```

```bash#Proto
$ proto install bun
```

{% /codetabs %}

### Global Installation Behavior
{% callout %}
**Note** — To ensure Bun can install package globally, you might have to manually add `BUN_INSTALL` and `PATH` to your system environment.
{% /callout %}

{% codetabs %}

```bash#macOS/Linux_(.bash_profile)
$ echo -e export BUN_INSTALL="\$HOME/.bun" >> ~/.bash_profile
$ echo -e export PATH=\$BUN_INSTALL/bin:\$PATH >> ~/.bash_profile
$ source ~/.bash_profile
```

```bash#macOS/Linux_(.bashrc)
$ echo -e export BUN_INSTALL="\$HOME/.bun" >> ~/.bashrc
$ echo -e export PATH=\$BUN_INSTALL/bin:\$PATH >> ~/.bashrc
$ source ~/.bashrc
```

```bash#macOS_(.zshrc)
$ echo -e export BUN_INSTALL="\$HOME/.bun" >> ~/.zshrc
$ echo -e export PATH=\$BUN_INSTALL/bin:\$PATH >> ~/.zshrc
$ source ~/.zshrc
```

{% /codetabs %}

## Windows

Bun provides a _limited, experimental_ native build for Windows. At the moment, only the Bun runtime is supported.

- `bun <file>`
- `bun run <file>`

The test runner, package manager, and bundler are still under development. The following commands have been disabled.

- `bun test`
- `bun install/add/remove`
- `bun link/unlink`
- `bun build`

## Docker

Bun provides a [Docker image](https://hub.docker.com/r/oven/bun/tags) that supports both Linux x64 and arm64.

```bash
$ docker pull oven/bun
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun
```

There are also image variants for different operating systems.

```bash
$ docker pull oven/bun:debian
$ docker pull oven/bun:slim
$ docker pull oven/bun:alpine
$ docker pull oven/bun:distroless
```

## Check of Installation

### `bun --version`

To check the version installed, use the `--version` flag (or `--v`).

```sh
$ bun --version
```

```sh
$ bun --v
```

{% callout %}
**Note** — This is equalvent to `npm --version` that gives you the installed version.
**Example** - `1.0.4`
{% /callout %}

### `bun --revision`

For Bun, there are minor updates within the same version. To check the version with revision, use the `--revision` flag.

```sh
$ bun --revision
```

{% callout %}
**Note** — There will show you both version and revision installed.
**Example** - `1.0.4+ffe6bb0b7fd801ef6a3bb408708fbbf070904dd8`
{% /callout %}

## Upgrading

Once installed, the binary can upgrade itself.

```sh
$ bun upgrade
```

{% callout %}
**Homebrew users** — To avoid conflicts with Homebrew, use `brew upgrade bun` instead.

**proto users** - Use `proto install bun --pin` instead.
{% /callout %}

Bun automatically releases an (untested) canary build on every commit to `main`. To upgrade to the latest canary build:

```sh
$ bun upgrade --canary
```

[View canary build](https://github.com/oven-sh/bun/releases/tag/canary)

{% callout %}
**Note** — To switch back to a stable release from canary, run `bun upgrade` again with no flags.
{% /callout %}

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

<!-- ## Completions

Shell auto-completion should be configured automatically when Bun is installed!

If not, run the following command. It uses `$SHELL` to determine which shell you're using and writes a completion file to the appropriate place on disk. It's automatically re-run on every `bun upgrade`.

```bash
$ bun completions
```

To write the completions to a custom location:

```bash
$ bun completions > path-to-file      # write to file
$ bun completions /path/to/directory  # write into directory
``` -->

## Uninstall

If you need to remove Bun from your system, use the following commands.

{% codetabs %}

```bash#macOS/Linux_(curl)
$ rm -rf ~/.bun # for macOS, Linux, and WSL
```

```bash#NPM
$ npm uninstall -g bun
```

```bash#Homebrew
$ brew uninstall bun
```

```bash#Proto
$ proto uninstall bun
```

{% /codetabs %}
