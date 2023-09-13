
# Setting Up Your Development Environment for Bun

Configuring a development environment for Bun can take 10-30 minutes, depending on your internet speed and computer. You'll need around 10GB of free disk space for the repository and build artifacts.

If you're using Windows, you must use a WSL (Windows Subsystem for Linux) environment because Bun doesn't compile natively on Windows.

Before starting, make sure you already have a release build of Bun installed because we'll use it to transpile and minify our code.

## Installation Steps

Choose one of the following methods to install Bun:

### Method 1: Using curl (for macOS, Linux, and WSL)

```bash
$ curl -fsSL https://bun.sh/install | bash
```

### Method 2: Using npm (for all platforms)

```bash
$ npm install -g bun
```

### Method 3: Using Homebrew (for macOS and Linux)

```bash
$ brew tap oven-sh/bun
$ brew install bun
```

### Method 4: Using Docker

```bash
$ docker pull oven/bun
$ docker run --rm --init --ulimit memlock=-1:-1 oven/bun
```

### Method 5: Using proto (for all platforms)

```bash
$ proto install bun
```

## Installing LLVM

Bun requires LLVM 15 and Clang 15 (Clang is part of LLVM) to match WebKit's version. Mismatching versions can lead to memory allocation failures. You can install LLVM through your system's package manager:

### macOS (Homebrew)

```bash
$ brew install llvm@15
```

### Ubuntu/Debian

```bash
$ wget https://apt.llvm.org/llvm.sh -O - | sudo bash -s -- 15 all
```

### Arch Linux

```bash
$ sudo pacman -S llvm15 clang15 lld
```

If none of the above solutions apply, you can install LLVM 15 [manually](https://github.com/llvm/llvm-project/releases/tag/llvmorg-15.0.7).

Make sure LLVM 15 is in your path:

```bash
$ which clang-15
```

If it's not, manually link it using the following commands:

### macOS (Homebrew)

```bash
# Use fish_add_path if you're using fish
$ export PATH="$PATH:$(brew --prefix llvm@15)/bin"
$ export LDFLAGS="$LDFLAGS -L$(brew --prefix llvm@15)/lib"
$ export CPPFLAGS="$CPPFLAGS -I$(brew --prefix llvm@15)/include"
```

### Arch Linux

```bash
$ export PATH="$PATH:/usr/lib/llvm15/bin"
$ export LDFLAGS="$LDFLAGS -L/usr/lib/llvm15/lib"
$ export CPPFLAGS="$CPPFLAGS -I/usr/lib/llvm15/include"
```

## Installing Dependencies

Use your system's package manager to install the remaining dependencies for Bun:

### macOS (Homebrew)

```bash
$ brew install automake ccache cmake coreutils esbuild gnu-sed go libiconv libtool ninja pkg-config rust
```

### Ubuntu/Debian

```bash
$ sudo apt install cargo ccache cmake git golang libtool ninja-build pkg-config rustc esbuild
```

### Arch Linux

```bash
$ sudo pacman -S base-devel ccache cmake esbuild git go libiconv libtool make ninja pkg-config python rust sed unzip
```

In addition to this, you'll need an npm package manager (e.g., Bun, npm) to install the dependencies listed in `package.json`.

## Installing Zig

Zig can be installed using the npm package `@oven/zig` or by using [zigup](https://github.com/marler8997/zigup).

```bash
$ bun install -g @oven/zig
$ zigup 0.12.0-dev.163+6780a6bbf
```

## First Build

After cloning the repository, run the following command for the initial build. This step may take a while as it will clone submodules and build dependencies.

```bash
$ make setup
```

The binary can be found at `packages/debug-bun-{platform}-{arch}/bun-debug`. It's recommended to add this to your `$PATH`. To verify the build, let's print the version number of the development build of Bun.

```bash
$ packages/debug-bun-*/bun-debug --version
bun 1.x.y__dev
```

Note: `make setup` is equivalent to the following command:

```bash
$ make assert-deps submodule npm-install-dev node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp zlib boringssl libarchive lolhtml sqlite usockets uws tinycc c-ares zstd base64 cpp zig link
```

This command cloned submodules and built subprojects. When a submodule is out of date, you can run `make submodule` to quickly reset/update all your submodules and then rebuild individual submodules with their respective command.

## VSCode

VSCode is the recommended IDE for working on Bun, as it has been pre-configured. Upon opening, you can run `Extensions: Show Recommended Extensions` to install the recommended extensions for Zig and C++. ZLS (Zig Language Server) is automatically configured.

### ZLS (Zig Language Server)

The ZLS is the language server for Zig. The latest binary that the extension auto-updates may not function correctly with the version of Zig that Bun uses. It may be more reliable to build ZLS from source:

```bash
$ git clone https://github.com/zigtools/zls
$ cd zls
$ git checkout f91ff831f4959efcb7e648dba4f0132c296d26c0
$ zig build
```

Then, add absolute paths to Zig and ZLS in your vscode config:

```json
{
  "zig.zigPath": "/path/to/zig/install/zig",
  "zig.zls.path": "/path/to/zls/zig-out/bin/zls"
}
```

## JavaScript Builtins

When you modify anything in `src/js/builtins/*` or switch branches, run this:

```bash
$ make js cpp
```

This inlines the TypeScript code into C++ headers.

For more information on how `src/js` works, check `src/js/README.md` in the codebase.

## Code Generation Scripts

Bun relies on code generation scripts for various tasks. Here are some of them:

### Headers Generation

Bun generates the [./src/bun.js/bindings/headers.h](https://github.com/oven-sh/bun/blob/main/src/bun.js/bindings/headers.h) file for Zig <> C++ code bindings. To generate this file, run:

```bash
$ make headers
```

This ensures that Zig and C++ types match up correctly.

### Classes Generation

Bun generates C++ boilerplate for classes implemented in Zig from `*.classes.ts` TypeScript files. To generate this code, run:

```bash
$ make codegen
```

### JSSink Generation

Bun has a

 [code generation script](src/bun.js/scripts/generate-jssink.js) for native stream implementations. To run it, use this command:

```bash
$ make generate-sink
```

You probably won't need to run this one often.

## Modifying ESM Modules

Certain modules like `node:fs`, `node:stream`, `bun:sqlite`, and `ws` are implemented in JavaScript. These modules live in `src/js/{node,bun,thirdparty}` files and are pre-bundled using Bun. When you make changes to these modules, run:

```bash
$ make js
```

In debug builds, Bun automatically loads these modules from the filesystem, so there's no need to rerun `make dev`.

## Building a Release Version

To build a release version of Bun, use the following commands:

```bash
$ make release-bindings -j12
$ make release
```

The binary will be located at `packages/bun-{platform}-{arch}/bun`.

## Valgrind (Linux Only)

On Linux, Valgrind can help find memory issues. Keep in mind:

- JavaScriptCore doesn't support Valgrind and may report spurious errors.
- Valgrind is slow.
- Mimalloc may cause spurious errors when the debug build is enabled.

Ensure you have a recent version of Valgrind with DWARF 5 debug symbols. You may need to compile Valgrind manually:

```bash
$ valgrind --fair-sched=try --track-origins=yes bun-debug <args>
```

## Updating WebKit

The Bun team may update the version of WebKit used in Bun. When this happens, you might see changes in the WebKit submodule. To update it, run the following commands from the Bun repository root:

```bash
$ bun install
$ make cpp
```

If you encounter issues, check the [Bun repo](https://github.com/oven-sh/bun/tree/main/src/bun.js) for the hash of the current WebKit commit in use.

## Troubleshooting

If you encounter issues during the setup process, here are some troubleshooting steps:

### 'span' File Not Found on Ubuntu

If you see a 'span' file not found error on Ubuntu, it may be due to GCC's `libstdc++` library. Bun relies on C++20 features not present in GCC versions below 11. To fix this, you can upgrade GCC to version 11:

```bash
$ sudo apt update
$ sudo apt install gcc-11 g++-11
$ sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-11 100
$ sudo update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-11 100
```

### libarchive

If you encounter issues with `libarchive` during compilation, run:

```bash
$ brew install pkg-config
```

### Missing Files in 'zig build obj'

If you see missing files in 'zig build obj', ensure you've built the headers:

```bash
$ make headers
```

### cmakeconfig.h Not Found

If you encounter an error about 'cmakeconfig.h' not being found, run:

```bash
$ bun install
```

### macOS 'Library Not Found for -lSystem'

If you encounter the 'library not found for -lSystem' error on macOS, run:

```bash
$ xcode-select --install
```

## Arch Linux - Cannot Find 'libatomic.a'

On Arch Linux, Bun requires 'libatomic' to be statically linked. You can create a symlink to make it work locally:

```bash
$ sudo ln -s /lib/libatomic.so /lib/libatomic.a
```

Please note that the built version of Bun may not work on other systems if compiled this way.
