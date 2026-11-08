// What the compiler reads in place of src/js/node/cluster.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 ec801b81aa362b6a6f390f3cc1880cbd1e81b2c7b07c5af0b79a5f900e995eb9.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

// Hardcoded module "node:cluster"

const { isPrimary, loadChild } = require("internal/cluster/isPrimary");
const cluster = isPrimary ? require("internal/cluster/primary") : loadChild();
// Bun lists a member from when it is first read, and loading this module has always read this one.
const { isMainThread: _isMainThread } = Bun;
export default cluster;
