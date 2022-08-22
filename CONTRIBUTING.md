# Contributing

This doc is a guide to making changes to Bun. If you are looking for the general docs they can be [found here](#README.md).

[8/21/22] - These contributing docs are a WIP, if something is broken please check Discord for updates and make changes as appropriate;

## Table of Contents

- [Developing bun](#developing-bun)
  - [VSCode Dev Container (Linux)](#vscode-dev-container-linux)
  - [MacOS](#macos)
    - [Build bun (macOS)](#build-bun-macos)
    - [Verify it worked (macOS)](#verify-it-worked-macos)
    - [Troubleshooting (macOS)](#troubleshooting-macos)
  - [Troubleshooting (general)](#troubleshooting-general)

## Developing bun

Estimated: 30-90 minutes :(

### VSCode Dev Container (Linux)

The VSCode Dev Container in this repository is the easiest way to get started. It comes with Zig, JavaScriptCore, Zig Language Server, vscode-zig, and more pre-installed on an instance of Ubuntu.

<img src="https://user-images.githubusercontent.com/709451/147319227-6446589c-a4d9-480d-bd5b-43037a9e56fd.png" />

To develop on Linux, the following is required:

- [Visual Studio Code](https://code.visualstudio.com/)
- [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension for Visual Studio Code
- [Docker](https://www.docker.com). If using WSL on Windows, it is recommended to use [Docker Desktop](https://docs.microsoft.com/en-us/windows/wsl/tutorials/wsl-containers) for its WSL2 integration.
- [Dev Container CLI](https://www.npmjs.com/package/@devcontainers/cli): `npm install -g @devcontainers/cli`

To get started, in the `bun` repository, locally run:

```bash
# devcontainer-build just sets the architecture so if you're on ARM64, it'll do the right thing.
make devcontainer-build
```

Next, open VS Code in the `bun` repository.
To open the dev container, open the command palette (Ctrl + Shift + P) and run: `Remote-Containers: Reopen in Container`.

You will then need to clone the GitHub repository inside that container.

Inside the container, run this:

```bash
# First time setup
gh repo clone oven-sh/bun . -- --depth=1 --progress -j8

# update all submodules except webkit because webkit takes awhile and it's already compiled for you.
git -c submodule."src/bun.js/WebKit".update=none submodule update --init --recursive --depth=1 --progress

# Compile bun dependencies (zig is already compiled)
make devcontainer

# Build bun for development
make dev

# Run bun
bun-debug
```

It is very similar to my own development environment (except I use macOS)

### MacOS

Install LLVM 13 and homebrew dependencies:

```bash
brew install llvm@13 coreutils libtool cmake libiconv automake ninja gnu-sed pkg-config esbuild go rust
```

bun (& the version of Zig) need LLVM 13 and Clang 13 (clang is part of LLVM). Weird build & runtime errors will happen otherwise.

Make sure LLVM 13 is in your `$PATH`:

```bash
which clang-13
```

If it is not, you will have to run this to link it:

```bash
export PATH="$(brew --prefix llvm@13)/bin:$HOME/.bun-tools/zig:$PATH"
export LDFLAGS="$LDFLAGS -L$(brew --prefix llvm@13)/lib"
export CPPFLAGS="$CPPFLAGS -I$(brew --prefix llvm@13)/include"
```

On fish that looks like `fish_add_path (brew --prefix llvm@13)/bin`

#### Install Zig (macOS)

Note: **you must use the same version of Zig used by Bun in [oven-sh/zig](https://github.com/oven-sh/zig)**. Installing `zig` from brew will not work. Installing the latest stable version of Zig won't work. If you don't use the same version Bun uses, you will get strange build errors and be sad because you put all this work into trying to get Bun to compile and it failed for weird reasons.

To install the zig binary:

```bash
# Custom path for the custom zig install
mkdir -p ~/.bun-tools

# Requires jq & grab latest binary
curl -o zig.tar.gz -sL https://github.com/oven-sh/zig/releases/download/jul1/zig-macos-$(uname -m).tar.gz

# This will extract to $HOME/.bun-tools/zig
tar -xvf zig.tar.gz -C $HOME/.bun-tools/

# Make sure it gets trusted
xattr -dr com.apple.quarantine .bun-tools/zig/zig
```

Now you'll need to add Zig to your PATH.

Using `zsh`:

```zsh
echo 'export PATH="$HOME/.bun-tools/zig:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Using `fish`:

```fish
# Add to PATH (fish)
fish_add_path $HOME/.bun-tools/zig
```

Using `bash`:

```bash
echo 'export PATH="$HOME/.bun-tools/zig:$PATH"' >> ~/.bash_profile
source ~/.bash_profile
```

The version of Zig used by Bun is not a fork, just a slightly older version. Zig is a new programming language and moves quickly.

#### Build bun (macOS)

If you're building on a macOS device, you'll need to have a valid Developer Certificate, or else the code signing step will fail. To check if you have one, open the `Keychain Access` app, go to the `login` profile and search for `Apple Development`. You should have at least one certificate with a name like `Apple Development: user@example.com (WDYABC123)`. If you don't have one, follow [this guide](https://ioscodesigning.com/generating-code-signing-files/#generate-a-code-signing-certificate-using-xcode) to get one.

You can still work with the generated binary locally at `packages/debug-bun-*/bun-debug` even if the code signing fails.

In `bun`:

```bash
# If you omit --depth=1, `git submodule update` will take 17.5 minutes on 1gbps internet, mostly due to WebKit.
git submodule update --init --recursive --progress --depth=1
make vendor identifier-cache jsc dev
```

#### Verify it worked (macOS)

First ensure the node dependencies are installed

```bash
(cd test/snippets && npm i)
(cd test/scripts && npm i)
```

Then

```bash
make test-dev-all
```

#### Troubleshooting (macOS)

If you see an error when compiling `libarchive`, run this:

```bash
brew install pkg-config
```

If you see an error about missing files on `zig build obj`, make sure you built the headers

## vscode-zig

Note: this is automatically installed on the devcontainer

You will want to install the fork of `vscode-zig` so you get a `Run test` and a `Debug test` button.

To do that:

```bash
curl -L https://github.com/Jarred-Sumner/vscode-zig/releases/download/fork-v1/zig-0.2.5.vsix > vscode-zig.vsix
code --install-extension vscode-zig.vsix
```

<a target="_blank" href="https://github.com/jarred-sumner/vscode-zig"><img src="https://pbs.twimg.com/media/FBZsKHlUcAYDzm5?format=jpg&name=large"></a>

### Troubleshooting (general)

If you encounter `error: the build command failed with exit code 9` during the build process, this means you ran out of memory or swap. Bun currently needs about 22 GB of RAM to compile.
