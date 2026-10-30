const say = (...v) => console.log(...v.map(x => typeof x === "function" ? "fn:" + x.name : typeof x === "symbol" ? String(x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import a from "./a.mjs"; import b from "./b.mjs"; import c from "./c.mjs"; import d from "./d.mjs"; import e from "./e.mjs"; import g from "./g.mjs"; import h from "./h.mjs"; import i from "./i.mjs"; import j from "./j.mjs"; import k from "./k.mjs"; console.log([a, b, c, d, e, g, i, j, k].map(x => JSON.stringify(x.name)).join(), h);
/* Output:
"default","default","default","default","named","Named","f","default","default" [
  1
]
*/
