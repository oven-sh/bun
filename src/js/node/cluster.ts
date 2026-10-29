// Hardcoded module "node:cluster"

const { isPrimary, loadChild } = require("internal/cluster/isPrimary");
export default isPrimary ? require("internal/cluster/primary") : loadChild();
