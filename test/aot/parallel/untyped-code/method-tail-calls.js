"use strict";
// `return o.m(..)` on receivers of no type: own methods, inherited ones, methods out of line, getters that yield functions, primitives as receivers, bound and host functions, proxies,
// callable and not; what is no function throws a TypeError from a frame that is still there; a chain of a million such calls does not use up the stack.
const lines = [];
function call0(o) { return o.run(); }
function call1(o, a) { return o.run(a); }
function call2(o, a, b) { return o.run(a, b); }
function call4(o, a, b, c, d) { return o.run(a, b, c, d); }
function callOther(o, a) { return o.other(a); }
function callToString(o) { return o.toString(); }
function callLength(o, a) { return o.slice(a); }
class Base { run(...all) { return "Base.run(" + all.join() + ") of " + this.tag; } other(a) { return "Base.other " + a; } }
class Derived extends Base { constructor(tag) { super(); this.tag = tag; } }
const own = { tag: "own", run(...all) { return "own.run(" + all.join() + ") of " + this.tag; } };
const wide = { tag: "wide" }; for (let i = 0; i < 40; i++) wide["p" + i] = i; wide.run = function (...all) { return "wide.run(" + all.join() + ") of " + this.tag; };
const byGetter = { tag: "getter", get run() { lines.push("the getter runs"); return function (...all) { return "got.run(" + all.join() + ") of " + this.tag; }; } };
const bound = { tag: "unused", run: function (...all) { return "bound.run(" + all.join() + ") of " + this.tag; }.bind({ tag: "bound" }) };
const host = { run: Math.max };
const proxied = { tag: "proxied", run: new Proxy(function (...all) { return "target(" + all.join() + ") of " + this.tag; }, {}) };
const throwing = { get run() { throw new RangeError("the getter throws"); } };
const receivers = [new Derived("derived"), own, wide, byGetter, bound, host, proxied];
for (let round = 0; round < 3; round++) for (const o of receivers) { const line = [call0(o), call1(o, 1), call2(o, 1, 2), call4(o, 1, 2, 3, 4)].join(" | "); if (round === 2) lines.push(line); }
function attempt(what, act) { try { lines.push(what + ": " + act()); } catch (error) { lines.push(what + ": " + error.constructor.name + " | seen in the trace: " + /call[0-9A-Z]/.test(String(error.stack))); } }
for (const [what, o] of [["no method", {}], ["a number for a method", { run: 5 }], ["an object for a method", { run: {} }], ["null for a method", { run: null }], ["a string for a method", { run: "text" }], ["a throwing getter", throwing], ["undefined", undefined], ["null", null], ["a number", 5], ["a string", "text"]]) {
  attempt(what + ", no argument", () => call0(o)); attempt(what + ", two", () => call2(o, 1, 2)); }
function tail0(o) { return o.run(); }
function tail1(o, a) { return o.run(a); }
function tail2(o, a, b) { return o.run(a, b); }
function tailNumber(o, a) { return o.run(a * 0.5); }
const byTable = [tail0, tail1, tail2, tailNumber];
for (let round = 0; round < 3; round++) for (const o of receivers) { const line = [byTable[0](o), byTable[1](o, 1), byTable[2](o, 1, 2), byTable[3](o, 3)].join(" | "); if (round === 2) lines.push("by table: " + line); }
for (const o of [{}, { run: 5 }, { run: {} }, undefined, 5]) for (const f of byTable) attempt("by table", () => f(o, 1, 2));
attempt("other", () => callOther(new Derived("d"), 7)); attempt("other of own", () => callOther(own, 7));
for (const v of [5, "text", true, 10n, Symbol.iterator, [1, 2], { a: 1 }]) attempt("toString of " + typeof v, () => callToString(v));
attempt("slice of a string", () => callLength("abcdef", 2)); attempt("slice of an array", () => callLength([1, 2, 3], 1).join());
const counter = { down(n, sum) { if (n === 0) return sum; return this.down(n - 1, sum + n); } };
function start(o, n) { return o.down(n, 0); }
attempt("a million deep", () => start(counter, 1000000));
const pair = { even(n) { if (n === 0) return "even"; return this.odd(n - 1); }, odd(n) { if (n === 0) return "odd"; return this.even(n - 1); } };
attempt("two methods in turn", () => pair.even(300001));
console.log(lines.join("\n"));
