// RUN(HELD): link
// RUN(LEFT): link
// OPTIONS: builtin-modules
// HELD: function {{*}}kind=Module
// LEFT-NOT: path="bun:sql"
// LEFT-NOT: path="node:dgram"
// LEFT-NOT: path="node:net"

// As TypeScript prints `globalThis.ownRegistry ??= {}`. The variable holds the global object and stands nowhere but in front of a name that the
// global object does not have for Bun, so nobody comes by `Bun` or `process` through it, and what lies behind their members stays out:
// `Bun.sql` alone loads bun:sql, and of what this program could hold the channel of `process.send` alone loads node:dgram and node:net.

// FILE: main.js
var _a;
(_a = globalThis).ownRegistry ?? (_a.ownRegistry = {});
export const registry = globalThis.ownRegistry;
