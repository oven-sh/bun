// Static fields of classes that are evaluated once, twice and many times.
const say = (...values) => console.log(...values.map(value => (typeof value === "string" ? value : JSON.stringify(value))));
const attempt = body => {
  try {
    return body();
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
};
const own = object => Reflect.ownKeys(object).map(String).join();
const described = (object, key) => {
  const found = Object.getOwnPropertyDescriptor(object, key);
  return found ? [typeof found.value, found.writable, found.enumerable, found.configurable] : found;
};
let calls = [];
class Root {
  static get inherited() { return "got"; }
  static set inherited(value) { calls.push(value); }
  static method() { return "method"; }
  static value = "root";
}
Object.defineProperty(Root, "fixed", { value: "fixed", writable: false });

const factories = {
  one: i => class { static tag = i; },
  two: i => class { static tag = i; static other = [i]; },
  five: i => class { static a = i; static b = i; static c = i; static d = i; static e = i; },
  empty: () => class { static tag; },
  named: i => class Named { static tag = i; },
  withMethods: i => class { static tag = i; static make() { return new this(); } get() { return 1; } },
  withName: i => class { static name = "own" + i; static tag = i; },
  withLength: i => class { static length = i; static tag = i; },
  withThis: i => class Own { static tag = this; static again = Own.tag === this; static i = i; },
  withComputed: i => class { static ["k" + (i % 2)] = i; static tag = i; },
  withIndex: i => class { static 0 = i; static tag = i; },
  withBlock: i => class { static tag = i; static { this.late = this.tag + 1; } },
  withAccessor: i => class { static get tag() { return i; } static other = i; },
  shadowing: i => class { static tag = i; static tag = -i; },
  overMethod: i => class { static tag() {} static tag = i; },
  withPrivate: i => class { static #hidden = i; static tag = this.#hidden; static peek() { return this.#hidden; } },
  withInstance: i => class { static tag = i; field = i; },
  heir: i => class extends Root { static tag = i; static inherited = i; static value = i; static fixed = i; static method = i; },
  heirOfHeir: i => class extends class extends Root { static tag = -i; } { static tag = i; },
  symbolKey: i => class { static [Symbol.toStringTag] = "T" + i; static tag = i; },
  functions: i => class { static tag = () => i; static other = function () { return i; }; },
  hasInstance: i => class { static [Symbol.hasInstance](value) { return value === i; } static tag = i; },
  displayed: i => class { static displayName = "D" + i; static tag = i; },
  throwing: i => class { static tag = i % 7 === 3 ? (() => { throw new RangeError("at " + i); })() : i; static after = i; },
};
for (const [name, make] of Object.entries(factories)) {
  calls = [];
  let last, failures = 0;
  for (let i = 0; i < 60; i++) {
    const made = attempt(() => make(i));
    if (typeof made === "string") failures++;
    else last = made;
  }
  say(name, own(last), described(last, "tag"), described(last, "other"), typeof last.tag === "function" ? last.tag.name : last.tag === last ? "self" : last.tag, last.name, last.length, failures, calls.length);
}

// The class object behind its definition.
for (const [name, make] of Object.entries(factories)) {
  let found;
  for (let i = 8; i < 14; i++) {
    const made = attempt(() => make(i));
    if (typeof made === "string") continue;
    const other = attempt(() => make(i + 100));
    attempt(() => { made.tag = "changed"; });
    made.added = i;
    delete made.other;
    found = [attempt(() => String(made.tag)), own(made), typeof other === "string" ? other.split(":")[0] : own(other), typeof other === "string" || Object.getPrototypeOf(made) === Object.getPrototypeOf(other), new made() instanceof made];
  }
  say("behind", name, found);
}

// A setter, a read-only value and a frozen parent above: a field is defined, not set.
for (let i = 0; i < 30; i++) {
  calls = [];
  class Late { }
  if (i % 3 === 1) Object.defineProperty(Late, "tag", { set(value) { calls.push(value); } });
  if (i % 3 === 2) Object.freeze(Late);
  const made = class extends Late { static tag = i; };
  if (i > 26) say("above", i % 3, own(made), made.tag, calls.length);
}
function below(Parent, i) { return class extends Parent { static tag = i; static label = "below"; }; }
for (let i = 0; i < 40; i++) {
  const first = below(i % 2 ? Root : class { static tag = "parent"; }, i);
  const second = below(first, -i);
  first.later = i;
  if (i > 37) say("below", first.tag, second.tag, second.later, own(first), own(second), Object.getPrototypeOf(second) === first);
}

// In a loop, read and stored at once, kept through collections.
function inLoop(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const made = class { static tag = i; static next = i + 1; };
    made.tag++;
    sum += made.tag + made.next;
  }
  return sum;
}
say("inLoop", inLoop(1), inLoop(2), inLoop(300));
const kept = [];
for (let i = 0; i < 240; i++) {
  const made = factories.five(i);
  made.f = { deep: "deep" + i };
  made.g = i;
  if (i % 24 === 0) kept.push(made);
  if (i % 60 === 0) Bun.gc(true);
}
Bun.gc(true);
say("kept", kept.map(made => [made.a, made.e, made.f.deep, made.g, own(made).length]));

// Evaluated once, then again; and a class of the top that is never evaluated again.
function seldom(i) { return class { static count = i; static list = []; }; }
const first = seldom(1);
first.count += 10;
first.list.push("first");
const second = seldom(2);
second.count += 20;
second.list.push("second");
say("seldom", first.count, second.count, first.list, second.list, own(first), own(second));
class Once { static count = 0; static bump() { return ++this.count; } }
Once.bump();
Once.bump();
say("once", Once.count, own(Once), described(Once, "count"));
const copies = [0, 1, 2].map(i => { class Copy { static count = i; static bump() { return ++Copy.count; } } Copy.bump(); return Copy; });
say("copies", copies.map(Copy => [Copy.count, Copy.bump(), Copy.count]));
for (const refuse of [Object.preventExtensions, Object.seal, Object.freeze]) {
  for (let i = 0; i < 5; i++) {
    const result = attempt(() => class { static own = refuse(this); static tag = i; });
    if (i === 4) say("refuse", typeof result === "string" ? result.split(":")[0] : own(result));
  }
}
