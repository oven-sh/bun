// main.mjs imports ma.mjs, ma.mjs imports mb.cjs, and mb.cjs requires ma.mjs: the body of ma.mjs runs there and then, as under `bun run`, in front of the rest of mb.cjs.
// Its imports from mb.cjs are what mb.cjs has exported by then. `bun run` runs main.mjs inside that `require` too. An executable runs it behind mb.cjs.
import { early, late } from "./ma.mjs";
console.log("main:", early, late());
