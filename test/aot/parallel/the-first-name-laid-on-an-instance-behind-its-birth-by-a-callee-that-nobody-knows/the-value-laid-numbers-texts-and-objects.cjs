"use strict";
const k = JSON.parse('"lay"');
class Int { constructor(n) { this.bornInt = n; } } const ofInt = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateInt = v; return r.bornInt < 0 ? null : r; } };
class Double { constructor(n) { this.bornDouble = n; } } const ofDouble = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateDouble = v; return r.bornDouble < 0 ? null : r; } };
class Text { constructor(n) { this.bornText = n; } } const ofText = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateText = v; return r.bornText < 0 ? null : r; } };
class Held { constructor(n) { this.bornHeld = n; } } const ofHeld = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateHeld = v; return r.bornHeld < 0 ? null : r; } };
function show(v) { return typeof v === "symbol" || typeof v === "bigint" ? typeof v + ":" + String(v) : Object.is(v, -0) ? "-0" : JSON.stringify(v) ?? String(v); }
const ints = [0, -1, 7, 2147483647, -2147483648], doubles = [0.5, -0, NaN, Infinity, 4294967296.5], mixed = [1, "one", null, 1.5, { one: 1 }, undefined, true];
for (let i = 0; i < 7; i++) {
  const line = [];
  { const r = ofInt[k](new Int(i), ints[i % 5]); line.push(Object.keys(r).join() + "=" + show(r.lateInt) + ":" + ("lateInt" in r) + r.bornInt); }
  { const r = ofDouble[k](new Double(i), doubles[i % 5]); line.push(Object.keys(r).join() + "=" + show(r.lateDouble) + ":" + ("lateDouble" in r) + r.bornDouble); }
  { const r = ofText[k](new Text(i), "t" + i); line.push(Object.keys(r).join() + "=" + show(r.lateText) + ":" + ("lateText" in r) + r.bornText); }
  { const r = ofHeld[k](new Held(i), { inner: i }); line.push(Object.keys(r).join() + "=" + show(r.lateHeld) + ":" + ("lateHeld" in r) + r.bornHeld); }
  console.log(line.join(" "));
}
