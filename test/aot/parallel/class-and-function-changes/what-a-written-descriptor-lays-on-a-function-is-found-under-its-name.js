// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the functions and objects laid on a function is asked again at run time
// A written descriptor lays a value on a function: what is read under the name is that value, read only or not. Each block is a way in which the function, the name or the value leaves that shape.
"use strict";
function tryTo(deed) {
  try { return deed(); } catch (error) { return error.name; }
}
function make(name) {
  function init(inst, by) { inst.total += by.n; return inst.total; }
  function made(start) { this.total = start; }
  Object.defineProperty(made, "init", { value: init });
  Object.defineProperty(made, "label", { value: { text: name }, writable: true, enumerable: true });
  return made;
}
const One = make("one"), Two = make("two");
const first = new One(1), second = new Two(10);
console.log(One.init(first, { n: 2 }), Two.init(second, { n: 3 }), One.init(first, { n: 4 }), One.label.text, Two.label.text, Object.keys(One).join());
console.log(tryTo(() => { One.init = () => 0; }), One.init(first, { n: 1 }), tryTo(() => { One.label = { text: "anew" }; return One.label.text; }), Two.label.text);
console.log(tryTo(() => delete One.init), tryTo(() => Object.defineProperty(One, "init", { value: 5 })), typeof One.init);

function plain() { return 1; }
Object.defineProperty(plain, "held", { value: { mark: 1 }, configurable: true });
console.log(plain.held.mark);
Object.defineProperty(plain, "held", { value: "text", configurable: true });
console.log(plain.held.length);
Object.defineProperty(plain, "held", { get() { return this === plain ? "by a getter" : "another this"; }, configurable: true });
console.log(plain.held);
console.log(delete plain.held, plain.held);

function either(flag) {
  const record = { id: 1 };
  function other() {}
  const subject = flag ? record : other;
  Object.defineProperty(subject, "held", { value: { from: flag ? "record" : "function" } });
  return subject.held.from;
}
console.log(either(true), either(false));

function handedOut() {}
const kept = { seen: 0 };
Object.defineProperty(handedOut, "held", { value: kept });
globalThis.madeUpHolder = handedOut;
globalThis.madeUpHolder.held.seen += 5;
console.log(kept.seen);

const arrow = () => 2;
Object.defineProperty(arrow, "name", { value: "renamed" });
Object.defineProperty(arrow, "length", { value: 7 });
console.log(arrow.name, arrow.length, arrow());
class Klass { static own = 1; }
Object.defineProperty(Klass, "laid", { value: { on: "a class" } });
console.log(Klass.laid.on, Klass.own, Object.keys(Klass).join());
const bound = plain.bind(null);
Object.defineProperty(bound, "held", { value: { on: "a bound function" } });
console.log(bound.held.on, plain.held);
