// Hardcoded module "node:cluster"

const { isPrimary } = require("internal/cluster/isPrimary");
const child = isPrimary ? undefined : require("internal/cluster/child");
const cluster = child ?? require("internal/cluster/primary");
export default cluster;
