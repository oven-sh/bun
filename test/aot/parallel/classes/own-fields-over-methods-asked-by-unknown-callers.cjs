// A constructor lays a field over a method of its class. Functions that nobody calls by name ask an unknown object for that name.
function helper(t) { return t === undefined ? 50 : t + 50; }
class Go { constructor() { this.go = helper; } go(t) { return t; } }
class Turn { constructor(way) { this.turn = way ? helper : () => 7; } turn(t) { return t; } }
class Step { constructor() { this.step = helper; } step(t) { return t; } }
class Walk { constructor(n) { if (n) this.walk = helper; } walk(t) { return -t; } }
class Read { constructor() { this.read = helper; } read(t) { return t; } get length() { return 3; } }
class Pass { constructor() { this.pass = helper; } pass(t) { return t; } }
function makes() { for (let i = 0; i < 3; i++) { new Go(); new Turn(i); new Step(); new Walk(i); new Read(); new Pass(); } return "made"; }
function loops(o) { let n = 0; for (;;) { o.go(); if (n++ > 2) return n; } }
function nests(o) { let s = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { s += o.turn(j); if (s > 900) return s; } return s; }
function catches(o) { let s = ""; for (let i = 0; i < 3; i++) { try { s += o.step(i); if (i === 1) throw new RangeError("told"); } catch (e) { s += e.name; } finally { s += ";"; } } return s; }
function withoutLoop(o) { return o.walk(2); }
function called(o) { let s = 0; for (let i = 0; i < 3; i++) s += withoutLoop(o); return s; }
const trap = { get(target, key) { let n = 0; for (;;) { target.read(n); if (n++ > 2) return key === "then" ? undefined : n; } } };
function traps(o) { return new Proxy(o, trap).any; }
function patterns(o) { return [o, o].map(({ pass: kept = null, length = 1 }, i) => { let n = 0; for (;;) { o.pass(n); if (n++ > length) return n + i + typeof kept; } }).join(); }
function* steps(o) { let n = 0; for (;;) { yield o.go(n); if (n++ > 1) return; } }
const fs = [makes, loops, nests, catches, called, traps, patterns, o => [...steps(o)].join()];
for (const [i, f] of fs.entries()) globalThis["f" + i] = f;
function run(k, o) { try { return String(globalThis[k](...[o])); } catch (e) { return e.name; } }
const laid = f => Object.fromEntries(["og", "nrut", "pets", "klaw", "daer", "ssap"].map(n => [[...n].reverse().join(""), f]));
const objects = { none: () => [], own: () => laid(x => x ?? 1), null: () => null, text: () => "abc", list: () => Object.assign([1], laid(() => 2)), heir: () => Object.create(laid(() => 3)) };
for (let round = 0; round < 3; round++) for (const name of Object.keys(objects)) console.log(round, name, Object.keys(fs).map(k => run("f" + k, objects[name]())).join(" "));
