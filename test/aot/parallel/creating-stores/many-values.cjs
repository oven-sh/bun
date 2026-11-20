function make(i) { const o = { kind: i, coat: null, tag: null, a: null, b: null, c: null, d: 1, e: 2 }; o.tag = i; return o; } const proto = () => Object.prototype;
const typed = make(0); typed.late = 0; typed.later = 1; typed.l3 = "a"; typed.l4 = null; typed.l5 = null; typed.l6 = 0.5;
function guests(first) { const all = Array.prototype.slice.call(arguments, 0); return { first, all, size: arguments.length }; }
function seat(guest) { switch (typeof guest) { case "object": return Array.isArray(guest) ? make(guest.length) : guest; case "string": return make(guest.length); case "number": return make(guest & 7); default: return undefined; } }
function mark(all, v) { for (let at = 0; at < all.length; at++) { const guest = seat(all[at]); if (guest) { guest.late = v; guest.later = v + 1; guest.l3 = "x"; guest.l4 = null; guest.l5 = guest; guest.l6 = v * 0.5; } } }
function warm() { for (let t = 0; t < 300; t++) mark(guests(make(1), "text", make(2), null, t & 7).all, t); }
function show(o) { const own = Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + (d.enumerable ? "" : "-e") + (d.writable ? "" : "-w") + (d.configurable ? "" : "-c") + ("value" in d ? "=" + (typeof d.value === "object" && d.value ? "o" : String(d.value)) : "=accessor"); }).join(); let forin = ""; for (const k in o) forin += k + "."; return own + " | " + Object.keys(o) + " | " + JSON.stringify(o, (k, v) => typeof v === "object" && v && k !== "" ? "o" : v) + " | " + forin; }
const lines = []; function attempt(label, f) { try { lines.push(label + " " + f()); } catch (e) { lines.push(label + " " + e.name); } }
function one(o, v) { mark([o], v); return show(o); }
warm();
for (const v of [1, 1.5, -0, NaN, "s", "", true, false, null, undefined, 1e300, 5n, Symbol.iterator.description, [], {}, () => 1]) { attempt("v", () => { const o = make(1); mark([o], v); return Object.is(o.late, v) + typeof o.late + ("late" in o) + Object.keys(o); }); } attempt("last", () => one(make(1), 9));
console.log(lines.join("\n"));
