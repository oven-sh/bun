Configuring a development environment for Bun usually takes 30-90 minutes depending on your operating system.

## Linux/Windows

The best way to build Bun on Linux and Windows is with the official [Dev Container](https://containers.dev). It ships with Zig, JavaScriptCore, Zig Language Server, and more pre-installed on an instance of Ubuntu.

{% image src="https://user-images.githubusercontent.com/709451/147319227-6446589c-a4d9-480d-bd5b-43037a9e56fd.png" /%}

To develop on Linux/Windows, [Docker](https://www.docker.com) is required. If using WSL on Windows, it is recommended to use [Docker Desktop](https://docs.microsoft.com/en-us/windows/wsl/tutorials/wsl-containers) for its WSL2 integration.

### VSCode

If you're using VSCode, you'll need to have the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension installed.

To get started, open VS Code in the `bun` repository. The first time you try to open the dev container, the extension will automatically build it for you, based on [`Dockerfile.devcontainer`](https://github.com/oven-sh/bun/blob/main/Dockerfile.devcontainer).

To open the dev container, open the command palette (`Ctrl` + `Shift` + `P`) and run: `Dev Containers: Reopen in Container`. To later rebuild it (only needed when the devcontainer itself changes, not the Bun code), run: `Dev Containers: Rebuild and Reopen in Container`.

### Other editors and CLI

If you're using another editor or want to manually control the dev container from the command line or a script, you'll need to install the [Dev Container CLI](https://www.npmjs.com/package/@devcontainers/cli): `npm install -g @devcontainers/cli`.

To create and start the dev container, in the `bun` repository, locally run:

```bash
# `make devcontainer-<command>` should be equivalent
# to `devcontainer <command>`, it just sets the architecture
# so if you're on ARM64, it'll do the right thing
$ make devcontainer-up
```

To just build the dev container image, run:

```bash
$ make devcontainer-build
```

To start a shell inside the container, run:

```bash
$ make devcontainer-sh

# if it attaches to the container non-interactively,
# instead use the regular docker exec command:
$ docker exec -it <container-name/id> zsh
```

### Cloning

You will then need to clone the GitHub repository inside that container.

```bash
# First time setup
$ gh auth login # if it fails to open a browser, use Personal Access Token instead
$ gh repo clone oven-sh/bun . -- --depth=1 --progress -j8
```

### Building

```bash
# Compile Bun dependencies (zig is already compiled)
$ make devcontainer

# It initializes and updates all submodules except WebKit, because WebKit
# takes a while and it's already compiled for you. To do it manually, use:
$ git -c submodule."src/bun.js/WebKit".update=none submodule update --init --recursive --depth=1 --progress

# Build Bun for development
$ make dev

# Run Bun
$ bun-debug
```

## MacOS

Install LLVM 15 and `homebrew` dependencies:

```bash
$ brew install llvm@15 coreutils libtool cmake libiconv automake ninja gnu-sed pkg-config esbuild go rust
```

Bun (& the version of Zig) need LLVM 15 and Clang 15 (`clang` is part of LLVM). Make sure LLVM 15 is in your `$PATH`:

```bash
$ which clang-15
```

If not, run this to manually link it:

```bash#bash
# use fish_add_path if you're using fish
$ export PATH="$PATH:$(brew --prefix llvm@15)/bin"
$ export LDFLAGS="$LDFLAGS -L$(brew --prefix llvm@15)/lib"
$ export CPPFLAGS="$CPPFLAGS -I$(brew --prefix llvm@15)/include"
```

### Install Zig

{% callout %}
**⚠️ Warning** — You must use the same version of Zig used by Bun in [oven-sh/zig](https://github.com/oven-sh/zig). Installing with `brew` or via Zig's download page will not work!
{% /callout %}

Use [`zigup`](https://github.com/marler8997/zigup) to install the version of Zig (`ZIG_VERSION`) specified in the official [`Dockerfile`](https://github.com/oven-sh/bun/blob/main/Dockerfile). For example:

```bash
$ zigup 0.11.0-dev.1783+436e99d13
```

### Building

To install and build dependencies:

```bash
# without --depth=1 this will take 20+ minutes on 1gbps internet
# mostly due to WebKit
$ git submodule update --init --recursive --progress --depth=1 --checkout
$ bun install
$ make vendor identifier-cache
```

To compile the C++ bindings:

```bash
# without -j this will take 30+ minutes
$ make bindings -j12
```

<!-- If you're building on a macOS device, you'll need to have a valid Developer Certificate, or else the code signing step will fail. To check if you have one, open the `Keychain Access` app, go to the `login` profile and search for `Apple Development`. You should have at least one certificate with a name like `Apple Development: user@example.com (WDYABC123)`. If you don't have one, follow [this guide](https://ioscodesigning.com/generating-code-signing-files/#generate-a-code-signing-certificate-using-xcode) to get one. -->

<!-- You can still work with the generated binary locally at `packages/debug-bun-*/bun-debug` even if the code signing fails. -->

### Testing

To verify the build worked, lets print the version number on the development build of Bun.

```bash
$ packages/debug-bun-*/bun-debug --version
bun 0.x.y__dev
```

You will want to add `packages/debug-bun-darwin-arm64/` or `packages/debug-bun-darwin-x64/` (depending on your architecture) to `$PATH` so you can run `bun-debug` from anywhere.

### Troubleshooting

If you see an error when compiling `libarchive`, run this:

```bash
$ brew install pkg-config
```

If you see an error about missing files on `zig build obj`, make sure you built the headers.

```bash
$ make headers
```

## JavaScript builtins

When you change anything in `src/bun.js/builtins/js/*`, run this:

```bash
$ make clean-bindings generate-builtins && make bindings -j12
```

That inlines the JavaScript code into C++ headers using the same builtins generator script that Safari uses.

## Code generation scripts

Bun leverages a lot of code generation scripts.

The [./src/bun.js/bindings/headers.h](https://github.com/oven-sh/bun/blob/main/src/bun.js/bindings/headers.h) file has bindings to & from Zig <> C++ code. This file is generated by running the following:

```bash
$ make headers
```

This ensures that the types for Zig and the types for C++ match up correctly, by using comptime reflection over functions exported/imported.

TypeScript files that end with `*.classes.ts` are another code generation script. They generate C++ boilerplate for classes implemented in Zig. The generated code lives in:

- [src/bun.js/bindings/ZigGeneratedClasses.cpp](https://github.com/oven-sh/bun/tree/main/src/bun.js/bindings/ZigGeneratedClasses.cpp)
- [src/bun.js/bindings/ZigGeneratedClasses.h](https://github.com/oven-sh/bun/tree/main/src/bun.js/bindings/ZigGeneratedClasses.h)
- [src/bun.js/bindings/generated_classes.zig](https://github.com/oven-sh/bun/tree/main/src/bun.js/bindings/generated_classes.zig)
  To generate the code, run:

```bash
$ make codegen
```

Lastly, we also have a [code generation script](src/bun.js/scripts/generate-jssink.js) for our native stream implementations.
To run that, run:

```bash
$ make generate-sink
```

You probably won't need to run that one much.

## Modifying ESM core modules

Certain modules like `node:fs`, `node:path`, `node:stream`, and `bun:sqlite` are implemented in JavaScript. These live in `src/bun.js/*.exports.js` files.

While Bun is in beta, you can modify them at runtime in release builds via the environment variable `BUN_OVERRIDE_MODULE_PATH`. When set, Bun will look in the override directory for `<name>.exports.js` before checking the files from `src/bun.js` (which are now baked in to the binary). This lets you test changes to the ESM modules without needing to re-compile Bun.

## Troubleshooting

If you encounter `error: the build command failed with exit code 9` during the build process, this means you ran out of memory or swap. Bun currently needs about 8 GB of RAM to compile.

## Valgrind

On Linux, valgrind can help find memory issues.

Keep in mind:

- JavaScriptCore doesn't support valgrind. It will report spurious errors.
- Valgrind is slow
- Mimalloc will sometimes cause spurious errors when debug build is enabled

You'll need a very recent version of Valgrind due to DWARF 5 debug symbols. You may need to manually compile Valgrind instead of using it from your Linux package manager.

`--fair-sched=try` is necessary if running multithreaded code in Bun (such as the bundler). Otherwise it will hang.

```bash
valgrind --fair-sched=try --track-origins=yes bun-debug <args>
```
