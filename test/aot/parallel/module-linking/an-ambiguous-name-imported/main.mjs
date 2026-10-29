// Reference: bun build --compile
const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { x } from "./star.mjs"; say(x);
/* Build errors:
error: TS100201: Ambiguous import "x" has multiple matching exports
*/
