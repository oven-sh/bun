// main.mjs imports ma.mjs, ma.mjs imports mb.cjs, and mb.cjs requires ma.mjs: the body of ma.mjs runs there and then, as under `bun run`, in front of the rest of mb.cjs.
// Its default import has no value yet. `bun run` shows it the exports object as it is by then. An executable throws the ReferenceError of a binding that is read too early.
import { early, late } from "./ma.mjs";
console.log("main:", early, late());
