import { isDeepStrictEqual } from "node:util";
import assert from "node:assert";

const say = (name, value) => console.log(name, value);

function compare(name, left, right) {
  const answers = [];
  for (const [a, b] of [
    [left, right],
    [right, left],
  ]) {
    answers.push(Bun.deepEquals(a, b), Bun.deepEquals(a, b, true), isDeepStrictEqual(a, b));
    let thrown = "equal";
    try {
      assert.deepEqual(a, b);
    } catch (error) {
      thrown = error.code;
    }
    answers.push(thrown);
  }
  say(name, answers.join(" "));
}

function point(x, y) {
  return { x, y };
}
function named(name, options) {
  return { name, options };
}

const values = [
  0,
  -0,
  1,
  1.5,
  -1.5,
  NaN,
  2 ** 31,
  2 ** 53,
  1n,
  10n ** 20n,
  "",
  "a",
  "ab",
  ["a", "b"].join(""),
  true,
  false,
  null,
  undefined,
  Symbol.iterator,
  Symbol.for("s"),
  /a/,
  /a/g,
  new Date(0),
  new Date(1),
  new Date(NaN),
  [1],
  [1, 2],
  { a: 1 },
  { a: 2 },
  new Map([[1, 2]]),
  new Set([1]),
  new Uint8Array([1]),
  new Error("a"),
  new Error("b"),
  function f() {},
  () => {},
  Promise,
  new Number(1),
  new String("a"),
  Object.create(null),
];
values.forEach((left, i) => {
  const line = [];
  values.forEach((right, j) => {
    const a = point(left, i);
    const b = point(right, i);
    line.push((Bun.deepEquals(a, b) ? 1 : 0) | (Bun.deepEquals(a, b, true) ? 2 : 0) | (isDeepStrictEqual(a, b) ? 4 : 0));
  });
  say(`value ${i}`, line.join(""));
});

// Numbers of either kind in one field.
for (const [a, b] of [
  [1, 1],
  [1, 1.0000000000000002],
  [0, -0],
  [NaN, 0 / 0],
  [4294967295, 2 ** 32 - 1],
])
  compare(`numbers ${a} ${b}`, point(a, 0.5), point(b, 0.5));

// Fields that are missing, deleted, undefined or in another order.
function partly(withA, withB, withC) {
  const object = {};
  if (withA) object.a = 1;
  if (withB) object.b = undefined;
  if (withC) object.c = 3;
  return object;
}
for (let i = 0; i < 8; i++) for (let j = i; j < 8; j++) compare(`partly ${i} ${j}`, partly(i & 1, i & 2, i & 4), partly(j & 1, j & 2, j & 4));

const removed = point(1, 2);
delete removed.x;
compare("removed", removed, point(1, 2));
const removedToo = point(1, 2);
delete removedToo.x;
compare("removed from both", removed, removedToo);
removedToo.x = 1;
compare("created again at the end", removedToo, point(1, 2));
compare("other order", { x: 1, y: 2 }, { y: 2, x: 1 });

// Properties that the layouts lack.
const withExtra = point(1, 2);
withExtra["extra" + values.length] = 1;
const withSameExtra = point(1, 2);
withSameExtra["extra" + values.length] = 1;
const withOtherExtra = point(1, 2);
withOtherExtra["extra" + values.length] = 2;
compare("extra", withExtra, point(1, 2));
compare("same extra", withExtra, withSameExtra);
compare("other extra", withExtra, withOtherExtra);
const withElement = point(1, 2);
withElement[0] = 1;
compare("element", withElement, point(1, 2));

// Frozen, sealed and not extensible objects.
compare("frozen", Object.freeze(point(1, 2)), point(1, 2));
compare("sealed", Object.seal(point(1, 2)), Object.preventExtensions(point(1, 2)));
compare("frozen with another value", Object.freeze(point(1, 3)), point(1, 2));

// Attributes and accessors.
const hidden = point(1, 2);
Object.defineProperty(hidden, "y", { enumerable: false });
compare("hidden", hidden, point(1, 2));
const readOnly = point(1, 2);
Object.defineProperty(readOnly, "y", { writable: false });
compare("read only", readOnly, point(1, 2));
let reads = 0;
const makeGetter = value => ({
  get x() {
    reads++;
    return value;
  },
  y: 2,
});
compare("getters", makeGetter(1), makeGetter(1));
compare("getters of other values", makeGetter(1), makeGetter(2));
compare("getter and field", makeGetter(1), point(1, 2));
say("getters were read", reads > 0);

// Symbols.
const symbol = Symbol("key");
const withSymbol = value => ({ x: 1, [symbol]: value });
compare("symbols", withSymbol(1), withSymbol(1));
compare("symbols of other values", withSymbol(1), withSymbol(2));
compare("symbol missing", withSymbol(1), { x: 1 });

// Classes, private fields and prototypes.
class Plain {
  a = 1;
  b;
  constructor(b) {
    this.b = b;
  }
}
class WithPrivate {
  #secret;
  open = 1;
  constructor(secret) {
    this.#secret = secret;
  }
  static same(x, y) {
    return x.#secret === y.#secret;
  }
}
class Derived extends Plain {
  c = 3;
}
compare("class", new Plain(1), new Plain(1));
compare("class of other values", new Plain(1), new Plain(2));
compare("class and derived", new Plain(1), new Derived(1));
compare("class and literal", new Plain(1), { a: 1, b: 1 });
compare("private", new WithPrivate(1), new WithPrivate(1));
compare("private of other values", new WithPrivate(1), new WithPrivate(2));
say("private is read", WithPrivate.same(new WithPrivate(1), new WithPrivate(2)));
const reparented = point(1, 2);
Object.setPrototypeOf(reparented, { z: 1 });
compare("reparented", reparented, point(1, 2));
compare("without prototype", Object.assign(Object.create(null), { x: 1, y: 2 }), point(1, 2));

// Nested objects, cycles and shared parts.
const shared = { deep: [1, { deeper: "a" }] };
compare("nested", named("n", { deep: [1, { deeper: "a" }] }), named("n", shared));
compare("nested of other values", named("n", { deep: [1, { deeper: "b" }] }), named("n", shared));
compare("shared", named(shared, shared), named(shared, { deep: [1, { deeper: "a" }] }));
function cycle(length, end) {
  const first = { next: null, end: null };
  let last = first;
  for (let i = 1; i < length; i++) last = last.next = { next: null, end: null };
  last.next = first;
  last.end = end;
  return first;
}
compare("cycles", cycle(3, 1), cycle(3, 1));
compare("cycles of other values", cycle(3, 1), cycle(3, 2));
compare("cycles of other lengths", cycle(2, null), cycle(4, null));
const self = named("self", null);
self.options = self;
const selfToo = named("self", null);
selfToo.options = selfToo;
compare("self", self, selfToo);

// Methods are functions of their own.
const withMethod = value => ({
  value,
  method() {
    return value;
  },
});
compare("methods", withMethod(1), withMethod(1));
const one = withMethod(1);
compare("one object", one, one);
compare("same method", { value: 1, method: one.method }, { value: 1, method: one.method });

// A property named asymmetricMatch is compared like any other here.
const matcher = { asymmetricMatch: other => other === 1, x: 1 };
compare("matcher", matcher, { asymmetricMatch: matcher.asymmetricMatch, x: 1 });
compare("matcher and value", named("a", matcher), named("a", 1));

// Many, in a loop.
let equal = 0;
for (let i = 0; i < 2000; i++) equal += Bun.deepEquals(point(i % 7, "s" + (i % 5)), point(i % 3, "s" + (i % 5))) ? 1 : 0;
say("equal", equal);
