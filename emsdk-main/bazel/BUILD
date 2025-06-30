package(default_visibility = ["//visibility:public"])

filegroup(name = "empty")

platform(
    name = "platform_wasm",
    constraint_values = [
        "@platforms//cpu:wasm32",
        "@platforms//os:emscripten",
    ],
)

platform(
    name = "platform_wasi",
    constraint_values = [
        "@platforms//cpu:wasm32",
        "@platforms//os:wasi",
    ],
)
