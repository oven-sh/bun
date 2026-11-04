// COUNTER: ObjectsLaidBelowOtherPrototype >= 40
// No statement of the program changes a prototype link or a member of a class. Code that the build has not seen relinks instances, prototype objects and class objects, and replaces, hides, deletes and adds members,
// between two accesses of one function, in the middle of a loop and below two calls.
import vm from "node:vm";

class Animal {
  legs: number;
  declare sound: string | undefined;
  constructor(legs: number) {
    this.legs = legs;
  }
  speak(): string {
    return "animal " + this.legs;
  }
  get double(): number {
    return this.legs * 2;
  }
  static kind(): string {
    return "kind of " + this.name;
  }
}

class Dog extends Animal {
  name: string;
  constructor(name: string) {
    super(4);
    this.name = name;
  }
  speak(): string {
    return this.name + " after " + super.speak();
  }
  fetch(): string {
    return this.name + " fetches";
  }
}

type Deed = (dog: Dog) => void;

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (value !== null && typeof value === "object") return "object";
  return String(value);
}

function attempt(act: () => unknown): string {
  try {
    return show(act());
  } catch (error) {
    return (error as Error).name;
  }
}

function look(dog: Dog): string {
  return [
    attempt(() => dog.speak()),
    attempt(() => dog.fetch()),
    attempt(() => dog.double),
    attempt(() => dog.sound),
    attempt(() => dog.legs),
    attempt(() => dog instanceof Dog),
    attempt(() => dog instanceof Animal),
    attempt(() => Dog.kind()),
    attempt(() => (dog.constructor as any).name),
    attempt(() => "fetch" in dog),
    attempt(() => String(dog)),
    attempt(() => (dog as any).extra),
  ].join(" ");
}

function between(dog: Dog, deed: Deed): string {
  const before = dog.speak() + dog.double;
  deed(dog);
  return before + " " + look(dog);
}

function storesBetween(dog: Dog, deed: Deed): string {
  dog.legs = 3;
  deed(dog);
  return attempt(() => (dog.sound = "woof")) + attempt(() => dog.sound) + attempt(() => (dog.legs = 5)) + attempt(() => dog.legs) + attempt(() => Object.keys(dog).join());
}

function inLoop(dog: Dog, deed: Deed): string {
  let text = "";
  for (let turn = 0; turn < 8; turn++) {
    if (turn === 5) deed(dog);
    text += attempt(() => dog.fetch() + dog.double + dog.speak().length) + ";";
  }
  return text;
}

function lowest(dog: Dog, deed: Deed): string {
  deed(dog);
  return attempt(() => dog.fetch());
}

function belowCalls(dog: Dog, deed: Deed): string {
  const first = dog.fetch();
  return first + lowest(dog, deed) + attempt(() => dog.fetch()) + attempt(() => new Dog("new").speak());
}

const unseen = (text: string): any => (0, eval)(text);

// Each deed on a class is undone by what it returns, so that the next one finds the classes as they are written.
const deeds: [string, (dog: Dog) => void | (() => void)][] = [
  ["instance below null", unseen("d => { Object.setPrototypeOf(d, null); }")],
  ["instance below an ordinary object", unseen("d => { Object.setPrototypeOf(d, { fetch() { return 'ordinary'; }, sound: 'inherited', extra: 1 }); }")],
  ["instance below the class above", unseen("d => { Object.setPrototypeOf(d, Object.getPrototypeOf(Object.getPrototypeOf(d))); }")],
  ["instance below an object below its class", unseen("d => { Object.setPrototypeOf(d, Object.create(Object.getPrototypeOf(d), { fetch: { value() { return 'between'; } } })); }")],
  ["__proto__ stored", unseen("d => { d.__proto__ = { speak() { return 'proto'; } }; }")],
  ["Reflect.setPrototypeOf", unseen("d => { Reflect.setPrototypeOf(d, { get double() { return 'reflected'; } }); }")],
  ["relinked in another realm", vm.runInNewContext("d => { Object.setPrototypeOf(d, { fetch() { return 'far'; } }); }")],
  ["relinked and put back", unseen("d => { const p = Object.getPrototypeOf(d); Object.setPrototypeOf(d, null); Object.setPrototypeOf(d, p); }")],
  ["below a proxy", unseen("d => { Object.setPrototypeOf(d, new Proxy(Object.getPrototypeOf(d), { get(t, k, r) { return k === 'sound' ? 'trapped' : Reflect.get(t, k, r); } })); }")],
  ["setter for the field that is left out, above", unseen("d => { const p = Object.getPrototypeOf(d); Object.defineProperty(p, 'sound', { set(v) { this.legs = 99; }, get() { return 'from above'; }, configurable: true }); return () => { delete p.sound; }; }")],
  ["read-only value for the field that is left out, above", unseen("d => { const p = Object.getPrototypeOf(Object.getPrototypeOf(d)); Object.defineProperty(p, 'sound', { value: 'fixed above', writable: false, configurable: true }); return () => { delete p.sound; }; }")],
  ["own property hides a method", unseen("d => { d.fetch = () => 'own'; }")],
  ["own accessor hides a method", unseen("d => { Object.defineProperty(d, 'speak', { get() { return () => 'own accessor'; } }); }")],
  ["own value hides an accessor", unseen("d => { Object.defineProperty(d, 'double', { value: 'own value' }); }")],
  ["method replaced", unseen("d => { const p = Object.getPrototypeOf(d), old = p.fetch; p.fetch = function () { return 'replaced ' + this.name; }; return () => { p.fetch = old; }; }")],
  ["method replaced above", unseen("d => { const p = Object.getPrototypeOf(Object.getPrototypeOf(d)), old = p.speak; p.speak = () => 'replaced above'; return () => { p.speak = old; }; }")],
  ["method deleted", unseen("d => { const p = Object.getPrototypeOf(d), old = p.fetch; delete p.fetch; return () => { Object.defineProperty(p, 'fetch', { value: old, writable: true, configurable: true }); }; }")],
  ["method hidden below the class above", unseen("d => { const p = Object.getPrototypeOf(d); p.double = 0; Object.defineProperty(p, 'double', { value: 'hides', configurable: true }); return () => { delete p.double; }; }")],
  ["method turned into an accessor", unseen("d => { const p = Object.getPrototypeOf(d), old = p.fetch; Object.defineProperty(p, 'fetch', { get() { return () => 'by accessor'; }, configurable: true }); return () => { Object.defineProperty(p, 'fetch', { value: old, writable: true, configurable: true }); }; }")],
  ["accessor replaced", unseen("d => { const p = Object.getPrototypeOf(Object.getPrototypeOf(d)), old = Object.getOwnPropertyDescriptor(p, 'double'); Object.defineProperty(p, 'double', { get() { return 'other getter'; } }); return () => { Object.defineProperty(p, 'double', old); }; }")],
  ["member added", unseen("d => { const p = Object.getPrototypeOf(d); p.extra = 'added'; return () => { delete p.extra; }; }")],
  ["prototype object relinked", unseen("d => { const p = Object.getPrototypeOf(d), old = Object.getPrototypeOf(p); Object.setPrototypeOf(p, { speak() { return 'elsewhere'; }, extra: 2 }); return () => { Object.setPrototypeOf(p, old); }; }")],
  ["prototype object frozen copy", unseen("d => { const p = Object.getPrototypeOf(d); Object.setPrototypeOf(d, Object.freeze(Object.create(p, { sound: { value: 'frozen above', writable: false } }))); }")],
  ["static member replaced", unseen("d => { const c = Object.getPrototypeOf(d.constructor), old = c.kind; c.kind = () => 'replaced kind'; return () => { c.kind = old; }; }")],
  ["static member hidden", unseen("d => { const c = d.constructor; c.kind = () => 'hidden kind'; return () => { delete c.kind; }; }")],
  ["class object relinked", unseen("d => { const c = d.constructor, old = Object.getPrototypeOf(c); Object.setPrototypeOf(c, Function.prototype); return () => { Object.setPrototypeOf(c, old); }; }")],
  ["Symbol.hasInstance", unseen("d => { const c = d.constructor; Object.defineProperty(c, Symbol.hasInstance, { value: () => false, configurable: true }); return () => { delete c[Symbol.hasInstance]; }; }")],
  ["Symbol.toPrimitive", unseen("d => { const p = Object.getPrototypeOf(d); p[Symbol.toPrimitive] = () => 'primitive'; return () => { delete p[Symbol.toPrimitive]; }; }")],
  ["constructor property", unseen("d => { const p = Object.getPrototypeOf(d), old = p.constructor; p.constructor = function Other() {}; return () => { p.constructor = old; }; }")],
];

const probes: [string, (dog: Dog, deed: Deed) => string][] = [
  ["between", between],
  ["stores between", storesBetween],
  ["in a loop", inLoop],
  ["below calls", belowCalls],
];

for (let turn = 0; turn < 50; turn++) {
  for (const [, probe] of probes) probe(new Dog("d" + turn), () => {});
}

for (const [name, deed] of deeds) {
  for (const [where, probe] of probes) {
    let undo: void | (() => void);
    console.log(name + " | " + where + ": " + probe(new Dog("rex"), dog => void (undo = deed(dog))));
    if (undo) undo();
    console.log("  afterwards: " + look(new Dog("next")));
  }
}
