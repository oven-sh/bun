// A call of a Proxy answers as in plain Bun: arrow, empty, two.
const log = [];
function show(v) { return v === undefined ? "undefined" : v === null ? "null" : v === globalThis ? "global" : typeof v === "object" || typeof v === "function" ? "[" + typeof v + (v.name ? " " + v.name : "") + "]" : typeof v + ":" + String(v); }
async function settle(v) { if (v && typeof v.next === "function") return "yields " + [...v].join(); return v && typeof v.then === "function" ? "resolves " + (await v) : v; }
const target = (a, b) => [a, b].join();
const handler = ({});
const p = new Proxy(target, handler);
try { console.log(String(await settle(p(1, 2)))); } catch (e) { console.log(e.name, e.message); }
console.log(log.join());
