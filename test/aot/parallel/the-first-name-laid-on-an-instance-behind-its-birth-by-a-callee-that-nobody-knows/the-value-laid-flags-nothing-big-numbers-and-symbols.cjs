"use strict";
const k = JSON.parse('"lay"');
class Flag { constructor(n) { this.bornFlag = n; } } const ofFlag = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateFlag = v; return r.bornFlag < 0 ? null : r; } };
class Nothing { constructor(n) { this.bornNothing = n; } } const ofNothing = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateNothing = v; return r.bornNothing < 0 ? null : r; } };
class Big { constructor(n) { this.bornBig = n; } } const ofBig = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateBig = v; return r.bornBig < 0 ? null : r; } };
class Sign { constructor(n) { this.bornSign = n; } } const ofSign = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateSign = v; return r.bornSign < 0 ? null : r; } };
function show(v) { return typeof v === "symbol" || typeof v === "bigint" ? typeof v + ":" + String(v) : Object.is(v, -0) ? "-0" : JSON.stringify(v) ?? String(v); }
const ints = [0, -1, 7, 2147483647, -2147483648], doubles = [0.5, -0, NaN, Infinity, 4294967296.5], mixed = [1, "one", null, 1.5, { one: 1 }, undefined, true];
for (let i = 0; i < 7; i++) {
  const line = [];
  { const r = ofFlag[k](new Flag(i), i % 2 === 0); line.push(Object.keys(r).join() + "=" + show(r.lateFlag) + ":" + ("lateFlag" in r) + r.bornFlag); }
  { const r = ofNothing[k](new Nothing(i), i % 2 ? undefined : null); line.push(Object.keys(r).join() + "=" + show(r.lateNothing) + ":" + ("lateNothing" in r) + r.bornNothing); }
  { const r = ofBig[k](new Big(i), BigInt(i) << 70n); line.push(Object.keys(r).join() + "=" + show(r.lateBig) + ":" + ("lateBig" in r) + r.bornBig); }
  { const r = ofSign[k](new Sign(i), Symbol.for("s" + i)); line.push(Object.keys(r).join() + "=" + show(r.lateSign) + ":" + ("lateSign" in r) + r.bornSign); }
  console.log(line.join(" "));
}
