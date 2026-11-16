// Reference: bun build --compile
const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from "./lib.mjs"; say(tryit(() => { ns.x = 2; return "stored"; }), tryit(() => { ns.y = 2; return "stored"; }), tryit(() => delete ns.x), tryit(() => delete ns.nope), tryit(() => Object.defineProperty(ns, "x", { value: 3 })), tryit(() => Object.setPrototypeOf(ns, {})), tryit(() => Object.setPrototypeOf(ns, null)), ns.x);
/* Build errors:
error: TS2540: Cannot assign to 'x' because it is a read-only property.
error: TS2540: Cannot assign to 'y' because it is a read-only property.
error: TS2704: The operand of a 'delete' operator cannot be a read-only property.
*/
