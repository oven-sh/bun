"""A templated build file for emscripten repositories"""

EMSCRIPTEN_BUILD_FILE_CONTENT_TEMPLATE = """
package(default_visibility = ['//visibility:public'])

filegroup(
    name = "all",
    srcs = glob(["**"]),
)

filegroup(
    name = "includes",
    srcs = glob([
        "emscripten/cache/sysroot/include/c++/v1/**",
        "emscripten/cache/sysroot/include/compat/**",
        "emscripten/cache/sysroot/include/**",
        "lib/clang/**/include/**",
    ]),
)

filegroup(
    name = "emcc_common",
    srcs = [
        "emscripten/emcc.py",
        "emscripten/embuilder.py",
        "emscripten/emscripten-version.txt",
        "emscripten/cache/sysroot_install.stamp",
        "emscripten/src/settings.js",
        "emscripten/src/settings_internal.js",
    ] + glob(
        include = [
            "emscripten/third_party/**",
            "emscripten/tools/**",
        ],
        exclude = [
            "**/__pycache__/**",
        ],
    ),
)

filegroup(
    name = "compiler_files",
    srcs = [
        "bin/clang{bin_extension}",
        "bin/clang++{bin_extension}",
        ":emcc_common",
        ":includes",
    ],
)

filegroup(
    name = "linker_files",
    srcs = [
        "bin/clang{bin_extension}",
        "bin/llvm-ar{bin_extension}",
        "bin/llvm-dwarfdump{bin_extension}",
        "bin/llvm-nm{bin_extension}",
        "bin/llvm-objcopy{bin_extension}",
        "bin/wasm-ctor-eval{bin_extension}",
        "bin/wasm-emscripten-finalize{bin_extension}",
        "bin/wasm-ld{bin_extension}",
        "bin/wasm-metadce{bin_extension}",
        "bin/wasm-opt{bin_extension}",
        "bin/wasm-split{bin_extension}",
        "bin/wasm2js{bin_extension}",
        ":emcc_common",
    ] + glob(
        include = [
            "emscripten/cache/sysroot/lib/**",
            "emscripten/node_modules/**",
            "emscripten/src/**",
        ],
    ),
)

filegroup(
    name = "ar_files",
    srcs = [
        "bin/llvm-ar{bin_extension}",
        "emscripten/emar.py",
        "emscripten/emscripten-version.txt",
        "emscripten/src/settings.js",
        "emscripten/src/settings_internal.js",
    ] + glob(
        include = [
            "emscripten/tools/**",
        ],
        exclude = [
            "**/__pycache__/**",
        ],
    ),
)
"""
