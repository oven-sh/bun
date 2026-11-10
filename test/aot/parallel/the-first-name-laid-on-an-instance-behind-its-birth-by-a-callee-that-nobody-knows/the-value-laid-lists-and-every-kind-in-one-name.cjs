"use strict";
const k = JSON.parse('"lay"');
class List { constructor(n) { this.bornList = n; } } const ofList = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateList = v; return r.bornList < 0 ? null : r; } };
class Mixed { constructor(n) { this.bornMixed = n; } } const ofMixed = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, lay(r, v) { r.lateMixed = v; return r.bornMixed < 0 ? null : r; } };
function show(v) { return typeof v === "symbol" || typeof v === "bigint" ? typeof v + ":" + String(v) : Object.is(v, -0) ? "-0" : JSON.stringify(v) ?? String(v); }
const ints = [0, -1, 7, 2147483647, -2147483648], doubles = [0.5, -0, NaN, Infinity, 4294967296.5], mixed = [1, "one", null, 1.5, { one: 1 }, undefined, true];
for (let i = 0; i < 7; i++) {
  const line = [];
  { const r = ofList[k](new List(i), [i, i + 1]); line.push(Object.keys(r).join() + "=" + show(r.lateList) + ":" + ("lateList" in r) + r.bornList); }
  { const r = ofMixed[k](new Mixed(i), mixed[i]); line.push(Object.keys(r).join() + "=" + show(r.lateMixed) + ":" + ("lateMixed" in r) + r.bornMixed); }
  console.log(line.join(" "));
}
