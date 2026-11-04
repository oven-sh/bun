// `this` of a constructor is an object that nobody else has, until the constructor itself closes it, a class above has closed it, a class above hands back another object, or the function is called on an object that somebody made.
function describe(o) {
  return `${JSON.stringify(o)} keys=${Object.keys(o).join()} frozen=${Object.isFrozen(o)} sealed=${Object.isSealed(o)} extensible=${Object.isExtensible(o)}`;
}
function say(what, run) {
  try {
    const result = run();
    console.log(what, "->", typeof result === "object" && result ? describe(result) : String(result));
  } catch (e) {
    console.log(what, "->", e.constructor.name + ": " + e.message);
  }
}

let seen;
class FreezesItself {
  constructor() {
    seen = this;
    this.a = 1;
    Object.freeze(this);
    this.b = 2;
  }
}
class FreezesItselfAndStoresAgain {
  constructor() {
    seen = this;
    this.a = 1;
    Object.freeze(this);
    this.a = 2;
  }
}
class SealsItself {
  constructor() {
    seen = this;
    this.a = 1;
    Object.seal(this);
    this.a = 2;
    this.b = 3;
  }
}
class ClosesItselfFirst {
  constructor() {
    seen = this;
    Object.preventExtensions(this);
    this.a = 1;
  }
}
class FreezesAtTheEnd {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    Object.freeze(this);
  }
}
class MayFreeze {
  constructor(freezes) {
    seen = this;
    this.a = 1;
    if (freezes) Object.freeze(this);
    this.a = 2;
    this.b = 3;
  }
}
class FreezesInAMethod {
  constructor() {
    seen = this;
    this.a = 1;
    this.close();
    this.b = 2;
  }
  close() {
    Object.freeze(this);
  }
}
class HandsItselfOut {
  constructor(hook) {
    seen = this;
    this.a = 1;
    hook(this);
    this.b = 2;
  }
}

class FrozenAbove {
  constructor() {
    seen = this;
    this.base = 1;
    Object.freeze(this);
  }
}
class FieldBelowFrozen extends FrozenAbove {
  y = 1;
}
class StoreBelowFrozen extends FrozenAbove {
  constructor() {
    super();
    this.y = 1;
  }
}
class StoreOfBaseFieldBelowFrozen extends FrozenAbove {
  constructor() {
    super();
    this.base = 2;
  }
}
class ClosedAbove {
  constructor() {
    seen = this;
    this.base = 1;
    Object.preventExtensions(this);
  }
}
class FieldBelowClosed extends ClosedAbove {
  y = 1;
}
class StoreBelowClosed extends ClosedAbove {
  constructor() {
    super();
    this.base = 2;
    this.y = 1;
  }
}

class HandsBack {
  constructor(o) {
    return o;
  }
}
class FieldOnWhatWasHandedBack extends HandsBack {
  z = 1;
}
class StoreOnWhatWasHandedBack extends HandsBack {
  constructor(o) {
    super(o);
    this.w = 2;
  }
}

function Plain(a, b) {
  this.a = a;
  this.b = b;
}
function PlainThatFreezes(a) {
  seen = this;
  this.a = a;
  Object.freeze(this);
  this.b = a;
}
function PlainThatClosesFirst(a) {
  seen = this;
  Object.preventExtensions(this);
  this.a = a;
}
function Upper(a) {
  this.a = a;
  Object.freeze(this);
}
function Lower(a, b) {
  seen = this;
  Upper.call(this, a);
  this.b = b;
}
Object.setPrototypeOf(Lower.prototype, Upper.prototype);

for (let i = 0; i < 300; i++) {
  new FreezesAtTheEnd(i, i);
  new MayFreeze(false);
  new HandsItselfOut(() => {});
  new Plain(i, i);
  new FieldOnWhatWasHandedBack({});
  new StoreOnWhatWasHandedBack({});
}

for (const Class of [FreezesItself, FreezesItselfAndStoresAgain, SealsItself, ClosesItselfFirst, FreezesInAMethod, FieldBelowFrozen, StoreBelowFrozen, StoreOfBaseFieldBelowFrozen, FieldBelowClosed, StoreBelowClosed]) {
  seen = undefined;
  say(`new ${Class.name}`, () => new Class());
  console.log(" ", seen ? describe(seen) : "nothing seen");
}
say("new FreezesAtTheEnd", () => new FreezesAtTheEnd(1, 2));
say("store into what FreezesAtTheEnd made", () => {
  const o = new FreezesAtTheEnd(1, 2);
  o.a = 3;
  return o;
});
say("new MayFreeze(false)", () => new MayFreeze(false));
say("new MayFreeze(true)", () => new MayFreeze(true));
console.log(" ", describe(seen));
for (const [name, hook] of [
  ["nothing", () => {}],
  ["freeze", o => void Object.freeze(o)],
  ["seal", o => void Object.seal(o)],
  ["preventExtensions", o => void Object.preventExtensions(o)],
  ["b read only", o => void Object.defineProperty(o, "b", { value: 9, writable: false })],
  ["b a setter", o => void Object.defineProperty(o, "b", { set(v) { this.a = v * 10; }, configurable: true })],
]) {
  say(`new HandsItselfOut, ${name}`, () => new HandsItselfOut(hook));
  console.log(" ", describe(seen));
}

for (const [name, make] of [
  ["open", () => ({})],
  ["frozen", () => Object.freeze({})],
  ["sealed", () => Object.seal({})],
  ["closed", () => Object.preventExtensions({})],
  ["frozen, with the names", () => Object.freeze({ z: 0, w: 0 })],
  ["sealed, with the names", () => Object.seal({ z: 0, w: 0 })],
]) {
  let o;
  say(`${name}: new FieldOnWhatWasHandedBack`, () => new FieldOnWhatWasHandedBack((o = make())));
  console.log(" ", describe(o));
  say(`${name}: new StoreOnWhatWasHandedBack`, () => new StoreOnWhatWasHandedBack((o = make())));
  console.log(" ", describe(o));
}

say("new Plain", () => new Plain(1, 2));
say("new PlainThatFreezes", () => new PlainThatFreezes(1));
console.log(" ", describe(seen));
say("new PlainThatClosesFirst", () => new PlainThatClosesFirst(1));
console.log(" ", describe(seen));
say("new Lower", () => new Lower(1, 2));
console.log(" ", describe(seen));
for (const [name, make] of [
  ["an open object", () => ({})],
  ["a frozen object", () => Object.freeze({})],
  ["a frozen object with the names", () => Object.freeze({ a: 0, b: 0 })],
  ["a sealed object with the names", () => Object.seal({ a: 0, b: 0 })],
  ["a sealed object with one name", () => Object.seal({ a: 0 })],
  ["a frozen object of its own", () => Object.freeze(new Plain(0, 0))],
  ["a closed object of its own", () => Object.preventExtensions(new Plain(0, 0))],
  ["an object of its own that lost a name and was closed", () => { const o = new Plain(0, 0); delete o.b; return Object.preventExtensions(o); }],
]) {
  let o;
  say(`Plain.call on ${name}`, () => Plain.call((o = make()), 5, 6));
  console.log(" ", describe(o));
  say(`Plain.apply on ${name}`, () => Plain.apply((o = make()), [5, 6]));
  console.log(" ", describe(o));
  say(`Reflect.apply of Plain on ${name}`, () => Reflect.apply(Plain, (o = make()), [5, 6]));
  console.log(" ", describe(o));
}
say("Reflect.construct of Plain", () => Reflect.construct(Plain, [1, 2]));
say("Reflect.construct of Plain for another function", () => {
  function Other() {}
  const o = Reflect.construct(Plain, [1, 2], Other);
  return `${describe(o)} ${o instanceof Other} ${o instanceof Plain}`;
});
say("Plain bound and constructed", () => new (Plain.bind(null, 1))(2));
