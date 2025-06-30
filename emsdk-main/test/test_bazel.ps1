$ErrorActionPreference = 'Stop'

Set-Location bazel

bazel build //hello-world:hello-world-wasm
if (-not $?) { Exit $LastExitCode }

bazel build //hello-world:hello-world-wasm-simd
if (-not $?) { Exit $LastExitCode }

Set-Location test_external

bazel build //:hello-world-wasm
if (-not $?) { Exit $LastExitCode }

bazel build //long_command_line:long_command_line_wasm
if (-not $?) { Exit $LastExitCode }

bazel build //:hello-embind-wasm --compilation_mode dbg # debug
if (-not $?) { Exit $LastExitCode }

# Test use of the closure compiler
bazel build //:hello-embind-wasm --compilation_mode opt # release
if (-not $?) { Exit $LastExitCode }

Set-Location ..\test_secondary_lto_cache

bazel build //:hello-world-wasm
if (-not $?) { Exit $LastExitCode }

