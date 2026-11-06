// main.mjs imports ma.mjs, ma.mjs imports mb.cjs, and mb.cjs requires ma.mjs: the body of ma.mjs runs there and then, as under `bun run`, in front of the rest of mb.cjs.
// Its imports from mb.cjs are what mb.cjs has exported by then. main.mjs runs inside that `require` too: nothing else of its graph is left to load.
import { early, late } from "./ma.mjs";
console.log("main:", early, late());
