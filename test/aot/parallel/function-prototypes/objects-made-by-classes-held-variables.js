// `new` of a class that a variable holds asks the class object for its `prototype` each time. Nobody has looked at the properties of these class objects when the first
// objects are made: one class many times, many classes in turn, derived classes, another new.target, classes made again by one text, and all of it again after a collection
// and after somebody has looked.
function given(text) { return JSON.parse(text); }
class Leaf { constructor(name) { this.name = name; } describe() { return "leaf " + this.name; } }
class Branch { constructor(name) { this.name = name; this.children = []; } describe() { return "branch " + this.name; } }
class Twig extends Branch { constructor(name) { super(name); this.thin = true; } describe() { return "twig " + super.describe(); } }
class Bud extends Twig { describe() { return "bud " + super.describe(); } }
function Plain(name) { this.name = name; }
const makers = { Leaf, Branch, Twig, Bud, Plain };
const names = given('["Leaf","Branch","Twig","Bud","Plain"]');
function make(maker, name) { return new maker(name); }
function show(made) {
  const prototype = Object.getPrototypeOf(made);
  const of = names.findIndex(name => makers[name].prototype === prototype);
  return `${made.name}:${made.describe ? made.describe() : "-"}:${of}:${Object.keys(made).join()}`;
}

// Before anybody reads a property of a class object: only `new`.
const early = [];
for (let i = 0; i < 3000; i++) early.push(make(makers[names[i % 5]], "n" + (i % 7)));
let count = 0;
for (let i = 0; i < 3000; i++) count += early[i] instanceof makers[names[i % 5]] ? 1 : 0;
console.log(count, show(early[0]), show(early[1]), show(early[2]), show(early[3]), show(early[4]));

// Another new.target: the object lies under the prototype of new.target and is made by the constructor.
for (const constructor of ["Leaf", "Branch", "Twig"]) {
  for (const target of names) {
    const made = Reflect.construct(makers[constructor], ["r"], makers[target]);
    console.log(constructor, target, show(made), made instanceof makers[target], made instanceof makers[constructor]);
  }
}
const bound = Leaf.bind(null, "bound");
console.log(show(new bound()), show(Reflect.construct(Branch, ["b"], bound)));
const asked = [];
const proxy = new Proxy(Twig, { get(target, key, receiver) { asked.push(String(key)); return Reflect.get(target, key, receiver); } });
console.log(show(new proxy("p")), show(Reflect.construct(Leaf, ["q"], proxy)), asked.join());
const lying = new Proxy(Twig, { get() { return Leaf.prototype; } });
try { new lying("l"); } catch (error) { console.log(error.constructor.name); }

// One text makes many classes: each has a prototype object of its own. More of them than any table has places.
function define(index) { return class Kind { constructor(name) { this.name = name; } which() { return index; } }; }
const kinds = [];
for (let i = 0; i < 200; i++) kinds.push(define(i));
let right = 0;
for (let round = 0; round < 20; round++) {
  for (let i = 0; i < kinds.length; i++) {
    const made = make(kinds[(i * 7 + round) % kinds.length], "k");
    right += made.which() === (i * 7 + round) % kinds.length && Object.getPrototypeOf(made) === kinds[(i * 7 + round) % kinds.length].prototype ? 1 : 0;
  }
}
console.log(right);

// Classes that die and others that take their cells.
function churn(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const Kind = define(i);
    const Below = class extends Kind { which() { return super.which() + 1; } };
    sum += make(Kind, "a").which() + make(Below, "b").which() + (Object.getPrototypeOf(make(Below, "c")) === Below.prototype ? 1 : 0);
    if (i % 500 === 499) Bun.gc(true);
  }
  return sum;
}
console.log(churn(3000));

// What lies above a prototype object changes; the prototype object stays.
const above = { describe() { return "above"; }, extra() { return "extra"; } };
Object.setPrototypeOf(Leaf.prototype, above);
delete Leaf.prototype.describe;
console.log(show(make(makers.Leaf, "late")), make(makers.Leaf, "x").extra());
Branch.prototype.describe = function () { return "changed " + this.name; };
console.log(show(make(makers.Branch, "c")), show(make(makers.Twig, "d")), show(make(makers.Bud, "e")));

// `prototype` of a class cannot be replaced; that of a plain function can.
"use strict";
for (const attempt of [() => { Leaf.prototype = {}; }, () => Object.defineProperty(Leaf, "prototype", { value: {} }), () => delete Leaf.prototype, () => Reflect.set(Leaf, "prototype", {})]) {
  let answer;
  try { answer = String(attempt()); } catch (error) { answer = error.constructor.name; }
  console.log(answer, show(make(makers.Leaf, "still")));
}
Plain.prototype = { describe() { return "plain " + this.name; } };
console.log(show(make(makers.Plain, "f")));
Plain.prototype = 1;
console.log(Object.getPrototypeOf(make(makers.Plain, "g")) === Object.prototype);

// After a collection, and after the class objects were looked at.
Bun.gc(true);
console.log(names.map(name => show(make(makers[name], "gc"))).join(" "));
console.log(names.map(name => Object.getOwnPropertyNames(makers[name]).sort().join()).join(" "));
Leaf.marked = 1; Twig.marked = 2;
console.log(names.map(name => show(make(makers[name], "seen"))).join(" "), Bud.marked, Object.getPrototypeOf(Bud) === Twig);
Object.setPrototypeOf(Bud, Leaf);
console.log(show(make(makers.Bud, "moved")), Bud.marked);
