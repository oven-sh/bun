load("@emsdk//emscripten_toolchain:wasm_rules.bzl", "wasm_cc_binary")

cc_binary(
    name = "hello-world",
    srcs = ["hello-world.cc"],
    linkopts = [
        "-sAUTO_NATIVE_LIBRARIES=0",
        "-flto",
    ],
)

wasm_cc_binary(
    name = "hello-world-wasm",
    cc_target = ":hello-world",
    outputs = [
        "hello-world.js",
        "hello-world.wasm",
    ],
)
