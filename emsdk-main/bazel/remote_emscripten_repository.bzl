load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")
load(":emscripten_build_file.bzl", "EMSCRIPTEN_BUILD_FILE_CONTENT_TEMPLATE")
load(":revisions.bzl", "EMSCRIPTEN_TAGS")
load("//emscripten_toolchain:toolchain.bzl", "emscripten_cc_toolchain_config_rule")

def remote_emscripten_repository(
    name,
    bin_extension,
    **kwargs,
):
    """Imports an Emscripten from an http archive

    Args:
      name: A unique name for this Emscripten repository.
      bin_extension: Extension for the binaries in this Emscripten repository
      **kwargs: Args for http_archive. Refer to http_archive documentation for more info.
    """
    http_archive(
        name = name,
        build_file_content = EMSCRIPTEN_BUILD_FILE_CONTENT_TEMPLATE.format(bin_extension = bin_extension),
        **kwargs
    )

def emscripten_toolchain_name(name):
    return "emscripten_{}".format(name)

def _get_name_and_target(name):
    return name, ":" + name

def create_toolchains(name, repo_name, exec_compatible_with):
    """Creates toolchain definition for an Emscripten

    Register the toolchains defined by this macro via
    `register_toolchains("//<path-to-target>:cc-toolchain-wasm-<name>")`

    Args:
      name: A unique name for this Emscripten toolchain
      repo_name: The name of the Emscripten repository for this toolchain
      exec_compatible_with: Execute platform constraints for the Emscripten toolchain associated
        with this repository.
      **kwargs: Args for http_archive. Refer to http_archive documentation for more info.
    """
    common_files_name, common_files_target = _get_name_and_target("common_files_" + name)
    compiler_files_name, compiler_files_target = _get_name_and_target("compiler_files_" + name)
    linker_files_name, linker_files_target = _get_name_and_target("linker_files_" + name)
    ar_files_name, ar_files_target = _get_name_and_target("ar_files_" + name)
    all_files_name, all_files_target = _get_name_and_target("all_files_" + name)
    cc_wasm_name, cc_wasm_target = _get_name_and_target("cc-compiler-wasm-" + name)

    wasm_name = "wasm-" + name

    # These are file groups defined by the build_file_content on the Emscripten http_archive
    remote_repo = "@{}//".format(repo_name)
    repo_compiler_files_target = remote_repo + ":compiler_files"
    repo_linker_files_target = remote_repo + ":linker_files"
    repo_ar_files_target = remote_repo + ":ar_files"

    native.filegroup(
        name = common_files_name,
        srcs = [
            "@emscripten_cache//:emscripten_config",
            "@emsdk//emscripten_toolchain:env.sh",
            "@emsdk//emscripten_toolchain:env.bat",
            "@nodejs//:node_files",
        ],
    )

    native.filegroup(
        name = compiler_files_name,
        srcs = [
            "@emsdk//emscripten_toolchain:emcc.sh",
            "@emsdk//emscripten_toolchain:emcc.bat",
            repo_compiler_files_target,
            common_files_target,
        ],
    )

    native.filegroup(
        name = linker_files_name,
        srcs = [
            "@emsdk//emscripten_toolchain:emcc_link.sh",
            "@emsdk//emscripten_toolchain:emcc_link.bat",
            "link_wrapper.py",
            repo_linker_files_target,
            common_files_target,
        ],
    )

    native.filegroup(
        name = ar_files_name,
        srcs = [
            "@emsdk//emscripten_toolchain:emar.sh",
            "@emsdk//emscripten_toolchain:emar.bat",
            repo_ar_files_target,
            common_files_target,
        ],
    )

    native.filegroup(
        name = all_files_name,
        srcs = [
            ar_files_target,
            compiler_files_target,
            linker_files_target,
        ],
    )

    emscripten_cc_toolchain_config_rule(
        name = wasm_name,
        cpu = "wasm",
        em_config = "@emscripten_cache//:emscripten_config",
        emscripten_binaries = repo_compiler_files_target,
        nodejs_bin = "@nodejs//:node",
        script_extension = select({
            "@bazel_tools//src/conditions:host_windows": "bat",
            "//conditions:default": "sh",
        }),
    )

    native.cc_toolchain(
        name = cc_wasm_name,
        all_files = all_files_target,
        ar_files = ar_files_target,
        as_files = ":empty",
        compiler_files = compiler_files_target,
        dwp_files = ":empty",
        linker_files = linker_files_target,
        objcopy_files = ":empty",
        strip_files = ":empty",
        toolchain_config = wasm_name,
        toolchain_identifier = "emscripten-wasm-" + name,
    )

    native.toolchain(
        name = "cc-toolchain-wasm-" + name,
        target_compatible_with = ["@platforms//cpu:wasm32"],
        exec_compatible_with = exec_compatible_with,
        toolchain = cc_wasm_target,
        toolchain_type = "@bazel_tools//tools/cpp:toolchain_type",
    )

    native.cc_toolchain_suite(
        name = "everything-" + name,
        toolchains = {
            "wasm": cc_wasm_target,
            "wasm|emscripten": cc_wasm_target,
        },
    )
