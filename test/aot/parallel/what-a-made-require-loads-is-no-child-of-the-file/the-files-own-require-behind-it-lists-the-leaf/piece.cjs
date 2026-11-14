globalThis.bodies = (globalThis.bodies ?? 0) + 1;
const made = require("node:module").createRequire(__filename);
made("./leaf.cjs");
require("./leaf.cjs");
(globalThis.runs ??= []).push(module);
if (globalThis.bodies === 1) throw new Error("gives up " + globalThis.bodies);
