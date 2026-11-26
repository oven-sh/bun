"use strict";
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
Object.defineProperty(proto(), "late", { configurable: true, get() { return 3; } }); attempt("b", () => one(make(1), 6)); delete proto().late; attempt("c", () => one(make(1), 7)); attempt("last", () => one(make(1), 9));
console.log(lines.join("\n"));
