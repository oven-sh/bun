// Constructor functions: called without new, with another prototype, with setters that come late.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
function K(v) { this.ka = { qh: v }; more.call(this); }
function more() { this.kb = { qh: 2 }; }
const k1 = new K(1);
const plain = {}; K.call(plain, 5);
console.log(k1.ka.qh + k1.kb.qh, plain.ka.qh + plain.kb.qh);
Object.setPrototypeOf(K.prototype, { set ka(v) { seen.push("setter"); } });
const k2 = new K(3);
console.log(attempt(() => k2.ka.qh), seen.join(), Object.keys(k2).join());
function L() { this.la = { qh: 1 }; }
L.prototype = Object.freeze({ la: 0 });
const l = attempt(() => new L());
console.log(typeof l === "string" ? l : attempt(() => l.la.qh), typeof l === "string" ? "" : Object.keys(l).join());
function N() { "use strict"; this.na = { qh: 1 }; }
N.prototype = new Proxy({}, { set(t, k, v, r) { seen.push("trap " + String(k)); return true; } });
const n = new N();
console.log(attempt(() => n.na.qh), seen.join());
