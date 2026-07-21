#!/usr/bin/env node
// Bake/machine entry point invoked by the ensure-image steps
// (`node ./scripts/machine.mjs create-image ...`). Plain JavaScript, no .ts
// imports, so it starts under whatever node the bake agent has installed.
// It hands the real orchestrator (scripts/machine.ts) to the spec-pinned
// node via the shared shim — see scripts/build/ci/pinned-node.mjs.

import { execUnderPinnedNode } from "./build/ci/pinned-node.mjs";

execUnderPinnedNode("scripts/machine.ts", process.argv.slice(2));
