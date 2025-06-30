# Bazel Emscripten toolchain

## Setup Instructions

Support for depending on emsdk with a WORKSPACE file was removed and last available in [emsdk version 4.0.6](https://github.com/emscripten-core/emsdk/tree/24fc909c0da13ef641d5ae75e89b5a97f25e37aa). Now we only support inclusion as a bzlmod module.

In your `MODULE.bazel` file, put:
```starlark
emsdk_version = "4.0.6"
bazel_dep(name = "emsdk", version = emsdk_version)
git_override(
    module_name = "emsdk",
    remote = "https://github.com/emscripten-core/emsdk.git",
    strip_prefix = "bazel",
    tag = emsdk_version,
)
```

You can use a different version of this SDK by changing it in your `MODULE.bazel` file. The Emscripten version is by default the same as the SDK version, but you can use a different one as well by adding to your `MODULE.bazel`:

```
emscripten_deps = use_extension(
    "@emsdk//:emscripten_deps.bzl",
    "emscripten_deps",
)
emscripten_deps.config(version = "4.0.1")
```

## Building

Put the following line into your `.bazelrc`:

```
build --incompatible_enable_cc_toolchain_resolution
```

Then write a new rule wrapping your `cc_binary`.

```starlark
load("@rules_cc//cc:defs.bzl", "cc_binary")
load("@emsdk//emscripten_toolchain:wasm_rules.bzl", "wasm_cc_binary")

cc_binary(
    name = "hello-world",
    srcs = ["hello-world.cc"],
)

wasm_cc_binary(
    name = "hello-world-wasm",
    cc_target = ":hello-world",
)
```

Now you can run `bazel build :hello-world-wasm`. The result of this build will
be the individual files produced by emscripten. Note that some of these files
may be empty. This is because bazel has no concept of optional outputs for
rules.

`wasm_cc_binary` uses transition to use emscripten toolchain on `cc_target`
and all of its dependencies, and does not require amending `.bazelrc`. This
is the preferred way, since it also unpacks the resulting tarball.

The Emscripten cache shipped by default does not include LTO, 64-bit or PIC
builds of the system libraries and ports. If you wish to use these features you
will need to declare the cache in your `MODULE.bazel` as follows. Note
that the configuration consists of the same flags that can be passed to
embuilder. If `targets` is not set, all system libraries and ports will be
built, i.e., the `ALL` option to embuilder.

```starlark
emscripten_cache = use_extension(
    "@emsdk//:emscripten_cache.bzl",
    "emscripten_cache",
)
emscripten_cache.configuration(flags = ["--lto"])
emscripten_cache.targets(targets = [
    "crtbegin",
    "libprintf_long_double-debug",
    "libstubs-debug",
    "libnoexit",
    "libc-debug",
    "libdlmalloc",
    "libcompiler_rt",
    "libc++-noexcept",
    "libc++abi-debug-noexcept",
    "libsockets"
])
```

See `test_external/` for an example using [embind](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html).
