Configuring a development environment for Bun can take 10-30 minutes depending on your internet connection and computer speed. You will need ~10GB of free disk space for the repository and build artifacts.

If you are using Windows, please refer to [this guide](https://bun.sh/docs/project/building-windows)

## Install Dependencies

Using your system's package manager, install Bun's dependencies:

{% codetabs group="os" %}

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
$ sudo zypper install go cmake ninja automake git icu rustup && rustup toolchain install stable
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

Bun requires LLVM 18 (`clang` is part of LLVM). This version requirement is to match WebKit (precompiled), as mismatching versions will cause memory allocation failures at runtime. In most cases, you can install LLVM through your system package manager:

{% codetabs group="os" %}

```bash#macOS (Homebrew)
$ brew install llvm@18
```

```bash#Ubuntu/Debian
$ # LLVM has an automatic installation script that is compatible with all versions of Ubuntu
$ wget https://apt.llvm.org/llvm.sh -O - | sudo bash -s -- 18 all
```

```bash#Arch
$ sudo pacman -S llvm clang lld
```

```bash#Fedora
$ sudo dnf install llvm18 clang18 lld18-devel
```

```bash#openSUSE Tumbleweed
$ sudo zypper install clang18 lld18 llvm18
```

{% /codetabs %}

If none of the above solutions apply, you will have to install it [manually](https://github.com/llvm/llvm-project/releases/tag/llvmorg-18.1.8).

Make sure Clang/LLVM 18 is in your path:

```bash
$ which clang-18
```

If not, run this to manually add it:

{% codetabs group="os" %}

```bash#macOS (Homebrew)
# use fish_add_path if you're using fish
# use path+="$(brew --prefix llvm@18)/bin" if you are using zsh
$ export PATH="$(brew --prefix llvm@18)/bin:$PATH"
```

```bash#Arch
# use fish_add_path if you're using fish
$ export PATH="$PATH:/usr/lib/llvm18/bin"
```

{% /codetabs %}

> ⚠️ Ubuntu distributions (<= 20.04) may require installation of the C++ standard library independently. See the [troubleshooting section](#span-file-not-found-on-ubuntu) for more information.

## Building Bun

After cloning the repository, run the following command to build. This may take a while as it will clone submodules and build dependencies.

```bash
$ bun run build
```

The binary will be located at `./build/debug/bun-debug`. It is recommended to add this to your `$PATH`. To verify the build worked, let's print the version number on the development build of Bun.

```bash
$ build/debug/bun-debug --version
x.y.z_debug
```

## VSCode

VSCode is the recommended IDE for working on Bun, as it has been configured. Once opening, you can run `Extensions: Show Recommended Extensions` to install the recommended extensions for Zig and C++. ZLS is automatically configured.

If you use a different editor, make sure that you tell ZLS to use the automatically installed Zig compiler, which is located at `./vendor/zig/zig.exe`. The filename is `zig.exe` so that it works as expected on Windows, but it still works on macOS/Linux (it just has a surprising file extension).

We recommend adding `./build/debug` to your `$PATH` so that you can run `bun-debug` in your terminal:

```sh
$ bun-debug
```

## Code generation scripts

Several code generation scripts are used during Bun's build process. These are run automatically when changes are made to certain files.

In particular, these are:

- `./src/codegen/generate-jssink.ts` -- Generates `build/debug/codegen/JSSink.cpp`, `build/debug/codegen/JSSink.h` which implement various classes for interfacing with `ReadableStream`. This is internally how `FileSink`, `ArrayBufferSink`, `"type": "direct"` streams and other code related to streams works.
- `./src/codegen/generate-classes.ts` -- Generates `build/debug/codegen/ZigGeneratedClasses*`, which generates Zig & C++ bindings for JavaScriptCore classes implemented in Zig. In `**/*.classes.ts` files, we define the interfaces for various classes, methods, prototypes, getters/setters etc which the code generator reads to generate boilerplate code implementing the JavaScript objects in C++ and wiring them up to Zig
- `./src/codegen/bundle-modules.ts` -- Bundles built-in modules like `node:fs`, `bun:ffi` into files we can include in the final binary. In development, these can be reloaded without rebuilding Zig (you still need to run `bun run build`, but it re-reads the transpiled files from disk afterwards). In release builds, these are embedded into the binary.
- `./src/codegen/bundle-functions.ts` -- Bundles globally-accessible functions implemented in JavaScript/TypeScript like `ReadableStream`, `WritableStream`, and a handful more. These are used similarly to the builtin modules, but the output more closely aligns with what WebKit/Safari does for Safari's built-in functions so that we can copy-paste the implementations from WebKit as a starting point.

## Modifying ESM modules

Certain modules like `node:fs`, `node:stream`, `bun:sqlite`, and `ws` are implemented in JavaScript. These live in `src/js/{node,bun,thirdparty}` files and are pre-bundled using Bun.

## Release build

To compile a release build of Bun, run:

```bash
$ bun run build:release
```

The binary will be located at `./build/release/bun` and `./build/release/bun-profile`.

### Download release build from pull requests

To save you time spent building a release build locally, we provide a way to run release builds from pull requests. This is useful for manually testing changes in a release build before they are merged.

To run a release build from a pull request, you can use the `bun-pr` npm package:

```sh
bunx bun-pr <pr-number>
bunx bun-pr <branch-name>
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

WebKit is not cloned by default (to save time and disk space). To clone and build WebKit locally, run:

```bash
# Clone WebKit into ./vendor/WebKit
$ git clone https://github.com/oven-sh/WebKit vendor/WebKit

# Make a debug build of JSC. This will output build artifacts in ./vendor/WebKit/WebKitBuild/Debug
# Optionally, you can use `make jsc` for a release build
$ make jsc-debug

# Build bun with the local JSC build
$ bun run build:local
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

  "/usr/bin/clang++-18"

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

### Cannot find `libatomic.a`

Bun defaults to linking `libatomic` statically, as not all systems have it. If you are building on a distro that does not have a static libatomic available, you can run the following command to enable dynamic linking:

```bash
$ bun run build -DUSE_STATIC_LIBATOMIC=OFF
```

The built version of Bun may not work on other systems if compiled this way.

### ccache conflicts with building TinyCC on macOS

If you run into issues with `ccache` when building TinyCC, try reinstalling ccache

```bash
brew uninstall ccache
brew install ccache
```

## Using bun-debug

- Disable logging: `BUN_DEBUG_QUIET_LOGS=1 bun-debug ...` (to disable all debug logging)
- Enable logging for a specific zig scope: `BUN_DEBUG_EventLoop=1 bun-debug ...` (to allow `std.log.scoped(.EventLoop)`)
- Bun transpiles every file it runs, to see the actual executed source in a debug build find it in `/tmp/bun-debug-src/...path/to/file`, for example the transpiled version of `/home/bun/index.ts` would be in `/tmp/bun-debug-src/home/bun/index.ts`
