globalThis.bodies = (globalThis.bodies ?? 0) + 1;
require("./second.cjs");
(globalThis.runs ??= []).push(module);
if (globalThis.bodies === 1) throw new Error("gives up " + globalThis.bodies);
