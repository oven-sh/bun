// tools.mjs imports what it is handed. setup.cjs says nothing of its kind, and nothing requires it: it is read as an import reads it.
import * as tools from "./tools.mjs";
const loaded = await tools.load("./setup.cjs");
console.log(globalThis.madeUpKind, "|", Object.keys(loaded).join(","), Object.prototype.toString.call(loaded));
