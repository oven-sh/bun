// In sloppy code a store that a frozen, sealed or closed object refuses does nothing and says nothing. The body of a class beside it is strict code, and throws.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
function Legacy(a, b) {
  this.a = a;
  this.b = b;
}

const closings = [
  ["open", () => {}],
  ["frozen", o => void Object.freeze(o)],
  ["sealed", o => void Object.seal(o)],
  ["not extensible", o => void Object.preventExtensions(o)],
];

function describe(o) {
  return `${JSON.stringify(o)} keys=${Object.keys(o).join()} frozen=${Object.isFrozen(o)} sealed=${Object.isSealed(o)} extensible=${Object.isExtensible(o)}`;
}
function say(what, run) {
  try {
    console.log(what, "->", String(run()));
  } catch (e) {
    console.log(what, "->", e.constructor.name + ": " + e.message);
  }
}

function storeX(p, v) {
  p.x = v;
  return p.x;
}
class Strict {
  static storeX(p, v) {
    p.x = v;
    return p.x;
  }
  static storeNew(p, v) {
    p.label = v;
    return p.label;
  }
}
const storeXStrictly = Strict.storeX;
const storeNewStrictly = Strict.storeNew;
function storeBoth(p, v) {
  p.x = v;
  p.y = v + 1;
  return p.x * 100 + p.y;
}
function storeNew(p, v) {
  p.label = v;
  return p.label;
}
function addInLoop(p, n) {
  for (let i = 0; i < n; i++) {
    p.x += i;
    p.y = p.x - i;
  }
  return p.x * 1000 + p.y;
}
function storeFirst(p, v) {
  p.first = v;
  p.second = v + 1;
  return p.first + p.second;
}
function storeA(o, v) {
  o.a = v;
  return o.a;
}
function valueOfStore(p, v) {
  return (p.x = v);
}
function overList(list, v) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.x = v + i;
    p.y = v - i;
    sum = sum * 7 + p.x + p.y * 3;
  }
  return sum;
}

for (let i = 0; i < 300; i++) {
  const p = new Point(i, i);
  storeX(p, 1);
  storeXStrictly(p, 1);
  storeBoth(p, 2);
  storeNew(p, "a");
  storeNewStrictly(new Point(1, 2), "a");
  addInLoop(p, 3);
  storeFirst({ first: i, second: i }, 1);
  storeA(new Legacy(1, 2), 3);
  valueOfStore(p, 4);
  overList([p, new Point(1, 2)], 5);
}

for (const [name, close] of closings) {
  const made = o => (close(o), o);
  let o;
  say(`${name}: storeX`, () => storeX((o = made(new Point(1, 2))), 7));
  console.log(" ", describe(o));
  say(`${name}: storeXStrictly`, () => storeXStrictly((o = made(new Point(1, 2))), 7));
  console.log(" ", describe(o));
  say(`${name}: storeBoth`, () => storeBoth((o = made(new Point(1, 2))), 7));
  console.log(" ", describe(o));
  say(`${name}: storeNew`, () => storeNew((o = made(new Point(1, 2))), "new"));
  console.log(" ", describe(o));
  say(`${name}: storeNewStrictly`, () => storeNewStrictly((o = made(new Point(1, 2))), "new"));
  console.log(" ", describe(o));
  say(`${name}: addInLoop`, () => addInLoop((o = made(new Point(1, 2))), 4));
  console.log(" ", describe(o));
  say(`${name}: storeFirst`, () => storeFirst((o = made({ first: 1, second: 2 })), 7));
  console.log(" ", describe(o));
  say(`${name}: storeA`, () => storeA((o = made(new Legacy(1, 2))), 7));
  console.log(" ", describe(o));
  say(`${name}: valueOfStore`, () => valueOfStore((o = made(new Point(1, 2))), 7));
  console.log(" ", describe(o));
  say(`${name}: overList`, () => overList([new Point(1, 2), (o = made(new Point(3, 4))), new Point(5, 6)], 7));
  console.log(" ", describe(o));
}

for (const [name, descriptor] of [
  ["read only", { writable: false }],
  ["a getter alone", { get: () => 41 }],
  ["both", { get: () => 42, set(v) { this.y = v * 100; } }],
]) {
  let o;
  say(`x is ${name}: storeX`, () => storeX((o = Object.defineProperty(new Point(1, 2), "x", descriptor)), 7));
  console.log(" ", describe(o));
  say(`x is ${name}: storeXStrictly`, () => storeXStrictly((o = Object.defineProperty(new Point(1, 2), "x", descriptor)), 7));
  console.log(" ", describe(o));
  say(`x is ${name}: addInLoop`, () => addInLoop((o = Object.defineProperty(new Point(1, 2), "x", descriptor)), 3));
  console.log(" ", describe(o));
}

// `this` of a sloppy constructor function that is called on an object which is closed.
for (const [name, close] of closings) {
  const target = { a: 0, b: 0 };
  close(target);
  say(`${name}: Legacy.call`, () => Legacy.call(target, 5, 6));
  console.log(" ", describe(target));
  const empty = {};
  close(empty);
  say(`${name}: Legacy.call on an empty object`, () => Legacy.call(empty, 5, 6));
  console.log(" ", describe(empty));
  const own = new Legacy(1, 2);
  close(own);
  say(`${name}: Legacy.call on an object of its own`, () => Legacy.call(own, 5, 6));
  console.log(" ", describe(own));
}
