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

## Windows

Bun provides a _limited, experimental_ native build for Windows. At the moment, only the Bun runtime is supported.

- `bun <file>`
- `bun run <file>`

The test runner, package manager, and bundler are still under development. The following commands have been disabled.

- `bun test`
- `bun install/add/remove`
- `bun link/unlink`
- `bun build`

For now, you can use [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) to run your bun.

First, create a folder, open a PowerShell inside this directory and run these comands:
```powershell
Write-Output "wsl bash -ic `"bun %*`"" | out-file "bun.bat" -Encoding ASCII
$env:Path += ";$pwd"
wsl bash -ic "curl -fsSL https://bun.sh/install | bash"
```

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
