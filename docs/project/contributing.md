Configuring a development environment for Bun can take 10-30 minutes depending on your internet connection and computer speed. You will need ~10GB of free disk space for the repository and build artifacts.

If you are using Windows, you must use a WSL environment as Bun does not yet compile on Windows natively.

Before starting, you will need to already have a release build of Bun installed, as we use our bundler to transpile and minify our code.

{% codetabs %}

```bash#Native
$ curl -fsSL https://bun.sh/install | bash # for macOS, Linux, and WSL
```

```bash#npm
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

```bash#proto
$ proto install bun
```

{% /codetabs %}

## Install LLVM

Bun requires LLVM 16 and Clang 16 (`clang` is part of LLVM). This version requirement is to match WebKit (precompiled), as mismatching versions will cause memory allocation failures at runtime. In most cases, you can install LLVM through your system package manager:

{% codetabs %}

```bash#macOS (Homebrew)
$ brew install llvm@16
```

```bash#Ubuntu/Debian
$ # LLVM has an automatic installation script that is compatible with all versions of Ubuntu
$ wget https://apt.llvm.org/llvm.sh -O - | sudo bash -s -- 16 all
```

```bash#Arch
$ sudo pacman -S llvm clang lld
```

```bash#Fedora
$ sudo dnf install 'dnf-command(copr)'
$ sudo dnf copr enable -y @fedora-llvm-team/llvm-snapshots
$ sudo dnf install llvm clang lld
```

{% /codetabs %}

If none of the above solutions apply, you will have to install it [manually](https://github.com/llvm/llvm-project/releases/tag/llvmorg-16.0.6).

Make sure LLVM 16 is in your path:

```bash
$ which clang-16
```

If not, run this to manually link it:

{% codetabs %}

```bash#macOS (Homebrew)
# use fish_add_path if you're using fish
$ export PATH="$PATH:$(brew --prefix llvm@16)/bin"
$ export LDFLAGS="$LDFLAGS -L$(brew --prefix llvm@16)/lib"
$ export CPPFLAGS="$CPPFLAGS -I$(brew --prefix llvm@16)/include"
```

```bash#Arch

$ export PATH="$PATH:/usr/lib/llvm16/bin"
$ export LDFLAGS="$LDFLAGS -L/usr/lib/llvm16/lib"
$ export CPPFLAGS="$CPPFLAGS -I/usr/lib/llvm16/include"

```

{% /codetabs %}

## Install Dependencies

Using your system's package manager, install the rest of Bun's dependencies:

{% codetabs %}

```bash#macOS (Homebrew)
$ brew install automake ccache cmake coreutils esbuild gnu-sed go libiconv libtool ninja pkg-config rust
```

```bash#Ubuntu/Debian
$ sudo apt install cargo ccache cmake git golang libtool ninja-build pkg-config rustc esbuild
```

```bash#Arch
$ sudo pacman -S base-devel ccache cmake esbuild git go libiconv libtool make ninja pkg-config python rust sed unzip
```

```bash#Fedora
$ sudo dnf install cargo ccache cmake git golang libtool ninja-build pkg-config rustc golang-github-evanw-esbuild libatomic-static libstdc++-static sed unzip
```

{% /codetabs %}

{% details summary="Ubuntu — Unable to locate package esbuild" %}

The `apt install esbuild` command may fail with an `Unable to locate package` error if you are using a Ubuntu mirror that does not contain an exact copy of the original Ubuntu server. Note that the same error may occur if you are not using any mirror but have the Ubuntu Universe enabled in the `sources.list`. In this case, you can install esbuild manually:

```bash
$ curl -fsSL https://esbuild.github.io/dl/latest | sh
$ chmod +x ./esbuild
$ sudo mv ./esbuild /usr/local/bin
```

{% /details %}

In addition to this, you will need an npm package manager (`bun`, `npm`, etc) to install the `package.json` dependencies.

## Install Zig

Zig can be installed either with our npm package [`@oven/zig`](https://www.npmjs.com/package/@oven/zig), or by using [zigup](https://github.com/marler8997/zigup).

```bash
$ bun install -g @oven/zig
$ zigup 0.12.0-dev.899+027aabf49
```

{% callout %}
We last updated Zig on **October 12th, 2023**
{% /callout %}

## First Build

After cloning the repository, run the following command to run the first build. This may take a while as it will clone submodules and build dependencies.

```bash
$ make setup
```

The binary will be located at `packages/debug-bun-{platform}-{arch}/bun-debug`. It is recommended to add this to your `$PATH`. To verify the build worked, let's print the version number on the development build of Bun.

```bash
$ packages/debug-bun-*/bun-debug --version
bun 1.x.y__dev
```

Note: `make setup` is just an alias for the following:

```bash
$ make assert-deps submodule npm-install-dev node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp zlib boringssl libarchive lolhtml sqlite usockets uws tinycc c-ares zstd base64 cpp zig link
```

## Rebuilding

Bun uses a series of make commands to rebuild parts of the codebase. The general rule for rebuilding is there is `make link` to rerun the linker, and then different make targets for different parts of the codebase. Do not pass `-j` to make as these scripts will break if run out of order, and multiple cores will be used when possible during the builds.

{% table %}

- What changed
- Run this command

---

- Zig Code
- `make zig`

---

- C++ Code
- `make cpp`

---

- Zig + C++ Code
- `make dev` (combination of the above two)

---

- JS/TS Code in `src/js`
- `make js` (in bun-debug, js is loaded from disk without a recompile). If you change the names of any file or add/remove anything, you must also run `make dev`.

---

- `*.classes.ts`
- `make generate-classes dev`

---

- JSSink
- `make generate-sink cpp`

---

- `src/node_fallbacks/*`
- `make node-fallbacks zig`

---

- `identifier_data.zig`
- `make identifier-cache zig`

---

- Code using `cppFn`/`JSC.markBinding`
- `make headers` (TODO: explain what this is used for and why it's useful)

{% /table %}

`make setup` cloned a bunch of submodules and built the subprojects. When a submodule is out of date, run `make submodule` to quickly reset/update all your submodules, then you can rebuild individual submodules with their respective command.

{% table %}

- Dependency
- Run this command

---

- WebKit
- `bun install` (it is a prebuilt package)

---

- uWebSockets
- `make uws`

---

- Mimalloc
- `make mimalloc`

---

- PicoHTTPParser
- `make picohttp`

---

- zlib
- `make zlib`

---

- BoringSSL
- `make boringssl`

---

- libarchive
- `make libarchive`

---

- lolhtml
- `make lolhtml`

---

- sqlite
- `make sqlite`

---

- TinyCC
- `make tinycc`

---

- c-ares
- `make c-ares`

---

- zstd
- `make zstd`

---

- Base64
- `make base64`

{% /table %}

The above will probably also need Zig and/or C++ code rebuilt.

## VSCode

VSCode is the recommended IDE for working on Bun, as it has been configured. Once opening, you can run `Extensions: Show Recommended Extensions` to install the recommended extensions for Zig and C++. ZLS is automatically configured.

## JavaScript builtins

When you change anything in `src/js/builtins/*` or switch branches, run this:

```bash
$ make js cpp
```

That inlines the TypeScript code into C++ headers.

{% callout %}
Make sure you have `ccache` installed, otherwise regeneration will take much longer than it should.
{% /callout %}

For more information on how `src/js` works, see `src/js/README.md` in the codebase.

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

## Modifying ESM modules

Certain modules like `node:fs`, `node:stream`, `bun:sqlite`, and `ws` are implemented in JavaScript. These live in `src/js/{node,bun,thirdparty}` files and are pre-bundled using Bun. The bundled code is committed so CI builds can run without needing a copy of Bun.

When these are changed, run:

```
$ make js
```

In debug builds, Bun automatically loads these from the filesystem, wherever it was compiled, so no need to re-run `make dev`.

## Release build

To build a release build of Bun, run:

```bash
$ make release-bindings -j12
$ make release
```

The binary will be located at `packages/bun-{platform}-{arch}/bun`.

## Valgrind

On Linux, valgrind can help find memory issues.

Keep in mind:

- JavaScriptCore doesn't support valgrind. It will report spurious errors.
- Valgrind is slow
- Mimalloc will sometimes cause spurious errors when debug build is enabled

You'll need a very recent version of Valgrind due to DWARF 5 debug symbols. You may need to manually compile Valgrind instead of using it from your Linux package manager.

`--fair-sched=try` is necessary if running multithreaded code in Bun (such as the bundler). Otherwise it will hang.

```bash
$ valgrind --fair-sched=try --track-origins=yes bun-debug <args>
```

## Updating `WebKit`

The Bun team will occasionally bump the version of WebKit used in Bun. When this happens, you may see errors in `src/bun.js/bindings` during builds. When you see this, install the latest version of `bun-webkit` and re-compile.

```bash
$ bun install
$ make cpp
```

## Building WebKit locally + Debug mode of JSC

WebKit is not cloned by default (to save time and disk space). To clone and build WebKit locally, run:

```bash
# once you run this, `make submodule` can be used to automatically
# update WebKit and the other submodules
$ git submodule update --init --depth 1 --checkout src/bun.js/WebKit
# to make a jsc release build
$ make jsc
# JSC debug build does not work perfectly with Bun yet, this is actively being
# worked on and will eventually become the default.
$ make jsc-build-linux-compile-debug cpp
$ make jsc-build-mac-compile-debug cpp
```

Note that the WebKit folder, including build artifacts, is 8GB+ in size.

If you are using a JSC debug build and using VScode, make sure to run the `C/C++: Select a Configuration` command to configure intellisense to find the debug headers.

## Troubleshooting

### 'span' file not found on Ubuntu

> ⚠️ Please note that the instructions below are specific to issues occurring on Ubuntu. It is unlikely that the same issues will occur on other Linux distributions.

The Clang compiler typically uses the `libstdc++` C++ standard library by default. `libstdc++` is the default C++ Standard Library implementation provided by the GNU Compiler Collection (GCC). While Clang may link against the `libc++` library, this requires explicitly providing the `-stdlib` flag when running Clang.

Bun relies on C++20 features like `std::span`, which are not available in GCC versions lower than 11. GCC 10 doesn't have all of the C++20 features implemented. As a result, running `make setup` may fail with the following error:

```
fatal error: 'span' file not found
#include <span>
         ^~~~~~
```

To fix the error, we need to update the GCC version to 11. To do this, we'll need to check if the latest version is available in the distribution's official repositories or use a third-party repository that provides GCC 11 packages. Here are general steps:

```bash
$ sudo apt update
$ sudo apt install gcc-11 g++-11
# If the above command fails with `Unable to locate package gcc-11` we need
# to add the APT repository
$ sudo add-apt-repository -y ppa:ubuntu-toolchain-r/test
# Now run `apt install` again
$ sudo apt install gcc-11 g++-11
```

Now, we need to set GCC 11 as the default compiler:

```bash
$ sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-11 100
$ sudo update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-11 100
```

### libarchive

If you see an error when compiling `libarchive`, run this:

```bash
$ brew install pkg-config
```

### missing files on `zig build obj`

If you see an error about missing files on `zig build obj`, make sure you built the headers.

```bash
$ make headers
```

### cmakeconfig.h not found

If you see an error about `cmakeconfig.h` not being found, this is because the precompiled WebKit did not install properly.

```bash
$ bun install
```

Check to see the command installed webkit, and you can manually look for `node_modules/bun-webkit-{platform}-{arch}`:

```bash
# this should reveal two directories. if not, something went wrong
$ echo node_modules/bun-webkit*
```

### macOS `library not found for -lSystem`

If you see this error when compiling, run:

```bash
$ xcode-select --install
```

## Arch Linux / Cannot find `libatomic.a`

Bun requires `libatomic` to be statically linked. On Arch Linux, it is only given as a shared library, but as a workaround you can symlink it to get the build working locally.

```bash
$ sudo ln -s /lib/libatomic.so /lib/libatomic.a
```

The built version of bun may not work on other systems if compiled this way.
