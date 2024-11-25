Bun ships as a single executable with no dependencies that can be installed a few different ways.

## Installing

### macOS and Linux

{% callout %}
**Linux users** — The `unzip` package is required to install Bun. Use `sudo apt install unzip` to install `unzip` package.
Kernel version 5.6 or higher is strongly recommended, but the minimum is 5.1. Use `uname -r` to check Kernel version.
{% /callout %}

{% codetabs %}

```bash#macOS/Linux_(curl)
$ curl -fsSL https://bun.sh/install | bash # for macOS, Linux, and WSL
# to install a specific version
$ curl -fsSL https://bun.sh/install | bash -s "bun-v1.0.0"
```

```bash#npm
$ npm install -g bun # the last `npm` command you'll ever need
```

```bash#Homebrew
$ brew install oven-sh/bun/bun # for macOS and Linux
```

```bash#Docker
$ docker pull oven/bun
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun
```

{% /codetabs %}

### Windows

To install, paste this into a terminal:

{% codetabs %}

```powershell#PowerShell/cmd.exe
> powershell -c "irm bun.sh/install.ps1|iex"
```

```powershell#npm
> npm install -g bun # the last `npm` command you'll ever need
```

```powershell#Scoop
> scoop install bun
```

{% /codetabs %}

{% callout %}
Bun requires a minimum of Windows 10 version 1809
{% /callout %}

For support and discussion, please join the [#windows channel on our Discord](http://bun.sh/discord).

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
$ docker pull oven/bun:distroless
$ docker pull oven/bun:alpine
```

## Checking installation

To check that Bun was installed successfully, open a new terminal window and run `bun --version`.

```sh
$ bun --version
1.x.y
```

To see the precise commit of [oven-sh/bun](https://github.com/oven-sh/bun) that you're using, run `bun --revision`.

```sh
$ bun --revision
1.x.y+b7982ac13189
```

If you've installed Bun but are seeing a `command not found` error, you may have to manually add the installation directory (`~/.bun/bin`) to your `PATH`.

{% details summary="How to add to your `PATH`" %}
First, determine what shell you're using:

```sh
$ echo $SHELL
/bin/zsh # or /bin/bash or /bin/fish
```

Then add these lines below to bottom of your shell's configuration file.

{% codetabs %}

```bash#~/.zshrc
# add to ~/.zshrc
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

```bash#~/.bashrc
# add to ~/.bashrc
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

```sh#~/.config/fish/config.fish
# add to ~/.config/fish/config.fish
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

{% /codetabs %}
Save the file. You'll need to open a new shell/terminal window for the changes to take effect.

{% /details %}

## Upgrading

Once installed, the binary can upgrade itself.

```sh
$ bun upgrade
```

{% callout %}
**Homebrew users** — To avoid conflicts with Homebrew, use `brew upgrade bun` instead.

**Scoop users** — To avoid conflicts with Scoop, use `scoop update bun` instead.

{% /callout %}

## Canary builds

Bun automatically releases an (untested) canary build on every commit to `main`. To upgrade to the latest canary build:

```sh
$ bun upgrade --canary
```

The canary build is useful for testing new features and bug fixes before they're released in a stable build. To help the Bun team fix bugs faster, canary builds automatically upload crash reports to Bun's team.

[View canary build](https://github.com/oven-sh/bun/releases/tag/canary)

{% callout %}
**Note** — To switch back to a stable release from canary, run `bun upgrade --stable`.
{% /callout %}

## Installing older versions of Bun

Since Bun is a single binary, you can install older versions of Bun by re-running the installer script with a specific version.

### Installing a specific version of Bun on Linux/Mac

To install a specific version of Bun, you can pass the git tag of the version you want to install to the install script, such as `bun-v1.1.6` or `bun-v1.1.1`.

```sh
$ curl -fsSL https://bun.sh/install | bash -s "bun-v1.1.6"
```

### Installing a specific version of Bun on Windows

On Windows, you can install a specific version of Bun by passing the version number to the Powershell install script.

```sh
# PowerShell:
$ iex "& {$(irm https://bun.sh/install.ps1)} -Version 1.1.6"
```

## Downloading Bun binaries directly

To download Bun binaries directly, you can visit the [releases page](https://github.com/oven-sh/bun/releases) page on GitHub.

For convenience, here are download links for the latest version:

- [`bun-linux-x64.zip`](https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip)
- [`bun-linux-x64-baseline.zip`](https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-baseline.zip)
- [`bun-windows-x64.zip`](https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip)
- [`bun-windows-x64-baseline.zip`](https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64-baseline.zip)
- [`bun-darwin-aarch64.zip`](https://github.com/oven-sh/bun/releases/latest/download/bun-darwin-aarch64.zip)
- [`bun-linux-aarch64.zip`](https://github.com/oven-sh/bun/releases/latest/download/bun-linux-aarch64.zip)
- [`bun-darwin-x64.zip`](https://github.com/oven-sh/bun/releases/latest/download/bun-darwin-x64.zip)
- [`bun-darwin-x64-baseline.zip`](https://github.com/oven-sh/bun/releases/latest/download/bun-darwin-x64-baseline.zip)

The `baseline` binaries are built for older CPUs which may not support AVX2 instructions. If you run into an "Illegal Instruction" error when running Bun, try using the `baseline` binaries instead. Bun's install scripts automatically choose the correct binary for your system which helps avoid this issue. Baseline builds are slower than regular builds, so use them only if necessary.

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

```powershell#Windows
> powershell -c ~\.bun\uninstall.ps1
```

```powershell#Scoop
> scoop uninstall bun
```

```bash#npm
$ npm uninstall -g bun
```

```bash#Homebrew
$ brew uninstall bun
```

{% /codetabs %}
