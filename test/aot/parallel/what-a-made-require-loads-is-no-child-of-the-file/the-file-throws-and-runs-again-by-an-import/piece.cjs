globalThis.bodies = (globalThis.bodies ?? 0) + 1;
const made = require("node:module").createRequire(__filename);
made("./piece.cjs");
(globalThis.runs ??= []).push(module);
throw new Error("gives up " + globalThis.bodies);
