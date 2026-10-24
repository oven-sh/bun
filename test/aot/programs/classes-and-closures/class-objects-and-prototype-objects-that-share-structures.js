// Class objects without static members share a Structure per parent, the prototype objects of functions start in one Structure, and a member that compiled code defines enters the Structure of its holder in place. What happens to one object must never show on another, and each must look as in plain Bun.
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.name;
  }
}

function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      const kind = "value" in descriptor ? typeof descriptor.value : (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "");
      const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
      return String(key) + ":" + kind + ":" + flags;
    })
    .join(" ");
}

// Each of these is one place in the program that sees every class.
function prototypeOf(K) {
  return K.prototype;
}
function nameOf(K) {
  return K.name;
}
function extraOf(K) {
  return K.extra;
}
function hasExtra(K) {
  return "extra" in K;
}
function construct(K) {
  return new K();
}
function isInstance(value, K) {
  return value instanceof K;
}

function report(title, classes) {
  console.log(title);
  for (const K of classes) {
    const instance = construct(K);
    const others = classes.filter(L => L !== K && isInstance(instance, L)).length;
    console.log("  " + String(nameOf(K)) + " | " + describe(K) + " | " + describe(prototypeOf(K)) + " | " + (prototypeOf(K).constructor === K) + " " + instance.m() + " " + isInstance(instance, K) + " " + others + " " + String(extraOf(K)) + " " + hasExtra(K) + " " + Object.isExtensible(K) + " " + Object.isFrozen(K) + " " + (Object.getPrototypeOf(K) === Function.prototype));
  }
}

const touches = [
  K => typeof K.prototype,
  K => K.name,
  K => K.length,
  K => Object.keys(K).length,
  K => (K.extra = "stored"),
  K => Object.defineProperty(K, "extra", { value: "defined", enumerable: false, configurable: true, writable: false }) === K,
  K => delete K.name,
  K => Object.freeze(K) === K,
  K => Object.setPrototypeOf(K, null) === K,
  K => Object.preventExtensions(K) === K,
  K => (K[0] = "indexed"),
  K => Object.getOwnPropertyNames(K).join(),
  K => (K.prototype = null),
  K => delete K.prototype,
  K => Object.assign(K, { extra: "assigned", more: 1 }) === K,
  K => K.hasOwnProperty("extra"),
];

class A1 { m() { return "A1"; } }
class A2 { m() { return "A2"; } }
class A3 { m() { return "A3"; } }
class A4 { m() { return "A4"; } }
class A5 { m() { return "A5"; } }
class A6 { m() { return "A6"; } }
class A7 { m() { return "A7"; } }
class A8 { m() { return "A8"; } }
class A9 { m() { return "A9"; } }
class A10 { m() { return "A10"; } }
class A11 { m() { return "A11"; } }
class A12 { m() { return "A12"; } }
class A13 { m() { return "A13"; } }
class A14 { m() { return "A14"; } }
class A15 { m() { return "A15"; } }
class A16 { m() { return "A16"; } }
const firstTouched = [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15, A16];
console.log("first touches: " + firstTouched.map((K, index) => attempt(() => touches[index](K))).join(", "));
report("after a different first touch each", firstTouched);

// All of these own `prototype` and nothing else when one after the other changes.
class B1 { m() { return "B1"; } }
class B2 { m() { return "B2"; } }
class B3 { m() { return "B3"; } }
class B4 { m() { return "B4"; } }
class B5 { m() { return "B5"; } }
class B6 { m() { return "B6"; } }
class B7 { m() { return "B7"; } }
class B8 { m() { return "B8"; } }
class B9 { m() { return "B9"; } }
class B10 { m() { return "B10"; } }
class B11 { m() { return "B11"; } }
class B12 { m() { return "B12"; } }
class B13 { m() { return "B13"; } }
class B14 { m() { return "B14"; } }
class B15 { m() { return "B15"; } }
class B16 { m() { return "B16"; } }
const madeAlike = [B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14, B15, B16];
console.log("constructors: " + madeAlike.every(K => prototypeOf(K).constructor === K));
function digest(classes) {
  return classes.map(K => Reflect.ownKeys(K).length + (hasExtra(K) ? "x" : "") + (Object.isExtensible(K) ? "" : "n") + (construct(K) instanceof K ? "" : "!")).join(" ");
}
madeAlike.forEach((K, index) => {
  console.log("  " + attempt(() => touches[index](K)) + ": " + digest(madeAlike));
});
report("after each changed in turn", madeAlike);

// One parent, with static members of its own.
class Base {
  static kind = "base";
  static create() {
    return new this();
  }
  m() {
    return "Base";
  }
}
class D1 extends Base { m() { return "D1"; } }
class D2 extends Base { m() { return "D2"; } }
class D3 extends Base {}
class D4 extends Base { m() { return "D4"; } }
const derived = [D1, D2, D3, D4];
function kindOf(K) {
  return K.kind;
}
function create(K) {
  return K.create();
}
function inherited(title) {
  console.log(title + ": " + [Base, ...derived].map(K => kindOf(K) + "/" + attempt(() => create(K).m()) + "/" + describe(K) + "/" + (Object.getPrototypeOf(K) === Base)).join(", "));
}
inherited("as defined");
D2.kind = "own";
inherited("D2.kind stored");
Base.kind = "changed";
inherited("Base.kind stored");
D1.create = function () {
  return { m: () => "replaced" };
};
inherited("D1.create stored");
delete Base.create;
inherited("Base.create deleted");
Object.setPrototypeOf(D4, D1);
inherited("D4 under D1");
Base.create = function () {
  return new this();
};
inherited("Base.create stored");

// Parents that the program does not define.
class E1 extends Error {}
class E2 extends Error {}
class E3 extends Error { get name() { return "E3!"; } }
class L1 extends Array {}
class L2 extends Array {}
class N1 extends null {}
class N2 extends null {}
for (const K of [E1, E2, E3, L1, L2, N1, N2])
  console.log(nameOf(K) + " | " + describe(K) + " | " + describe(prototypeOf(K)) + " | " + attempt(() => construct(K) instanceof K) + " " + attempt(() => construct(K) instanceof E2) + " " + attempt(() => construct(K) instanceof L2) + " " + hasExtra(K));
E1.extra = "E1";
L1.extra = "L1";
N1.extra = "N1";
console.log([E1, E2, E3, L1, L2, N1, N2].map(K => String(extraOf(K)) + ":" + describe(K)).join(" "));
delete E1.extra;
console.log([E1, E2, E3, L1, L2, N1, N2].map(K => String(extraOf(K)) + ":" + hasExtra(K)).join(" "));

// Static members of the same names, read and stored in one place.
class S1 { static x = 1; static f() { return "S1.f"; } m() { return "S1"; } }
class S2 { static x = 2; static f() { return "S2.f"; } m() { return "S2"; } }
class S3 { static x = 3; static f() { return "S3.f"; } m() { return "S3"; } }
class S4 { static f() { return "S4.f"; } static x = 4; m() { return "S4"; } }
class S5 { m() { return "S5"; } }
const withStatics = [S1, S2, S3, S4, S5];
function readX(K) {
  return K.x;
}
function storeX(K, value) {
  K.x = value;
}
function callF(K) {
  return K.f();
}
for (let round = 0; round < 3; ++round) {
  console.log(withStatics.map(K => String(readX(K)) + ":" + attempt(() => callF(K))).join(" "));
  for (const K of withStatics)
    storeX(K, String(readX(K)) + round);
}
console.log(withStatics.map(describe).join(" | "));

// A class becomes a parent after it got its properties, before, and while nothing has looked at it at all.
class P1 { m() { return "P1"; } }
console.log(describe(P1));
class C1 extends P1 {}
class P2 { m() { return "P2"; } }
class C2 extends P2 {}
console.log(describe(P2));
class P3 { m() { return "P3"; } }
class C3 extends P3 {}
class C4 extends P3 {}
for (const [P, C] of [[P1, C1], [P2, C2], [P3, C3], [P3, C4]]) {
  console.log(hasExtra(C) + " " + String(extraOf(C)));
  P.extra = "from " + nameOf(P);
  console.log(hasExtra(C) + " " + String(extraOf(C)) + " " + describe(C) + " " + describe(P) + " " + construct(C).m() + " " + (Object.getPrototypeOf(C) === P) + " " + (Object.getPrototypeOf(prototypeOf(C)) === prototypeOf(P)));
  delete P.extra;
}
report("parents and the rest", [P1, P2, P3, A1, B1, S5]);

// Members that the class record cannot create.
function makeKey(text) {
  return text;
}
const symbol = Symbol("symbol");
class M1 {
  z() { return "z"; }
  [makeKey("k1")]() { return "k1"; }
  a() { return "a"; }
  get [makeKey("g")]() { return "get g"; }
  set [makeKey("g")](value) {}
  static [makeKey("s1")]() { return "s1"; }
  static b() { return "b"; }
  [symbol]() { return "symbol"; }
  static [symbol]() { return "static symbol"; }
  get p() { return "get p"; }
  set p(value) {}
  [makeKey("z")]() { return "z again"; }
  set [makeKey("only")](value) {}
  static get [makeKey("sg")]() { return "static get"; }
}
console.log(describe(M1) + " | " + describe(M1.prototype));
const m1 = new M1();
console.log([m1.z(), m1.k1(), m1.a(), m1.g, M1.s1(), M1.b(), m1[symbol](), M1[symbol](), m1.p, m1.only, M1.sg].join(", "));

let M2;
{
  const hidden = "hidden";
  M2 = class M2 {
    first() { return hidden + 1; }
    second() { return hidden + 2; }
    static third() { return hidden + 3; }
    get fourth() { return hidden + 4; }
  };
}
console.log(describe(M2) + " | " + describe(M2.prototype) + " | " + [new M2().first(), new M2().second(), M2.third(), new M2().fourth].join(", "));

class M3 {
  static zebra() {}
  static name() { return "static name"; }
  static ant() {}
  static [makeKey("length")]() { return "static length"; }
  static tail() {}
  static [makeKey("displayName")]() { return "static displayName"; }
  static last() {}
}
console.log(describe(M3) + " | " + M3.name() + " " + M3.length() + " " + M3.displayName());

class M4 {
  1() { return 1; }
  b() {}
  0() { return 0; }
  [makeKey("2")]() { return 2; }
  [makeKey("c")]() {}
  static 3() { return 3; }
  static [makeKey("4")]() { return 4; }
  static [makeKey("d")]() {}
}
console.log(describe(M4) + " | " + describe(M4.prototype) + " | " + [new M4()[0](), new M4()[1](), new M4()[2](), M4[3](), M4[4]()].join(", "));

class M5 {
  __proto__() { return "method"; }
  [makeKey("__proto__")]() { return "computed"; }
  [makeKey("constructor")]() { return "computed constructor"; }
  static [makeKey("constructor")]() { return "static constructor"; }
  [makeKey("toString")]() { return "M5 as text"; }
}
console.log(describe(M5) + " | " + describe(M5.prototype) + " | " + [new M5().__proto__(), new M5().constructor(), M5.constructor(), String(new M5())].join(", "));

console.log(attempt(() => {
  class M6 {
    a() {}
    [(() => { throw new RangeError("key"); })()]() {}
    b() {}
  }
  return M6;
}));

function factory(tag) {
  return class {
    [makeKey("m" + tag)]() { return "m" + tag; }
    common() { return "common" + tag; }
    static [makeKey("s" + tag)]() { return "s" + tag; }
  };
}
const F1 = factory("1");
const F2 = factory("2");
const F3 = factory("1");
console.log([F1, F2, F3].map(K => describe(K) + " | " + describe(K.prototype) + " | " + new K().common()).join(" || "));
console.log((F1.prototype.m1 !== F3.prototype.m1) + " " + (F1.s1 !== F3.s1) + " " + ("m1" in F2.prototype) + " " + ("s2" in F1) + " " + new F3().m1() + " " + F2.s2());

// A member is replaced, removed and added after calls have seen the first one.
function callZ(object) {
  return object.z();
}
function callLate(object) {
  return attempt(() => object.late());
}
for (let i = 0; i < 3; ++i)
  console.log(callZ(m1) + " " + callLate(m1));
M1.prototype.z = function () {
  return "z replaced";
};
M1.prototype.late = function () {
  return "late";
};
console.log(callZ(m1) + " " + callLate(m1) + " | " + describe(M1.prototype));
delete M1.prototype.z;
delete M1.prototype.late;
console.log(attempt(() => callZ(m1)) + " " + callLate(m1) + " | " + describe(M1.prototype));

// Constructor functions.
function Animal(name) {
  this.name = name;
}
function Plain1() {}
function Plain2() {}
function Plain3() {}
function Plain4() {}
function Plain5() {}
console.log(describe(Animal) + " | " + describe(Animal.prototype) + " | " + (Animal.prototype.constructor === Animal));
Animal.prototype.speak = function () {
  return this.name + " speaks";
};
Animal.prototype.walk = function () {
  return this.name + " walks";
};
Object.defineProperty(Animal.prototype, "legs", { get() { return 4; }, configurable: true });
Animal.prototype[symbol] = "symbol";
console.log(describe(Animal.prototype) + " | " + describe(Plain1.prototype) + " | " + ("speak" in Plain2.prototype));
const animal = new Animal("animal");
function speak(object) {
  return object.speak();
}
function later(object) {
  return object.later;
}
for (let i = 0; i < 3; ++i)
  console.log(speak(animal) + ", " + animal.walk() + ", " + animal.legs + ", " + String(later(animal)) + ", " + String(later(Animal.prototype)) + ", " + String(later(Plain1.prototype)));
Animal.prototype.later = "later";
Animal.prototype.speak = function () {
  return this.name + " speaks again";
};
console.log(speak(animal) + ", " + String(later(animal)) + ", " + String(later(Animal.prototype)) + ", " + String(later(Plain1.prototype)) + ", " + String(later(new Plain1())));

function Dog(name) {
  Animal.call(this, name);
}
Dog.prototype.fetch = function () {
  return this.name + " fetches";
};
Object.setPrototypeOf(Dog.prototype, Animal.prototype);
function Cat(name) {
  Animal.call(this, name);
}
Cat.prototype = Object.create(Animal.prototype, { constructor: { value: Cat, writable: true, configurable: true } });
Cat.prototype.speak = function () {
  return this.name + " meows";
};
const dog = new Dog("dog");
const cat = new Cat("cat");
console.log([speak(dog), dog.fetch(), speak(cat), cat.walk(), dog instanceof Animal, cat instanceof Animal, dog instanceof Cat, animal instanceof Dog, later(dog), later(cat)].join(", "));
console.log(describe(Dog.prototype) + " | " + describe(Cat.prototype) + " | " + describe(Dog) + " | " + describe(Cat));
Dog.prototype.speak = function () {
  return this.name + " barks";
};
delete Animal.prototype.later;
console.log([speak(dog), speak(cat), speak(animal), String(later(dog)), String(later(cat))].join(", "));

// The prototype object of a function is an object like any other.
console.log((Plain1.prototype !== Plain2.prototype) + " " + [Plain1, Plain2, Plain3, Plain4, Plain5].every(F => prototypeOf(F).constructor === F));
Plain1.prototype.x = 1;
Plain1.prototype.y = 2;
Plain2.prototype.y = 2;
Plain2.prototype.x = 1;
delete Plain3.prototype.constructor;
Object.freeze(Plain4.prototype);
console.log(attempt(() => (Plain4.prototype.x = 1)) + " " + attempt(() => delete Plain4.prototype.constructor));
Plain5.prototype.constructor = Plain1;
for (const F of [Plain1, Plain2, Plain3, Plain4, Plain5]) {
  const names = [];
  for (const name in prototypeOf(F))
    names.push(name);
  console.log(describe(prototypeOf(F)) + " | " + names.join() + " | " + JSON.stringify(prototypeOf(F)) + " | " + Object.keys(prototypeOf(F)).join() + " | " + (construct(F).constructor === F) + " " + (construct(F) instanceof F) + " " + String(construct(F).x));
}

function* Generator1() {}
function* Generator2() {}
async function* AsyncGenerator1() {}
Generator1.prototype.extra = "Generator1";
console.log([Generator1, Generator2, AsyncGenerator1].map(F => describe(F) + " | " + describe(prototypeOf(F)) + " | " + String(F().extra) + " " + (Object.getPrototypeOf(F()) === prototypeOf(F))).join(" || "));
console.log([() => {}, async () => {}, { method() {} }.method, async function () {}, Plain1.bind(null)].map(F => describe(F) + " " + String(prototypeOf(F))).join(" | "));
