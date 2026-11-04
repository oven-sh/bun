// A store by name into an object of a known layout that was frozen, sealed, closed to new properties, or one of whose properties was made read only.
// Strict code throws where the store is refused, and the object stays as it was. Each function has stored into open objects many times before it meets a closed one.
class Point {
  x: number;
  y: number;
  label?: string;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
interface Pair {
  first: number;
  second: number;
  note?: string;
}
function Legacy(this: any, a: number, b: number) {
  this.a = a;
  this.b = b;
}

const closings: [string, (o: object) => void][] = [
  ["open", () => {}],
  ["frozen", o => void Object.freeze(o)],
  ["sealed", o => void Object.seal(o)],
  ["not extensible", o => void Object.preventExtensions(o)],
  ["not extensible by Reflect", o => void Reflect.preventExtensions(o)],
  ["frozen twice", o => void Object.freeze(Object.freeze(o))],
  ["sealed, then frozen", o => void Object.freeze(Object.seal(o))],
];

function describe(o: object) {
  return `${JSON.stringify(o)} keys=${Object.keys(o).join()} frozen=${Object.isFrozen(o)} sealed=${Object.isSealed(o)} extensible=${Object.isExtensible(o)}`;
}
function say(what: string, run: () => unknown) {
  try {
    console.log(what, "->", String(run()));
  } catch (e: any) {
    console.log(what, "->", e.constructor.name + ": " + e.message);
  }
}

function storeX(p: Point, v: number) {
  p.x = v;
  return p.x;
}
function storeBoth(p: Point, v: number) {
  p.x = v;
  p.y = v + 1;
  return p.x * 100 + p.y;
}
function storeLabel(p: Point, v: string) {
  p.label = v;
  return p.label;
}
function storeThenAdd(p: Point, v: number) {
  p.y = v;
  p.label = "l" + v;
  p.x = v + 2;
  return p.x;
}
function addInLoop(p: Point, n: number) {
  for (let i = 0; i < n; i++) {
    p.x += i;
    p.y = p.x - i;
  }
  return p.x * 1000 + p.y;
}
function storeFirst(p: Pair, v: number) {
  p.first = v;
  return p.first;
}
function storeNote(p: Pair, v: string) {
  p.note = v;
  return p.note;
}
function storePair(p: Pair, v: number) {
  p.second = v;
  p.first = v * 2;
  return p.first + p.second;
}
function storeA(o: any, v: number) {
  o.a = v;
  return o.a;
}
function storeOfUnknown(o: any, v: number) {
  o.x = v;
  o.y = v;
  return o.x + o.y;
}
function increment(p: Point) {
  p.x++;
  ++p.y;
  return p.x + p.y;
}
function compound(p: Point, v: number) {
  p.x *= v;
  p.y ||= v;
  p.label ??= "set";
  return `${p.x} ${p.y} ${p.label}`;
}

for (let i = 0; i < 300; i++) {
  const p = new Point(i, i);
  storeX(p, 1);
  storeBoth(p, 2);
  storeLabel(p, "a");
  storeThenAdd(new Point(i, 1), 3);
  addInLoop(p, 3);
  const pair: Pair = { first: i, second: i };
  storeFirst(pair, 1);
  storeNote(pair, "n");
  storePair(pair, 2);
  storeA(new (Legacy as any)(1, 2), 3);
  storeOfUnknown(p, 4);
  increment(p);
  compound(new Point(1, 0), 2);
}

for (const [name, close] of closings) {
  const made = <T extends object>(o: T) => (close(o), o);
  let p: Point, pair: Pair, legacy: any;

  say(`${name}: storeX`, () => storeX((p = made(new Point(1, 2))), 7));
  console.log(" ", describe(p!));
  say(`${name}: storeBoth`, () => storeBoth((p = made(new Point(1, 2))), 7));
  console.log(" ", describe(p!));
  say(`${name}: storeLabel`, () => storeLabel((p = made(new Point(1, 2))), "new"));
  console.log(" ", describe(p!));
  say(`${name}: storeThenAdd`, () => storeThenAdd((p = made(new Point(1, 2))), 7));
  console.log(" ", describe(p!));
  say(`${name}: addInLoop`, () => addInLoop((p = made(new Point(1, 2))), 4));
  console.log(" ", describe(p!));
  say(`${name}: storeFirst`, () => storeFirst((pair = made({ first: 1, second: 2 })), 7));
  console.log(" ", describe(pair!));
  say(`${name}: storeNote`, () => storeNote((pair = made({ first: 1, second: 2 })), "new"));
  console.log(" ", describe(pair!));
  say(`${name}: storeNote that is there`, () => storeNote((pair = made({ first: 1, second: 2, note: "old" })), "new"));
  console.log(" ", describe(pair!));
  say(`${name}: storePair`, () => storePair((pair = made({ first: 1, second: 2 })), 7));
  console.log(" ", describe(pair!));
  say(`${name}: storeA`, () => storeA((legacy = made(new (Legacy as any)(1, 2))), 7));
  console.log(" ", describe(legacy));
  say(`${name}: storeOfUnknown`, () => storeOfUnknown((p = made(new Point(1, 2))), 7));
  console.log(" ", describe(p!));
  say(`${name}: increment`, () => increment((p = made(new Point(1, 2)))));
  console.log(" ", describe(p!));
  say(`${name}: compound`, () => compound((p = made(new Point(1, 0))), 5));
  console.log(" ", describe(p!));
}

// One property is made read only, hidden from lists, an accessor, and writable again.
const redefinitions: [string, PropertyDescriptor][] = [
  ["read only", { writable: false }],
  ["read only with a value", { value: 40, writable: false }],
  ["not listed", { enumerable: false }],
  ["fixed", { configurable: false }],
  ["a getter alone", { get: () => 41 }],
  ["a setter alone", { set(this: any, v: number) { this.y = v * 10; } }],
  ["both", { get: () => 42, set(this: any, v: number) { this.y = v * 100; } }],
];
for (const [name, descriptor] of redefinitions) {
  let p!: Point;
  say(`x is ${name}: storeX`, () => storeX((p = Object.defineProperty(new Point(1, 2), "x", descriptor)), 7));
  console.log(" ", describe(p), JSON.stringify(Object.getOwnPropertyDescriptor(p, "x")));
  say(`x is ${name}: storeBoth`, () => storeBoth((p = Object.defineProperty(new Point(1, 2), "x", descriptor)), 7));
  console.log(" ", describe(p));
  say(`x is ${name}: addInLoop`, () => addInLoop((p = Object.defineProperty(new Point(1, 2), "x", descriptor)), 3));
  console.log(" ", describe(p));
  say(`x is ${name}, then plain again: storeX`, () => {
    p = Object.defineProperty(new Point(1, 2), "x", descriptor);
    Object.defineProperty(p, "x", { value: 3, writable: true, enumerable: true, configurable: true });
    return storeX(p, 7);
  });
  console.log(" ", describe(p));
}

// The property is deleted, and the object closed behind that: the store would have to create it.
for (const [name, close] of closings) {
  let p!: Point;
  say(`x deleted, ${name}: storeX`, () => {
    p = new Point(1, 2);
    delete (p as any).x;
    close(p);
    return storeX(p, 7);
  });
  console.log(" ", describe(p));
}
