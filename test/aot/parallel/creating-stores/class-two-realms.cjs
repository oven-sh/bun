class P { constructor(i) { this.kind = i; this.tag = null; } get sum() { return this.late; } method() { return this.later; } } function make(i) { return new P(i); } const proto = () => P.prototype;
const typed = make(0); typed.late = 0; typed.later = 1;
function guests(first) { const all = Array.prototype.slice.call(arguments, 0); return { first, all, size: arguments.length }; }
function seat(guest) { switch (typeof guest) { case "object": return Array.isArray(guest) ? make(guest.length) : guest; case "string": return make(guest.length); case "number": return make(guest & 7); default: return undefined; } }
function mark(all, v) { for (let at = 0; at < all.length; at++) { const guest = seat(all[at]); if (guest) { guest.late = v; guest.later = v + 1; } } }
function warm() { for (let t = 0; t < 300; t++) mark(guests(make(1), "text", make(2), null, t & 7).all, t); }
function show(o) { const own = Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + (d.enumerable ? "" : "-e") + (d.writable ? "" : "-w") + (d.configurable ? "" : "-c") + ("value" in d ? "=" + (typeof d.value === "object" && d.value ? "o" : String(d.value)) : "=accessor"); }).join(); let forin = ""; for (const k in o) forin += k + "."; return own + " | " + Object.keys(o) + " | " + JSON.stringify(o, (k, v) => typeof v === "object" && v && k !== "" ? "o" : v) + " | " + forin; }
const lines = []; function attempt(label, f) { try { lines.push(label + " " + f()); } catch (e) { lines.push(label + " " + e.name); } }
function one(o, v) { mark([o], v); return show(o); }
warm();
const vm = require("node:vm"); attempt("v", () => { const o = vm.runInNewContext("({ kind: 1, coat: null, tag: null })"); return one(o, 6); }); const seen = []; const c = vm.createContext({}); attempt("p", () => { const o = vm.runInContext("Object.defineProperty(Object.prototype, \"late\", { set(v) { this.zz = v; }, configurable: true }); ({ kind: 1 })", c); return one(o, 6); }); attempt("c", () => one(make(1), 7)); attempt("last", () => one(make(1), 9));
console.log(lines.join("\n"));
