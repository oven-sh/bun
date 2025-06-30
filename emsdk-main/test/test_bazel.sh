#!/usr/bin/env bash

echo "test bazel"

set -x
set -e

# Get the latest version number from emscripten-releases-tag.json.
VER=$(scripts/get_release_info.py emscripten-releases-tags.json latest)

# Based on the latest version number, get the commit hash for that version.
HASH=$(scripts/get_release_info.py emscripten-releases-tags.json hash ${VER})

FAILMSG="!!! scripts/update_bazel_workspace.py needs to be run !!!"

# Ensure the WORKSPACE file is up to date with the latest version.
grep ${VER} bazel/revisions.bzl || (echo ${FAILMSG} && false)
grep ${HASH} bazel/revisions.bzl || (echo ${FAILMSG} && false)
grep ${VER} bazel/MODULE.bazel || (echo ${FAILMSG} && false)

cd bazel
bazel build //hello-world:hello-world-wasm
bazel build //hello-world:hello-world-wasm-simd

cd test_external
bazel build //:hello-world-wasm
bazel build //long_command_line:long_command_line_wasm
bazel build //:hello-embind-wasm --compilation_mode dbg # debug

# Test use of the closure compiler
bazel build //:hello-embind-wasm --compilation_mode opt # release
# This function should not be minified if the externs file is loaded correctly.
grep "customJSFunctionToTestClosure" bazel-bin/hello-embind-wasm/hello-embind.js

cd ../test_secondary_lto_cache
bazel build //:hello-world-wasm
