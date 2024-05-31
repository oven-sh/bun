// Hardcoded module "node:cluster"

const primary = require("internal/cluster/primary");
const child = require("internal/cluster/child");

const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const NumberParseInt = Number.parseInt;

const childOrPrimary = ObjectPrototypeHasOwnProperty.$call(process.env, "NODE_UNIQUE_ID");
const cluster = childOrPrimary ? child : primary;
export default cluster;
