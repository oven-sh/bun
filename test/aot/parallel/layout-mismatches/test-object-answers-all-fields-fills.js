// A reader of several fields tests the object once instead of each slot. Every object below goes through the same readers: the first one a constructor makes, one that lost a field, one whose
// field became an accessor, one that was seen before it was finished, one whose constructor left early, one made for another new.target, and one that the constructor was only called on.
// STATISTIC: BirthsFinished >= 2
// IR-UNTIL FinishBirths
// The constructor function says where the last field is stored.
// IRT= 1 Fiber ^ +FinishBirth\b
// The reader asks once, and once more behind the conversion to a text, which may run code.
// IRT= 2 readFiber HasBirthFieldsFilled
// IRT= 0 readFiber IsSlotFilled
// IRT= 2 readAcrossACall HasBirthFieldsFilled
// IRT= 0 readAcrossACall IsSlotFilled
// IRT= 1 storeIntoFiber HasBirthFieldsFilled
const out = [];
const suffix = process.argv[2] ?? "";
// What the compiler cannot read: it only knows that the objects go there.
globalThis.hide = new Function("value", "return value" + suffix);
const define = new Function("object", "key", "descriptor", "return Object.defineProperty(object, key, descriptor)" + suffix);
const remove = new Function("object", "key", "return delete object[key]" + suffix);

function Fiber(tag, key, child) {
  this.tag = tag;
  this.key = key;
  this.child = child;
  this.sibling = null;
  this.memo = undefined;
}
class Hook {
  constructor(state, queue) {
    this.state = state;
    this.queue = queue;
    this.next = null;
  }
}

function readFiber(fiber) {
  return [fiber.key, typeof fiber.key, `${fiber.key}`, fiber.child === null ? "no child" : typeof fiber.child, fiber.sibling, typeof fiber.sibling, fiber.memo, typeof fiber.memo, "key" in fiber, Object.keys(fiber).join()];
}
function readAcrossACall(fiber, between) {
  const before = fiber.key;
  between(fiber);
  return [before, fiber.key, fiber.sibling];
}
function storeIntoFiber(fiber, value) {
  fiber.key = value;
  fiber.sibling = value;
  return [fiber.key, fiber.sibling, Object.keys(fiber).join()];
}
function readHook(hook) {
  return [hook.state, hook.queue, hook.next];
}
function show(name, value) {
  out.push(name + ": " + JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : v)));
}

const first = hide(new Fiber(0, "first", null));
show("the first object", readFiber(first));
for (let i = 0; i < 40; i++) readFiber(hide(new Fiber(i, "k" + i, first)));
show("a later object", readFiber(hide(new Fiber(1, "later", first))));

const deleted = hide(new Fiber(2, "deleted", null));
delete deleted.key;
show("a field deleted", readFiber(deleted));
show("a store creates it again, last", storeIntoFiber(deleted, "again"));
show("and it reads", readFiber(deleted));

Fiber.prototype.sibling = "inherited";
const uncovered = hide(new Fiber(3, "uncovered", null));
delete uncovered.sibling;
show("a deleted field uncovers the prototype's", readFiber(uncovered));
delete Fiber.prototype.sibling;

const accessor = hide(new Fiber(4, "accessor", null));
let reads = 0;
Object.defineProperty(accessor, "key", { get() { return "got " + ++reads; }, set(v) { reads = 100; }, configurable: true, enumerable: true });
show("a field redefined as an accessor", readFiber(accessor));
show("a store calls its setter", storeIntoFiber(accessor, "stored"));

const removed = hide(new Fiber(13, "removed", null));
remove(removed, "child");
show("a field deleted by code that nobody sees", readFiber(removed));
const redefined = hide(new Fiber(14, "redefined", null));
define(redefined, "memo", { get() { return "computed"; }, configurable: true, enumerable: false });
show("a field redefined by code that nobody sees", readFiber(redefined));
show("deleted in the middle of a reader by such code", readAcrossACall(hide(new Fiber(15, "there", null)), fiber => { remove(fiber, "key"); remove(fiber, "sibling"); }));
show("deleted in the middle of a reader", readAcrossACall(hide(new Fiber(5, "there", null)), fiber => { delete fiber.key; delete fiber.sibling; }));
show("left alone in the middle of a reader", readAcrossACall(hide(new Fiber(6, "there", null)), () => {}));

let seen;
function Early(key) {
  this.tag = 1;
  seen = readEarly(this);
  this.key = key;
  this.next = null;
}
function readEarly(early) {
  return [early.tag, early.key, early.next, Object.keys(early).join()];
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
const forOther = hide(Reflect.construct(Fiber, [7, "for another new.target", null], Other));
show("made for another new.target", [readFiber(forOther), forOther.marker, forOther instanceof Fiber]);
class Setter { set key(v) { this.hidden = v; } }
const underSetter = hide(Reflect.construct(Fiber, [8, "under a setter", null], Setter));
show("a setter above takes the store", [readFiber(underSetter), underSetter.hidden]);

define(Fiber.prototype, "key", { set(v) { this.hidden = v; }, configurable: true });
const lateSetter = hide(new Fiber(10, "a setter has arrived", null));
show("a setter that arrived above takes the store", [readFiber(lateSetter), lateSetter.hidden]);
remove(Fiber.prototype, "key");
define(Fiber.prototype, "sibling", { value: "read-only above", writable: false, configurable: true });
const underReadOnly = hide((() => { try { return new Fiber(11, "read-only above", null); } catch (error) { return error.constructor.name; } })());
show("a read-only property that arrived above refuses the store", typeof underReadOnly === "string" ? underReadOnly : readFiber(underReadOnly));
remove(Fiber.prototype, "sibling");
show("and all is as before", readFiber(hide(new Fiber(12, "as before", null))));

const calledOn = hide({ own: true });
Fiber.call(calledOn, 9, "called on", null);
show("the constructor was called on another object", readFiber(calledOn));

const hook = hide(new Hook(1, "queue"));
show("an instance of a class", readHook(hook));
Object.defineProperty(hook, "queue", { value: "fixed", writable: false });
show("a field made read-only", readHook(hook));
const frozen = hide(Object.freeze(new Hook(2, "frozen")));
show("a frozen instance", readHook(frozen));
const copy = hide({ ...new Hook(3, "copied") });
show("a copy", readHook(copy));
const heir = hide(Object.create(new Hook(4, "inherited")));
show("an heir", [readHook(heir), Object.keys(heir).join()]);

console.log(out.join("\n"));
