const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import "./other.mjs"; say(typeof module, typeof exports, typeof require, typeof __filename, typeof __dirname, typeof this, typeof import.meta.url, typeof import.meta.require);
/* Build errors:
error: TS100106: Cannot use import statement with CommonJS-only features
*/
