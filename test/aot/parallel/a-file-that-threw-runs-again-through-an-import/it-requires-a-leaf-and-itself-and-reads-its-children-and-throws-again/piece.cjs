globalThis.bodies = (globalThis.bodies ?? 0) + 1;
require("./leaf.cjs");
require("./piece.cjs");
globalThis.seen = (globalThis.seen ?? "") + module.children.length;
(globalThis.runs ??= []).push(module);
throw new Error("gives up " + globalThis.bodies);
