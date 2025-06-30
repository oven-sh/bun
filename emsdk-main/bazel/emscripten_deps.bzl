load(":remote_emscripten_repository.bzl", "remote_emscripten_repository")
load(":revisions.bzl", "EMSCRIPTEN_TAGS")

def _parse_version(v):
    return [int(u) for u in v.split(".")]

def _empty_repository_impl(ctx):
    ctx.file("MODULE.bazel", """module(name = "{}")""".format(ctx.name))
    ctx.file("BUILD.bazel", "")

_empty_repository = repository_rule(
    implementation = _empty_repository_impl,
)

def emscripten_repo_name(name):
    return "emscripten_bin_{}".format(name)

def _emscripten_deps_impl(ctx):
    version = None

    for mod in ctx.modules:
        for config in mod.tags.config:
            if config.version and version != None:
                fail("More than one emscripten version specified!")
            version = config.version
    if version == None:
        version = "latest"

    if version == "latest":
        version = reversed(sorted(EMSCRIPTEN_TAGS.keys(), key = _parse_version))[0]

    revision = EMSCRIPTEN_TAGS[version]

    emscripten_url = "https://storage.googleapis.com/webassembly/emscripten-releases-builds/{}/{}/wasm-binaries{}.{}"

    remote_emscripten_repository(
        name = emscripten_repo_name("linux"),
        bin_extension = "",
        sha256 = revision.sha_linux,
        strip_prefix = "install",
        type = "tar.xz",
        url = emscripten_url.format("linux", revision.hash, "", "tar.xz"),
    )

    # Not all versions have a linux/arm64 release: https://github.com/emscripten-core/emsdk/issues/547
    if hasattr(revision, "sha_linux_arm64"):
        remote_emscripten_repository(
            name = emscripten_repo_name("linux_arm64"),
            bin_extension = "",
            sha256 = revision.sha_linux_arm64,
            strip_prefix = "install",
            type = "tar.xz",
            url = emscripten_url.format("linux", revision.hash, "-arm64", "tar.xz"),
        )
    else:
        _empty_repository(
            name = emscripten_repo_name("linux_arm64"),
        )

    remote_emscripten_repository(
        name = emscripten_repo_name("mac"),
        bin_extension = "",
        sha256 = revision.sha_mac,
        strip_prefix = "install",
        type = "tar.xz",
        url = emscripten_url.format("mac", revision.hash, "", "tar.xz"),
    )

    remote_emscripten_repository(
        name = emscripten_repo_name("mac_arm64"),
        bin_extension = "",
        sha256 = revision.sha_mac_arm64,
        strip_prefix = "install",
        type = "tar.xz",
        url = emscripten_url.format("mac", revision.hash, "-arm64", "tar.xz"),
    )

    remote_emscripten_repository(
        name = emscripten_repo_name("win"),
        bin_extension = ".exe",
        sha256 = revision.sha_win,
        strip_prefix = "install",
        type = "zip",
        url = emscripten_url.format("win", revision.hash, "", "zip"),
    )

emscripten_deps = module_extension(
    tag_classes = {
        "config": tag_class(
            attrs = {
                "version": attr.string(
                    doc = "Version to use. 'latest' to use latest.",
                    values = ["latest"] + EMSCRIPTEN_TAGS.keys(),
                ),
            },
        ),
    },
    implementation = _emscripten_deps_impl,
)
