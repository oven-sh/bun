Configuring a development environment for Bun can take 10-30 minutes depending on your internet connection and computer speed. You will need ~10GB of free disk space for the repository and build artifacts.

If you are using Windows, please refer to [this guide](/docs/project/building-windows)

{% details summary="For Ubuntu users" %}
TL;DR: Ubuntu 22.04 is suggested.
Bun currently requires `glibc >=2.32` in development which means if you're on Ubuntu 20.04 (glibc == 2.31), you may likely meet `error: undefined symbol: __libc_single_threaded `. You need to take extra configurations. Also, according to this [issue](https://github.com/llvm/llvm-project/issues/97314), LLVM 16 is no longer maintained on Ubuntu 24.04 (noble). And instead, you might want `brew` to install LLVM 16 for your Ubuntu 24.04.
{% /details %}

## Install Dependencies

Using your system's package manager, install Bun's dependencies:

{% codetabs %}

```bash#macOS (Homebrew)
$ brew install automake ccache cmake coreutils gnu-sed go icu4c libiconv libtool ninja pkg-config rust ruby
```

```bash#Ubuntu/Debian
$ sudo apt install curl wget lsb-release software-properties-common cargo ccache cmake git golang libtool ninja-build pkg-config rustc ruby-full xz-utils
```

```bash#Arch
$ sudo pacman -S base-devel ccache cmake git go libiconv libtool make ninja pkg-config python rust sed unzip ruby
```

```bash#Fedora
$ sudo dnf install cargo ccache cmake git golang libtool ninja-build pkg-config rustc ruby libatomic-static libstdc++-static sed unzip which libicu-devel 'perl(Math::BigInt)'
```

```bash#openSUSE Tumbleweed
$ sudo zypper install go cmake ninja automake git rustup && rustup toolchain install stable
```

{% /codetabs %}

> **Note**: The Zig compiler is automatically installed and updated by the build scripts. Manual installation is not required.

Before starting, you will need to already have a release build of Bun installed, as we use our bundler to transpile and minify our code, as well as for code generation scripts.

{% codetabs %}

```bash#Native
$ curl -fsSL https://bun.sh/install | bash
```

```bash#npm
$ npm install -g bun
```

```bash#Homebrew
$ brew tap oven-sh/bun
$ brew install bun
```

{% /codetabs %}

## Install LLVM

Bun requires LLVM 16 (`clang` is part of LLVM). This version requirement is to match WebKit (precompiled), as mismatching versions will cause memory allocation failures at runtime. In most cases, you can install LLVM through your system package manager:

{% codetabs %}

```bash#macOS (Homebrew)
$ brew install llvm@18
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

```bash#openSUSE Tumbleweed
$ sudo zypper install clang16 lld16 llvm16
```

{% /codetabs %}

If none of the above solutions apply, you will have to install it [manually](https://github.com/llvm/llvm-project/releases/tag/llvmorg-16.0.6).

Make sure Clang/LLVM 16 is in your path:

```bash
$ which clang-16
```

If not, run this to manually add it:

{% codetabs %}

```bash#macOS (Homebrew)
# use fish_add_path if you're using fish
# use path+="$(brew --prefix llvm@16)/bin" if you are using zsh
$ export PATH="$(brew --prefix llvm@16)/bin:$PATH"
```

```bash#Arch
# use fish_add_path if you're using fish
$ export PATH="$PATH:/usr/lib/llvm16/bin"
```

{% /codetabs %}

> ⚠️ Ubuntu distributions (<= 20.04) may require installation of the C++ standard library independently. See the [troubleshooting section](#span-file-not-found-on-ubuntu) for more information.

## Building Bun

After cloning the repository, run the following command to run the first build. This may take a while as it will clone submodules and build dependencies.

```bash
$ bun setup
```

The binary will be located at `./build/bun-debug`. It is recommended to add this to your `$PATH`. To verify the build worked, let's print the version number on the development build of Bun.

```bash
$ build/bun-debug --version
x.y.z_debug
```

To rebuild, you can invoke `bun run build`

```bash
$ bun run build
```

These two scripts, `setup` and `build`, are aliases to do roughly the following:

```bash
$ ./scripts/setup.sh
$ cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
$ ninja -C build # 'bun run build' runs just this
```

Advanced users can pass CMake flags to customize the build.

## VSCode

VSCode is the recommended IDE for working on Bun, as it has been configured. Once opening, you can run `Extensions: Show Recommended Extensions` to install the recommended extensions for Zig and C++. ZLS is automatically configured.

If you use a different editor, make sure that you tell ZLS to use the automatically installed Zig compiler, which is located at `./.cache/zig/zig.exe`. The filename is `zig.exe` so that it works as expected on Windows, but it still works on macOS/Linux (it just has a surprising file extension).

We recommend adding `./build` to your `$PATH` so that you can run `bun-debug` in your terminal:

```sh
$ bun-debug
```

## Code generation scripts

Several code generation scripts are used during Bun's build process. These are run automatically when changes are made to certain files.

In particular, these are:

- `./src/codegen/generate-jssink.ts` -- Generates `build/codegen/JSSink.cpp`, `build/codegen/JSSink.h` which implement various classes for interfacing with `ReadableStream`. This is internally how `FileSink`, `ArrayBufferSink`, `"type": "direct"` streams and other code related to streams works.
- `./src/codegen/generate-classes.ts` -- Generates `build/codegen/ZigGeneratedClasses*`, which generates Zig & C++ bindings for JavaScriptCore classes implemented in Zig. In `**/*.classes.ts` files, we define the interfaces for various classes, methods, prototypes, getters/setters etc which the code generator reads to generate boilerplate code implementing the JavaScript objects in C++ and wiring them up to Zig
- `./src/codegen/bundle-modules.ts` -- Bundles built-in modules like `node:fs`, `bun:ffi` into files we can include in the final binary. In development, these can be reloaded without rebuilding Zig (you still need to run `bun run build`, but it re-reads the transpiled files from disk afterwards). In release builds, these are embedded into the binary.
- `./src/codegen/bundle-functions.ts` -- Bundles globally-accessible functions implemented in JavaScript/TypeScript like `ReadableStream`, `WritableStream`, and a handful more. These are used similarly to the builtin modules, but the output more closely aligns with what WebKit/Safari does for Safari's built-in functions so that we can copy-paste the implementations from WebKit as a starting point.

## Modifying ESM modules

Certain modules like `node:fs`, `node:stream`, `bun:sqlite`, and `ws` are implemented in JavaScript. These live in `src/js/{node,bun,thirdparty}` files and are pre-bundled using Bun.

## Release build

To compile a release build of Bun, run:

```bash
$ bun run build:release
```

The binary will be located at `./build-release/bun` and `./build-release/bun-profile`.

### Download release build from pull requests

To save you time spent building a release build locally, we provide a way to run release builds from pull requests. This is useful for manully testing changes in a release build before they are merged.

To run a release build from a pull request, you can use the `bun-pr` npm package:

```sh
bunx bun-pr pr-number
bunx bun-pr branch/branch-name
bunx bun-pr "https://github.com/oven-sh/bun/pull/1234566"
```

This will download the release build from the pull request and add it to `$PATH` as `bun-${pr-number}`. You can then run the build with `bun-${pr-number}`.

```sh
bun-1234566 --version
```

This works by downloading the release build from the GitHub Actions artifacts on the linked pull request. You may need the `gh` CLI installed to authenticate with GitHub.

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

## Building WebKit locally + Debug mode of JSC

{% callout %}

**TODO**: This is out of date. TLDR is pass `-DUSE_DEBUG_JSC=1` or `-DWEBKIT_DIR=...` to CMake. it will probably need more fiddling. ask @paperdave if you need this.

{% /callout %}

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

The issue may manifest when initially running `bun setup` as Clang being unable to compile a simple program:

```
The C++ compiler

  "/usr/bin/clang++-16"

is not able to compile a simple test program.
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

If you see an error on macOS when compiling `libarchive`, run:

```bash
$ brew install pkg-config
```

### macOS `library not found for -lSystem`

If you see this error when compiling, run:

```bash
$ xcode-select --install
```

## Cannot find `libatomic.a`

Bun defaults to linking `libatomic` statically, as not all systems have it. If you are building on a distro that does not have a static libatomic available, you can run the following command to enable dynamic linking:

```bash
$ bun setup -DUSE_STATIC_LIBATOMIC=OFF
```

The built version of Bun may not work on other systems if compiled this way.

## ccache conflicts with building TinyCC on macOS

If you run into issues with `ccache` when building TinyCC, try reinstalling ccache

```bash
brew uninstall ccache
brew install ccache
```
