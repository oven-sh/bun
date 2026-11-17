"use strict";
// Names of methods of Object.prototype stored into literals and instances in loops, and Object.prototype is frozen by a function handed on.
const show = o => Object.keys(o).map(k => k + ":" + (typeof o[k] === "function" ? "f" : String(o[k]))).join() + "|" + Object.getOwnPropertyNames(o).length;
class Point { x = 1; constructor(y) { this.y = y; } } class Named extends Point { toString() { return "named"; } }
let frozen = 0, calls = 0;
function change() { calls++; if (calls === 20) { frozen = 1; [Object.prototype].forEach(Object.freeze); } }
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
const forms = {
  one(i) { const o = {}; o.toString = i; return show(o) + o.toString; },
  two(i) { const o = {}; o.toString = i; o.valueOf = i + 1; return show(o) + (o.toString + o.valueOf); },
  fn(i) { const o = {}; o.toString = () => "t" + i; return show(o) + o; },
  field(i) { const o = { x: i }; o.hasOwnProperty = i; o.y = 2; return show(o); },
  between(i) { const o = { x: i }; change(); o.toString = i; return show(o); },
  before(i) { change(); const o = {}; o.valueOf = i; o.kind = 1; return show(o); },
  inArgument(i) { const o = {}; o.toString = (change(), i); return show(o); },
  branch(i) { const o = { a: 1 }; if (i & 1) o.toString = i; else o.isPrototypeOf = i; o.b = 2; return show(o); },
  loop(i) { let t = ""; for (let k = 0; k < 3; k++) { const o = { k }; o.propertyIsEnumerable = k; t += show(o); } return t; },
  instance(i) { const o = new Point(i); o.hasOwnProperty = i; return show(o) + o.hasOwnProperty; },
  instanceTwo(i) { const o = new Point(i); o.toString = i; o.valueOf = 5; o.z = 1; return show(o); },
  heir(i) { const o = new Named(i); o.toString = () => "own"; return show(o) + o; },
  created(i) { const o = Object.create({ above: 1 }); o.toString = i; return show(o); },
  nul(i) { const o = Object.create(null); o.toString = i; o.hasOwnProperty = 2; return show(o); },
  defined(i) { const o = {}; Object.defineProperty(o, "toString", { value: i, enumerable: true }); return show(o); },
  literal(i) { const o = { toString: i, valueOf: 2 }; o.toString = i + 1; return show(o); },
  key(i) { const o = {}; o["to" + "String"] = i; return show(o); },
  keys(i) { const o = {}; for (const k of ["toString", "x", "valueOf"]) o[k] = i; return show(o); },
  twice(i) { const o = {}; o.toString = 1; o.toString = i; return show(o); },
  gone(i) { const o = {}; o.toString = 1; delete o.toString; o.toString = i; o.x = 1; return show(o); },
  assign(i) { const o = {}; o.valueOf = 1; Object.assign(o, { toString: i, y: 1 }); return show(o); },
  spread(i) { const o = { ...{ toString: i } }; o.valueOf = 1; return show(o); },
  locale(i) { const o = {}; o.toLocaleString = () => "l" + i; return show(o) + o.toLocaleString(); },
  lookup(i) { const o = {}; o.__lookupGetter__ = i; o.__defineSetter__ = 2; return show(o); },
  ctor(i) { const o = {}; o.constructor = i; o.toString = 1; return show(o); },
  proto(i) { const o = { q: 1 }; o.__proto__ = { up: i }; o.toString = i; return show(o) + o.up; },
  kept(i) { const o = {}; o.toString = i; held.push(o); return held.length > 3 ? show(held.shift()) : "-"; },
  passed(i) { const o = {}; give(o, i); return show(o); },
  array(i) { const o = [1]; o.toString = i; return show(o); },
  order(i) { const o = { b: 1 }; o.toString = 2; o.a = 3; o.valueOf = 4; o[1] = 5; return show(o) + JSON.stringify(o); },
};
const held = []; function give(o, i) { o.x = 1; o.toString = i; o.hasOwnProperty = 2; }
function bare(n) { let r = 0; for (let j = 0; j < n; j++) { const p = {}; p.toString = j; p.valueOf = 2; r += p.toString + p.valueOf; } return r; }
function bareText(n) { let r = 0; for (let j = 0; j < n; j++) { const p = {}; p.toString = () => "t"; r += p.toString().length + j; } return r; }
function bareInstance(n) { let r = 0; for (let j = 0; j < n; j++) { const p = new Point(1); p.hasOwnProperty = j; r += p.hasOwnProperty; } return r; }
for (let turn = 0; turn < 8; turn++) {
  for (const [n, f] of Object.entries(forms)) { let line = n; for (let i = 0; i < 3; i++) line += " " + attempt(() => f(i)); console.log(line); }
  console.log(attempt(() => bare(20)), attempt(() => bareText(20)), attempt(() => bareInstance(20)), frozen);
}
console.log(Object.isFrozen(Object.prototype), calls);
