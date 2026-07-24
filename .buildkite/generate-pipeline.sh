#!/bin/sh
# Standalone entry point for pipeline generation, for when the Buildkite step
# is changed to run this directly (see scripts/build/ci/CLAUDE.md). Today
# the step runs `node .buildkite/ci.mjs`, which does the same thing; both
# hand off to the shared shim, scripts/build/ci/pinned-node.mjs, which
# fetches the spec-pinned Node.js (cached) and runs .buildkite/ci.ts under
# it. Any node that can run plain .mjs will do to start it.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"
exec node .buildkite/ci.mjs "$@"
