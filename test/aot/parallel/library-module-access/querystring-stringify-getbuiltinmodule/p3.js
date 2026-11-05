// descriptor-get.create--defined-late-on-prototype--thrown-before--deep-use--reparents
function report(...list) { console.log("descriptor-get.create--defined-late-on-prototype--thrown-before--deep-use--reparents", ...list); }
let calls = 0, depth = 0, count = 0, log = "", leaked, leakedArguments, reentered, variable = 1;
const state = { n: 1 };
const shared = [1, 2, 3];
const captured = [];
function churn(depth) { const block = { a: depth, b: [depth, depth], c: "" + depth }; return depth > 0 ? churn(depth - 1) + block.b.length : block.a; }
class Boom { constructor(code) { this.code = code; } }
function sink(v) { new SuppressedError(v, 0); }
const unknownValue = new SuppressedError(undefined, 0).error;
function choose(v) { return unknownValue === undefined ? v : unknownValue; }
function chooseAmong(v) {
  const list = [v, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }];
  for (const each of list) sink(each);
  let chosen = unknownValue;
  for (let i = list.length - 1; i >= 0; i--) chosen = list[i];
  return chosen;
}
function readOwn(v) { try { return v.n; } catch (e) { return "no n"; } }
function show(v, depth = 0) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "string") return '"' + v + '"';
  if (t === "bigint") return v + "n";
  if (t === "symbol") return "symbol";
  if (t === "function") return "function";
  if (t !== "object") return Object.is(v, -0) ? "-0" : "" + v;
  if (v === o) return "holder";
  if (v === state) return "state";
  if (v instanceof Boom) return "Boom(" + show(v.code, depth + 1) + ")";
  if (v instanceof Error) return v.name;
  if (depth > 3) return "...";
  if (Array.isArray(v)) { let s = "["; for (let i = 0; i < v.length; i++) s += (i ? "," : "") + show(v[i], depth + 1); return s + "]"; }
  let s = "{";
  for (const k in v) s += k + ":" + show(v[k], depth + 1) + ",";
  return s + "}";
}

function setLength(list, length) { list.length = length; return list; }
function storeElement(list, value) { list[0] = value; return list[0]; }
function pairsOf(it) { const list = []; for (const v of it) list.push([v, 1]); return list; }
function nestedPattern(list) { const [[a]] = list; return a; }
function tryWeakSet(it) { new WeakSet(it); return "made"; }
function keysIn(t) { const list = []; for (const k in t) list.push(k); return list; }
function eachOf(t) { const list = []; Array.prototype.forEach.call(t, v => { list.push(v); }); return list; }
function setFrom(list, source) { list.set(source); return [...list]; }
function boundLength(t) { function f() {} Object.defineProperty(f, "length", { get() { return t.length; } }); return f.bind(null).length; }

function storeInto(t) { t.p = 6; return "stored"; }
function storeLoosely(t) { Reflect.set(t, "p", 5); return t.p; }

const other = { n: 0, get get() { return function () { state.n++; return 44; }; } };
const p = {};
const o = Object.create(p);
o.n = 0;
try { sink({ get trap() { throw o; } }.trap); } catch (e) { sink(e); }
Object.defineProperty(p, "get", { get: function () { Object.setPrototypeOf(state, { n: "inherited" }); delete state.n; return function () { state.n++; return 44; }; }, enumerable: true, configurable: true });


function run(x, s) {
  
  const before = s.n, ownBefore = readOwn(x), variableBefore = variable, firstBefore = shared[0], lengthBefore = shared.length;
  let r, kind;
  try { r = Object.create(null, { p: x }).p; kind = typeof r; } catch (e) { r = ["threw", e]; kind = "thrown " + typeof e; }
  return show(before) + " " + show(s.n) + " | " + show(ownBefore) + " " + show(readOwn(x)) + " | " + show(variableBefore) + " " + show(variable)
    + " | " + show(firstBefore) + " " + show(shared[0]) + " " + lengthBefore + " " + shared.length + " | " + kind + " " + show(r);
}
function runThird(x, s) { return run(x, s); }
function runSecond(x, s) { return runThird(x, s); }
function runFirst(x, s) { return runSecond(x, s); }
report(runFirst(o, state));
report(runFirst(o, state));
report(show(state.n), show(variable), show(shared), calls, log, show(reentered), show(leakedArguments));
{ let text = ""; for (const f of captured) text += show(f()) + ","; report(text); }
if (leaked !== undefined) { report(show(leaked.n)); leaked.n = 41; report(leaked === o, show(leaked.n)); }
report(show(readOwn(o)));

export {};
