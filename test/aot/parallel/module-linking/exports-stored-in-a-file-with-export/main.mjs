// Exit code: 1
const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from "./lib.js"; say(Object.keys(ns).sort().join(), ns.a, ns.b, ns.c);
