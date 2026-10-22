// A call of a Proxy answers as in plain Bun: proxy-trap, two.
const log = [];
function show(v) { return v === undefined ? "undefined" : v === null ? "null" : v === globalThis ? "global" : typeof v === "object" || typeof v === "function" ? "[" + typeof v + (v.name ? " " + v.name : "") + "]" : typeof v + ":" + String(v); }
async function settle(v) { if (v && typeof v.next === "function") return "yields " + [...v].join(); return v && typeof v.then === "function" ? "resolves " + (await v) : v; }
function target(a, b) { return [show(this), a, b, arguments.length].join(); }
const handler = ({ apply: new Proxy(function (t, r, l) { log.push("inner trap"); return Reflect.apply(t, r, l); }, {}) });
const p = new Proxy(target, handler);
try { console.log(String(await settle(p(1, 2)))); } catch (e) { console.log(e.name, e.message); }
console.log(log.join());
