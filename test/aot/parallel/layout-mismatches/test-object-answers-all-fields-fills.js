// A reader of several fields tests the object once instead of each slot. Every object below goes through the same readers: the first one a constructor makes, one that lost a field, one whose
// field became an accessor, one that was seen before it was finished, one whose constructor left early, one made for another new.target, and one that the constructor was only called on.
const out = [];
const suffix = process.argv[2] ?? "";
// What the compiler cannot read: it only knows that the objects go there.
globalThis.hide = new Function("value", "return value" + suffix);
const define = new Function("object", "label", "descriptor", "return Object.defineProperty(object, label, descriptor)" + suffix);
const remove = new Function("object", "label", "return delete object[label]" + suffix);
const construct = new Function("target", "list", "newTarget", "return Reflect.construct(target, list, newTarget)" + suffix);

function Bench(mark, label, seat) {
  this.beside = null;
  this.cloth = undefined;
  this.seat = seat;
  this.label = label;
  this.mark = mark;
}
class Peg {
  constructor(hung, coats) {
    this.next = null;
    this.coats = coats;
    this.hung = hung;
  }
}

function readBench(bench) {
  return [bench.label, typeof bench.label, `${bench.label}`, bench.seat === null ? "no seat" : typeof bench.seat, bench.beside, typeof bench.beside, bench.cloth, typeof bench.cloth, "label" in bench, Object.keys(bench).join()];
}
function readAcrossACall(bench, between) {
  const before = bench.label;
  between(bench);
  return [before, bench.label, bench.beside];
}
function storeIntoBench(bench, value) {
  bench.label = value;
  bench.beside = value;
  return [bench.label, bench.beside, Object.keys(bench).join()];
}
function readPeg(peg) {
  return [peg.hung, peg.coats, peg.next];
}
function show(name, value) {
  out.push(name + ": " + JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : v)));
}

const first = hide(new Bench(0, "first", null));
show("the first object", readBench(first));
for (let i = 0; i < 40; i++) readBench(hide(new Bench(i, "k" + i, first)));
show("a later object", readBench(hide(new Bench(1, "later", first))));

const deleted = hide(new Bench(2, "deleted", null));
delete deleted.label;
show("a field deleted", readBench(deleted));
show("a store creates it again, last", storeIntoBench(deleted, "again"));
show("and it reads", readBench(deleted));

Bench.prototype.beside = "inherited";
const uncovered = hide(new Bench(3, "uncovered", null));
delete uncovered.beside;
show("a deleted field uncovers the prototype's", readBench(uncovered));
delete Bench.prototype.beside;

const accessor = hide(new Bench(4, "accessor", null));
let reads = 0;
Object.defineProperty(accessor, "label", { get() { return "got " + ++reads; }, set(v) { reads = 100; }, configurable: true, enumerable: true });
show("a field redefined as an accessor", readBench(accessor));
show("a store calls its setter", storeIntoBench(accessor, "stored"));

const removed = hide(new Bench(13, "removed", null));
remove(removed, "seat");
show("a field deleted by code that nobody sees", readBench(removed));
const redefined = hide(new Bench(14, "redefined", null));
define(redefined, "cloth", { get() { return "computed"; }, configurable: true, enumerable: false });
show("a field redefined by code that nobody sees", readBench(redefined));
show("deleted in the middle of a reader by such code", readAcrossACall(hide(new Bench(15, "there", null)), bench => { remove(bench, "label"); remove(bench, "beside"); }));
show("deleted in the middle of a reader", readAcrossACall(hide(new Bench(5, "there", null)), bench => { delete bench.label; delete bench.beside; }));
show("left alone in the middle of a reader", readAcrossACall(hide(new Bench(6, "there", null)), () => {}));

let seen;
function Early(label) {
  this.mark = 1;
  seen = readEarly(this);
  this.label = label;
  this.next = null;
}
function readEarly(early) {
  return [early.mark, early.label, early.next, Object.keys(early).join()];
}
const early = hide(new Early("early"));
show("seen before it was finished", seen);
show("and after", readEarly(early));

function Leaves(stop) {
  this.a = 1;
  if (stop) return;
  this.b = 2;
  this.c = 3;
}
function readLeaves(o) {
  return [o.a, o.b, o.c, Object.keys(o).join()];
}
show("the constructor ran to its end", readLeaves(hide(new Leaves(false))));
show("the constructor left early", readLeaves(hide(new Leaves(true))));

function Throws(fail, sink) {
  this.a = 1;
  sink.push(this);
  if (fail) throw new Error("stop");
  this.b = 2;
}
function readThrows(o) {
  return [o.a, o.b, Object.keys(o).join()];
}
const sink = [];
new Throws(false, sink);
try { new Throws(true, sink); } catch {}
show("the constructor threw", sink.map(readThrows));

function Other() {}
Other.prototype.marker = "other";
const forOther = hide(construct(Bench, [7, "for another new.target", null], Other));
show("made for another new.target", [readBench(forOther), forOther.marker, forOther instanceof Bench]);
class Setter { set label(v) { this.hidden = v; } }
const underSetter = hide(construct(Bench, [8, "under a setter", null], Setter));
show("a setter above takes the store", [readBench(underSetter), underSetter.hidden]);

define(Bench.prototype, "label", { set(v) { this.hidden = v; }, configurable: true });
const lateSetter = hide(new Bench(10, "a setter has arrived", null));
show("a setter that arrived above takes the store", [readBench(lateSetter), lateSetter.hidden]);
remove(Bench.prototype, "label");
define(Bench.prototype, "beside", { value: "read-only above", writable: false, configurable: true });
const underReadOnly = hide((() => { try { return new Bench(11, "read-only above", null); } catch (error) { return error.constructor.name; } })());
show("a read-only property that arrived above refuses the store", typeof underReadOnly === "string" ? underReadOnly : readBench(underReadOnly));
remove(Bench.prototype, "beside");
show("and all is as before", readBench(hide(new Bench(12, "as before", null))));

const calledOn = hide({ own: true });
Bench.call(calledOn, 9, "called on", null);
show("the constructor was called on another object", readBench(calledOn));

const peg = hide(new Peg(1, "coats"));
show("an instance of a class", readPeg(peg));
Object.defineProperty(peg, "coats", { value: "fixed", writable: false });
show("a field made read-only", readPeg(peg));
const frozen = hide(Object.freeze(new Peg(2, "frozen")));
show("a frozen instance", readPeg(frozen));
const copy = hide({ ...new Peg(3, "copied") });
show("a copy", readPeg(copy));
const heir = hide(Object.create(new Peg(4, "inherited")));
show("an heir", [readPeg(heir), Object.keys(heir).join()]);

console.log(out.join("\n"));
