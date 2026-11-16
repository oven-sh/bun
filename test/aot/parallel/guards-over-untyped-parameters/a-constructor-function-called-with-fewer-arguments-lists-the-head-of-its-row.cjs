"use strict";
// A constructor function of an untyped file that others may call, called with fewer arguments than it has parameters: the row of first stores ends at the missing argument, the allocation lists its head,
// and the rest is stored in written order. The answers are the order of the keys, what JSON sees, and who sees a store: a setter laid above under a name that nobody can read in the text.
const hidden = JSON.parse('{"define":"defineProperty","b":"b","c":"c"}');
let log = "";
function show(o) { const text = Object.keys(o).join() + " " + JSON.stringify(o) + " " + log; log = ""; return text; }
function Few(a, b) { this.a = a; this.b = b; this.c = 1; }
function makeFew() { return new Few(1); }
function makeNone() { return new Few(); }
function makeAll() { return new Few(1, 2); }
function Seen(a, b) { this.a = a; this.b = b; this.c = 1; }
function makeSeen() { return new Seen(1); }
function Last(a, b) { this.a = a; this.b = b; this.c = 1; }
function makeLast() { return new Last(1); }
globalThis.handedOut = { Few, makeFew, makeNone, makeAll, Seen, makeSeen, Last, makeLast };
for (let round = 0; round < 3; round++) {
  console.log(show(makeFew()), "|", show(makeNone()), "|", show(makeAll()), "|", show(makeSeen()), "|", show(makeLast()));
  if (round === 0) Object[hidden.define](Seen.prototype, hidden.b, { set(value) { log += "b=" + value + " keys " + Object.keys(this).join() + ";"; }, configurable: true });
  if (round === 1) Object[hidden.define](Last.prototype, hidden.c, { set(value) { log += "c=" + value + " keys " + Object.keys(this).join() + ";"; }, configurable: true });
}
