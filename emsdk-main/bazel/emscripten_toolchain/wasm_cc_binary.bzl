"""wasm_cc_binary rule for compiling C++ targets to WebAssembly.
"""

def _wasm_transition_impl(settings, attr):
    _ignore = (settings, attr)

    features = list(settings["//command_line_option:features"])
    linkopts = list(settings["//command_line_option:linkopt"])

    if attr.threads == "emscripten":
        # threads enabled
        features.append("use_pthreads")
    elif attr.threads == "off":
        # threads disabled
        features.append("-use_pthreads")

    if attr.exit_runtime == True:
        features.append("exit_runtime")

    if attr.backend == "llvm":
        features.append("llvm_backend")
    elif attr.backend == "emscripten":
        features.append("-llvm_backend")

    if attr.simd:
        features.append("wasm_simd")

    platform = "@emsdk//:platform_wasm"
    if attr.standalone:
        platform = "@emsdk//:platform_wasi"
        features.append("wasm_standalone")

    return {
        "//command_line_option:compiler": "emscripten",
        "//command_line_option:cpu": "wasm",
        "//command_line_option:features": features,
        "//command_line_option:dynamic_mode": "off",
        "//command_line_option:linkopt": linkopts,
        "//command_line_option:platforms": [platform],
        # This is hardcoded to an empty cc_library because the malloc library
        # is implicitly added by the emscripten toolchain
        "//command_line_option:custom_malloc": "@emsdk//emscripten_toolchain:malloc",
    }

_wasm_transition = transition(
    implementation = _wasm_transition_impl,
    inputs = [
        "//command_line_option:features",
        "//command_line_option:linkopt",
    ],
    outputs = [
        "//command_line_option:compiler",
        "//command_line_option:cpu",
        "//command_line_option:features",
        "//command_line_option:dynamic_mode",
        "//command_line_option:linkopt",
        "//command_line_option:platforms",
        "//command_line_option:custom_malloc",
    ],
)

_ALLOW_OUTPUT_EXTNAMES = [
    ".js",
    ".wasm",
    ".wasm.map",
    ".worker.js",
    ".js.mem",
    ".data",
    ".fetch.js",
    ".js.symbols",
    ".wasm.debug.wasm",
    ".html",
    ".aw.js",
]

_WASM_BINARY_COMMON_ATTRS = {
    "backend": attr.string(
        default = "_default",
        values = ["_default", "emscripten", "llvm"],
    ),
    "cc_target": attr.label(
        cfg = _wasm_transition,
        mandatory = True,
    ),
    "exit_runtime": attr.bool(
        default = False,
    ),
    "threads": attr.string(
        default = "_default",
        values = ["_default", "emscripten", "off"],
    ),
    "simd": attr.bool(
        default = False,
    ),
    "standalone": attr.bool(
        default = False,
    ),
    "_allowlist_function_transition": attr.label(
        default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
    ),
    "_wasm_binary_extractor": attr.label(
        executable = True,
        allow_files = True,
        cfg = "exec",
        default = Label("@emsdk//emscripten_toolchain:wasm_binary"),
    ),
}

def _wasm_cc_binary_impl(ctx):
    args = ctx.actions.args()
    cc_target = ctx.attr.cc_target[0]

    for output in ctx.outputs.outputs:
        valid_extname = False
        for allowed_extname in _ALLOW_OUTPUT_EXTNAMES:
            if output.path.endswith(allowed_extname):
                valid_extname = True
                break
        if not valid_extname:
            fail("Invalid output '{}'. Allowed extnames: {}".format(output.basename, ", ".join(_ALLOW_OUTPUT_EXTNAMES)))

    args.add_all("--archive", ctx.files.cc_target)
    args.add_joined("--outputs", ctx.outputs.outputs, join_with = ",")

    ctx.actions.run(
        inputs = ctx.files.cc_target,
        outputs = ctx.outputs.outputs,
        arguments = [args],
        executable = ctx.executable._wasm_binary_extractor,
    )

    return [
        DefaultInfo(
            files = depset(ctx.outputs.outputs),
            # This is needed since rules like web_test usually have a data
            # dependency on this target.
            data_runfiles = ctx.runfiles(transitive_files = depset(ctx.outputs.outputs)),
        ),
        OutputGroupInfo(_wasm_tar = cc_target.files),
    ]

def _wasm_cc_binary_legacy_impl(ctx):
    cc_target = ctx.attr.cc_target[0]
    outputs = [
        ctx.outputs.loader,
        ctx.outputs.wasm,
        ctx.outputs.map,
        ctx.outputs.mem,
        ctx.outputs.fetch,
        ctx.outputs.worker,
        ctx.outputs.data,
        ctx.outputs.symbols,
        ctx.outputs.dwarf,
        ctx.outputs.html,
        ctx.outputs.audio_worklet,
    ]

    args = ctx.actions.args()
    args.add("--allow_empty_outputs")
    args.add_all("--archive", ctx.files.cc_target)
    args.add_joined("--outputs", outputs, join_with = ",")

    ctx.actions.run(
        inputs = ctx.files.cc_target,
        outputs = outputs,
        arguments = [args],
        executable = ctx.executable._wasm_binary_extractor,
    )

    return [
        DefaultInfo(
            executable = ctx.outputs.wasm,
            files = depset(outputs),
            # This is needed since rules like web_test usually have a data
            # dependency on this target.
            data_runfiles = ctx.runfiles(transitive_files = depset(outputs)),
        ),
        OutputGroupInfo(_wasm_tar = cc_target.files),
    ]

_wasm_cc_binary = rule(
    implementation = _wasm_cc_binary_impl,
    attrs = dict(
        _WASM_BINARY_COMMON_ATTRS,
        outputs = attr.output_list(
            allow_empty = False,
            mandatory = True,
        ),
    ),
)

def _wasm_binary_legacy_outputs(name, cc_target):
    basename = cc_target.name
    basename = basename.split(".")[0]
    outputs = {
        "loader": "{}/{}.js".format(name, basename),
        "wasm": "{}/{}.wasm".format(name, basename),
        "map": "{}/{}.wasm.map".format(name, basename),
        "mem": "{}/{}.js.mem".format(name, basename),
        "fetch": "{}/{}.fetch.js".format(name, basename),
        "worker": "{}/{}.worker.js".format(name, basename),
        "data": "{}/{}.data".format(name, basename),
        "symbols": "{}/{}.js.symbols".format(name, basename),
        "dwarf": "{}/{}.wasm.debug.wasm".format(name, basename),
        "html": "{}/{}.html".format(name, basename),
        "audio_worklet": "{}/{}.aw.js".format(name, basename)
    }

    return outputs

_wasm_cc_binary_legacy = rule(
    implementation = _wasm_cc_binary_legacy_impl,
    attrs = _WASM_BINARY_COMMON_ATTRS,
    outputs = _wasm_binary_legacy_outputs,
)

# Wraps a C++ Blaze target, extracting the appropriate files.
#
# This rule will transition to the emscripten toolchain in order
# to build the the cc_target as a WebAssembly binary.
#
# Args:
#   name: The name of the rule.
#   cc_target: The cc_binary or cc_library to extract files from.
def wasm_cc_binary(outputs = None, **kwargs):
    # for backwards compatibility if no outputs are set the deprecated
    # implementation is used.
    if not outputs:
        _wasm_cc_binary_legacy(**kwargs)
    else:
        _wasm_cc_binary(outputs = outputs, **kwargs)
