const EMPTY = [];
function make(i) { const o = { type: i, props: null, key: null, a: null, b: null, c: null, d: 1, e: 2 }; o.key = i; return o; } const proto = () => Object.prototype;
const typed = make(0); typed.late = 0; typed.later = 1; typed.l3 = "a"; typed.l4 = null; typed.l5 = null; typed.l6 = 0.5;
function h(children) { return arguments.length > 1 ? { children: EMPTY.slice.call(arguments, 0) } : { children }; }
function coerce(x) { if (x == null || typeof x === "boolean") return null; if (typeof x === "string" || typeof x === "number") return make(String(x).length); if (Array.isArray(x)) return make(3); return x; }
function mark(children, v) { for (let i = 0; i < children.length; i++) { const child = coerce(children[i]); if (child == null) continue; child.late = v; child.later = v + 1; child.l3 = "x"; child.l4 = null; child.l5 = child; child.l6 = v * 0.5; } }
function warm() { for (let t = 0; t < 300; t++) { const p = h(make(1), "text", make(2), null, t & 7); mark(p.children, t); } }
function show(o) { const own = Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + (d.enumerable ? "" : "-e") + (d.writable ? "" : "-w") + (d.configurable ? "" : "-c") + ("value" in d ? "=" + (typeof d.value === "object" && d.value ? "o" : String(d.value)) : "=accessor"); }).join(); let forin = ""; for (const k in o) forin += k + "."; return own + " | " + Object.keys(o) + " | " + JSON.stringify(o, (k, v) => typeof v === "object" && v && k !== "" ? "o" : v) + " | " + forin; }
const lines = []; function attempt(label, f) { try { lines.push(label + " " + f()); } catch (e) { lines.push(label + " " + e.name); } }
function one(o, v) { mark([o], v); return show(o); }
warm();
for (let t = 0; t < 200; t++) { const o = make(1); o["k" + (t & 3)] = t; mark([o], t); if (t > 195) lines.push(show(o)); } for (let t = 0; t < 70; t++) { const o = make(1); for (let j = 0; j <= t; j++) o["z" + j] = j; mark([o], t); if (t % 23 == 0) lines.push(show(o)); } attempt("last", () => one(make(1), 9));
console.log(lines.join("\n"));
