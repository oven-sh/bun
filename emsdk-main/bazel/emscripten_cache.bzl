BUILD_FILE_CONTENT_TEMPLATE = """
package(default_visibility = ['//visibility:public'])
exports_files(['emscripten_config'])
"""

EMBUILDER_CONFIG_TEMPLATE = """
CACHE = '{cache}'
BINARYEN_ROOT = '{binaryen_root}'
LLVM_ROOT = '{llvm_root}'
"""

def get_root_and_script_ext(repository_ctx):
    if repository_ctx.os.name.startswith("linux"):
        if "amd64" in repository_ctx.os.arch or "x86_64" in repository_ctx.os.arch:
            return (repository_ctx.path(Label("@emscripten_bin_linux//:BUILD.bazel")).dirname, "")
        elif "aarch64" in repository_ctx.os.arch:
            return (repository_ctx.path(Label("@emscripten_bin_linux_arm64//:BUILD.bazel")).dirname, "")
        else:
            fail("Unsupported architecture for Linux")
    elif repository_ctx.os.name.startswith("mac"):
        if "amd64" in repository_ctx.os.arch or "x86_64" in repository_ctx.os.arch:
            return (repository_ctx.path(Label("@emscripten_bin_mac//:BUILD.bazel")).dirname, "")
        elif "aarch64" in repository_ctx.os.arch:
            return (repository_ctx.path(Label("@emscripten_bin_mac_arm64//:BUILD.bazel")).dirname, "")
        else:
            fail("Unsupported architecture for MacOS")
    elif repository_ctx.os.name.startswith("windows"):
        return (repository_ctx.path(Label("@emscripten_bin_win//:BUILD.bazel")).dirname, ".bat")
    else:
        fail("Unsupported operating system")

def _emscripten_cache_repository_impl(repository_ctx):
    # Read the default emscripten configuration file
    default_config = repository_ctx.read(
        repository_ctx.path(
            Label("@emsdk//emscripten_toolchain:default_config"),
        ),
    )

    if repository_ctx.attr.targets or repository_ctx.attr.configuration:
        root, script_ext = get_root_and_script_ext(repository_ctx)
        llvm_root = root.get_child("bin")
        cache = repository_ctx.path("cache")

        # Create configuration file
        embuilder_config_content = EMBUILDER_CONFIG_TEMPLATE.format(
            cache = cache,
            binaryen_root = root,
            llvm_root = llvm_root,
        )
        repository_ctx.file("embuilder_config", embuilder_config_content)
        embuilder_config_path = repository_ctx.path("embuilder_config")
        embuilder_path = "{}{}".format(root.get_child("emscripten").get_child("embuilder"), script_ext)

        # Prepare the command line
        if repository_ctx.attr.targets:
            targets = repository_ctx.attr.targets
        else:
            # If no targets are requested, build everything
            targets = ["ALL"]
        flags = ["--em-config", embuilder_config_path] + repository_ctx.attr.configuration
        embuilder_args = [embuilder_path] + flags + ["build"] + targets

        # Run embuilder
        repository_ctx.report_progress("Building secondary cache")
        result = repository_ctx.execute(
            embuilder_args,
            quiet = True,
            environment = {
                "EM_IGNORE_SANITY": "1",
                "EM_NODE_JS": "empty",
            },
        )
        if result.return_code != 0:
            fail("Embuilder exited with a non-zero return code")

        # Override Emscripten's cache with the secondary cache
        default_config += "CACHE = '{}'\n".format(cache)

    # Create the configuration file for the toolchain and export
    repository_ctx.file("emscripten_config", default_config)
    repository_ctx.file("BUILD.bazel", BUILD_FILE_CONTENT_TEMPLATE)

_emscripten_cache_repository = repository_rule(
    implementation = _emscripten_cache_repository_impl,
    attrs = {
        "configuration": attr.string_list(),
        "targets": attr.string_list(),
    },
)

def _emscripten_cache_impl(ctx):
    all_configuration = []
    all_targets = []
    for mod in ctx.modules:
        for configuration in mod.tags.configuration:
            all_configuration += configuration.flags
        for targets in mod.tags.targets:
            all_targets += targets.targets

    _emscripten_cache_repository(
        name = "emscripten_cache",
        configuration = all_configuration,
        targets = all_targets,
    )

emscripten_cache = module_extension(
    tag_classes = {
        "configuration": tag_class(attrs = {"flags": attr.string_list()}),
        "targets": tag_class(attrs = {"targets": attr.string_list()}),
    },
    implementation = _emscripten_cache_impl,
)
