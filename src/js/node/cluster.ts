// Hardcoded module "node:cluster"

const { isPrimary, loadChild } = require("internal/cluster/isPrimary");
const cluster = isPrimary ? require("internal/cluster/primary") : loadChild();
// Bun lists a member from when it is first read, and loading this module has always read this one.
const { isMainThread: _isMainThread } = Bun;
export default cluster;
