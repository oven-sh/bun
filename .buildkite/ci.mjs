#!/usr/bin/env node
// Pipeline entry point invoked by the Buildkite `:pipeline:` step
// (`node .buildkite/ci.mjs`). Plain JavaScript, no .ts imports, so it starts
// under whatever node the CI agent happens to have installed. It hands the
// real generator (.buildkite/ci.ts) to the spec-pinned node via the shared
// shim — see scripts/build/ci/pinned-node.mjs for the why.

import { execUnderPinnedNode } from "../scripts/build/ci/pinned-node.mjs";

execUnderPinnedNode(".buildkite/ci.ts", process.argv.slice(2));
