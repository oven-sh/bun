const EMPTY = [];
class P { constructor(i) { this.type = i; this.key = null; } get sum() { return this.late; } method() { return this.later; } } function make(i) { return new P(i); } const proto = () => P.prototype;
const typed = make(0); typed.late = 0; typed.later = 1; 
function h(children) { return arguments.length > 1 ? { children: EMPTY.slice.call(arguments, 0) } : { children }; }
function coerce(x) { if (x == null || typeof x === "boolean") return null; if (typeof x === "string" || typeof x === "number") return make(String(x).length); if (Array.isArray(x)) return make(3); return x; }
function mark(children, v) { for (let i = 0; i < children.length; i++) { const child = coerce(children[i]); if (child == null) continue; child.late = v; child.later = v + 1; } }
function warm() { for (let t = 0; t < 300; t++) { const p = h(make(1), "text", make(2), null, t & 7); mark(p.children, t); } }
function show(o) { const own = Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + (d.enumerable ? "" : "-e") + (d.writable ? "" : "-w") + (d.configurable ? "" : "-c") + ("value" in d ? "=" + (typeof d.value === "object" && d.value ? "o" : String(d.value)) : "=accessor"); }).join(); let forin = ""; for (const k in o) forin += k + "."; return own + " | " + Object.keys(o) + " | " + JSON.stringify(o, (k, v) => typeof v === "object" && v && k !== "" ? "o" : v) + " | " + forin; }
const lines = []; function attempt(label, f) { try { lines.push(label + " " + f()); } catch (e) { lines.push(label + " " + e.name); } }
function one(o, v) { mark([o], v); return show(o); }
warm();
attempt("a", () => one(make(1), 5)); let seen = []; Object.defineProperty(proto(), "late", { configurable: true, set(v) { seen.push(v); }, get() { return "got"; } }); attempt("b", () => one(make(1), 6) + seen.join()); delete proto().late; attempt("c", () => one(make(1), 7) + seen.join()); attempt("last", () => one(make(1), 9));
console.log(lines.join("\n"));
