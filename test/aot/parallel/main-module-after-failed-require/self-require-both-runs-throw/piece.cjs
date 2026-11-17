globalThis.bodies = (globalThis.bodies ?? 0) + 1;
require("./piece.cjs");
(globalThis.runs ??= []).push(module);
throw new Error("gives up " + globalThis.bodies);
