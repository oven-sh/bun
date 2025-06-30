load("@rules_cc//cc:defs.bzl", "cc_binary")
load("//emscripten_toolchain:wasm_rules.bzl", "wasm_cc_binary")

cc_binary(
    name = "hello-world",
    srcs = ["hello-world.cc"],
)

cc_binary(
    name = "hello-world-simd",
    srcs = ["hello-world-simd.cc"],
)

wasm_cc_binary(
    name = "hello-world-wasm",
    cc_target = ":hello-world",
)

wasm_cc_binary(
    name = "hello-world-wasm-simd",
    cc_target = ":hello-world-simd",
    simd = True,
)
