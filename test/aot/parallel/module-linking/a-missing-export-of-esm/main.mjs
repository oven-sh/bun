// Reference: bun build --compile
const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { nope } from "./lib.mjs"; say(typeof nope);
/* Build errors:
error: TS100200: No matching export in "lib.mjs" for import "nope"
*/
