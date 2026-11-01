const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from "./empty.js"; import d from "./empty.js"; say(Object.keys(ns).join(), typeof d, JSON.stringify(d));
/* Build errors:
error: TS100200: No matching export in "empty.js" for import "default"
*/
