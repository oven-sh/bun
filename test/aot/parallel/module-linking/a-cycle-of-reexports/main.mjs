// Reference: bun build --compile
const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { a } from "./foo.mjs"; say(typeof a);
/* Build errors:
error: TS100200: No matching export in "foo.mjs" for import "a"
error: TS100200: No matching export in "foo.mjs" for import "b"
error: TS100200: No matching export in "foo.mjs" for import "c"
*/
