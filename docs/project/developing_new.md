Configuring a development environment for Bun usually takes 10-30 minutes depending on your internet connection and computer speed. You will need ~10GB of free disk space for the repository and build artifacts.

## Install Dependencies

Using your system's package manager, install Bun's dependencies:

{% codetabs %}

```bash#macOS (Homebrew)
$ brew install automake cmake coreutils esbuild gnu-sed go libiconv libtool llvm@15 ninja pkg-config rust
```

```bash#Ubuntu/Debian
$ sudo apt install cargo clang-15 cmake curl esbuild git golang libtool lld-15 llvm-15 ninja-build pkg-config rustc
```

```bash#Arch Linux
$ pacman -S base-devel ccache clang cmake esbuild git git go libiconv libtool lld llvm make ninja pkg-config python rust sed unzip
```

{% /codetabs %}

## Install Zig

Zig can installed either with our npm package [`@oven/zig`](https://www.npmjs.com/package/@oven/zig), or using [zigup](https://github.com/marler8997/zigup).

```
$ bun install -g @oven/zig
$ zigup master
```

## Building

After cloning the repository, prepare bun to be built:

```bash
$ make setup
```

Then to build Bun:

```bash
$ make dev
```

The binary will be located at `packages/debug-bun-{platform}-{arch}/bun/bun-debug`. It is recommended to add this to your `$PATH`:

## JavaScript builtins

When you change anything in `src/bun.js/builtins/js/*`, run this:

```bash
$ make clean-bindings generate-builtins && make bindings -j$(nproc)
```

That inlines the JavaScript code into C++ headers using the same builtins generator script that Safari uses.
