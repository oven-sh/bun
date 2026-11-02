// Arrow functions that class fields and constructors give an instance: over nothing and over the instance itself. What a program can find out about them must not depend on when they are made.
const log: string[] = [];

class Reader {
  count = 0;
  onData = () => ++this.count;
  label = "reader";
  onEnd: () => number;
  onError = () => -1;
  constructor(public id: number) {
    this.onEnd = () => this.count + this.id;
  }
}

class OnlyHandlers {
  first = () => this;
  second = () => 2;
  third = (left: number, right: number) => left + right;
}

class Base {
  tag = 1;
  handle = () => this.tag;
}
class Derived extends Base {
  extra = () => this.tag + 1;
}

class ThrowsHalfWay {
  before = () => this.name;
  name: string;
  after = () => "after";
  constructor(name: string, seen: any[]) {
    seen.push(this);
    if (name === "bad") throw new Error("half way: " + Object.keys(this).join());
    this.name = name;
  }
}

class ShowsItselfEarly {
  early = () => 1;
  observed = describe(this);
  late = () => this.observed;
}

class UsesNewTarget {
  target: unknown;
  who = () => this.target;
  constructor() {
    this.target = new.target;
  }
}
class BelowNewTarget extends UsesNewTarget {}

class UnderAccessor {
  declare assigned: () => string;
  defined = () => "defined";
  constructor() {
    this.assigned = () => "assigned";
  }
}

function describe(value: any): string {
  const parts: string[] = [];
  for (const key in value) parts.push(key + ":" + typeof value[key]);
  return parts.join() + " | " + Object.keys(value).join() + " | " + JSON.stringify(value);
}

const unseen = new Function("object", "action", `
  switch (action) {
  case "call": return object.onData() + object.onEnd() + object.onError();
  case "replace": object.onData = () => 100; return object.onData();
  case "number": object.onEnd = 7; return object.onEnd;
  case "undefined": object.onError = undefined; return "onError" in object;
  case "delete": return delete object.onData;
  case "getter": Object.defineProperty(object, "onEnd", { get() { return () => "from a getter"; }, configurable: true, enumerable: true }); return object.onEnd();
  case "hidden": Object.defineProperty(object, "onError", { enumerable: false }); return Object.keys(object).join();
  case "tag": object.onError.tag = "kept"; return object.onError.tag;
  case "freeze": Object.freeze(object); return Object.isFrozen(object);
  case "seal": Object.seal(object); return Object.isSealed(object);
  case "construct": return new object.constructor(41);
  case "reflect": return Reflect.construct(object.constructor, [42], function Other() {});
  }
`);

let sum = 0;
const kept: Reader[] = [];
for (let i = 0; i < 3000; i++) {
  const reader = new Reader(i);
  if (i % 7 === 0) sum += reader.onData() + reader.onEnd();
  if (i % 200 === 0) kept.push(reader);
}
console.log(sum, kept.length);

const [a, b, c, d, e, f, g, h, i, j, k, untouched, other] = kept;
console.log(a.onData === a.onData, a.onData === b.onData, a.onEnd === a.onEnd, a.onEnd === b.onEnd, a.onError === a.onError, a.onError === b.onError);
console.log(a.onData.name, a.onEnd.name, a.onError.name, a.onData.length, typeof a.onEnd, "prototype" in a.onData, Object.getPrototypeOf(a.onError) === Function.prototype);
console.log(describe(untouched), "onData" in untouched, Object.hasOwn(untouched, "onEnd"), untouched.hasOwnProperty("onError"), "missing" in untouched);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(other, "onData")), typeof Object.getOwnPropertyDescriptor(other, "onEnd")!.value, Reflect.ownKeys(other).join());
console.log(unseen(a, "call"), a.count, unseen(b, "replace"), b.onData(), b.count, describe(b));
console.log(unseen(c, "number"), (c as any).onEnd, c.onData(), describe(c));
console.log(unseen(d, "undefined"), (d as any).onError, d.onEnd(), describe(d));
console.log(unseen(e, "delete"), "onData" in e, (e as any).onData, e.onEnd(), describe(e));
e.onData = () => 5;
console.log(e.onData(), describe(e));
console.log(unseen(f, "getter"), (f.onEnd as any)(), f.onData(), describe(f));
console.log(unseen(g, "hidden"), g.onError(), describe(g));
console.log(unseen(h, "tag"), (h.onError as any).tag, (i.onError as any).tag, describe(h));
console.log(unseen(i, "freeze"), i.onEnd(), i.onEnd === i.onEnd, describe(i));
try { "use strict"; (i as any).onData = null; } catch (error) { console.log((error as Error).constructor.name); }
console.log(typeof i.onData, unseen(j, "seal"), j.onData(), j.onData === j.onData, describe(j));
const constructed = unseen(k, "construct");
console.log(constructed instanceof Reader, describe(constructed), constructed.onEnd(), constructed.onData(), constructed.onData === constructed.onData, constructed.onData === k.onData);
const reflected = unseen(k, "reflect");
console.log(reflected instanceof Reader, describe(reflected), reflected.onEnd(), reflected.onData(), reflected.onError(), reflected.onData === reflected.onData);

const fresh = new Reader(77);
const copy = { ...fresh };
const assigned = Object.assign({}, fresh);
console.log(copy.onData === fresh.onData, assigned.onEnd === fresh.onEnd, copy.onData(), fresh.count, copy.count, describe(copy));
const cloned = Object.create(Object.getPrototypeOf(fresh), Object.getOwnPropertyDescriptors(fresh));
console.log(cloned.onError === fresh.onError, cloned.onEnd(), cloned instanceof Reader, describe(cloned));
console.log(Object.entries(new Reader(5)).map(([key, value]) => key + "=" + (typeof value === "function" ? (value as Function).name : value)).join());
console.log(Object.values(new Reader(6)).map(value => typeof value).join(), [new Reader(8).onError].map(each => each()).join());
const { onData: taken, onEnd: alsoTaken } = new Reader(9);
console.log(taken(), taken(), alsoTaken());
const weak = new WeakMap<object, string>();
weak.set(untouched.onEnd, "found");
console.log(weak.get(untouched.onEnd), weak.has(other.onEnd));

const handlers = new OnlyHandlers();
console.log(handlers.first() === handlers, handlers.second(), handlers.third(2, 3), handlers.third.length, describe(handlers), new OnlyHandlers().first === handlers.first);
console.log(handlers.first.call(null) === handlers, handlers.first.bind({})() === handlers, Reflect.apply(handlers.second, undefined, []));

const base = new Base();
const derived = new Derived();
console.log(base.handle(), derived.handle(), derived.extra(), describe(base), describe(derived), derived.handle === derived.handle, base.handle === derived.handle);
derived.tag = 10;
console.log(derived.handle(), derived.extra(), base.handle());

const seen: any[] = [];
console.log(describe(new ThrowsHalfWay("good", seen)));
try {
  new ThrowsHalfWay("bad", seen);
} catch (error) {
  console.log((error as Error).message);
}
console.log(seen.length, describe(seen[1]), seen[1].before(), seen[1].after(), seen[1].before === seen[1].before, seen[0].before());

const early = new ShowsItselfEarly();
console.log(early.observed, "|", describe(early), "|", early.late() === early.observed);

console.log(new UsesNewTarget().who() === UsesNewTarget, new BelowNewTarget().who() === BelowNewTarget, describe(new BelowNewTarget()));
console.log((Reflect.construct(UsesNewTarget, [], BelowNewTarget) as UsesNewTarget).who() === BelowNewTarget, Reflect.construct(UsesNewTarget, [], BelowNewTarget) instanceof BelowNewTarget);

console.log(describe(new UnderAccessor()), new UnderAccessor().assigned(), new UnderAccessor().defined());
Object.defineProperty(UnderAccessor.prototype, "assigned", { set(value) { log.push("setter got " + typeof value); }, get() { return () => "from the prototype"; }, configurable: true });
Object.defineProperty(UnderAccessor.prototype, "defined", { set(value) { log.push("never called"); }, get() { return () => "never read"; }, configurable: true });
const under = new UnderAccessor();
console.log(describe(under), under.assigned(), under.defined(), Object.hasOwn(under, "assigned"), Object.hasOwn(under, "defined"), log.join());
