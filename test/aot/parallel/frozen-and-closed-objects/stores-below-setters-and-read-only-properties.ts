// A store under a name that an object above the receiver answers for: a setter, a getter alone, a property that is read only.
// While the receiver has the property itself, what lies above is hidden. Where it lacks the property (never stored, or deleted) the setter runs or the store is refused.
// What lies above may be written in the class, be defined later, come with another prototype, and go again.
const log: string[] = [];
function describe(o: object) {
  return `${JSON.stringify(o)} keys=${Object.keys(o).join()}`;
}
function say(what: string, run: () => unknown) {
  log.length = 0;
  try {
    console.log(what, "->", String(run()), log.join(","));
  } catch (e: any) {
    console.log(what, "->", e.constructor.name + ": " + e.message, log.join(","));
  }
}

class Box {
  width: number;
  depth?: number;
  constructor(width: number) {
    this.width = width;
  }
}
function storeWidth(b: Box, v: number) {
  b.width = v;
  return b.width;
}
function storeDepth(b: Box, v: number) {
  b.depth = v;
  return b.depth;
}
function storeBoth(b: Box, v: number) {
  b.width = v;
  b.depth = v + 1;
  return `${b.width} ${b.depth}`;
}
function storeDepthInLoop(list: Box[], v: number) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    list[i].depth = v + i;
    sum = sum * 10 + (list[i].depth ?? 0);
  }
  return sum;
}

class Written {
  held = 0;
  set size(v: number) {
    log.push("size=" + v);
    this.held = v;
  }
  get size() {
    return this.held + 1;
  }
  get fixed() {
    return 9;
  }
}
class Below extends Written {
  own = 1;
}
function storeSize(w: Written, v: number) {
  w.size = v;
  return w.size;
}
function storeFixed(w: Written, v: number) {
  (w as any).fixed = v;
  return w.fixed;
}

interface Record2 {
  name: string;
  extra?: number;
}
function storeExtra(r: Record2, v: number) {
  r.extra = v;
  return r.extra;
}
function storeName(r: Record2, v: string) {
  r.name = v;
  return r.name;
}

for (let i = 0; i < 300; i++) {
  const b = new Box(i);
  storeWidth(b, 1);
  storeDepth(b, 2);
  storeBoth(new Box(1), 3);
  storeDepthInLoop([new Box(1), new Box(2)], 4);
  storeSize(new Written(), 5);
  storeSize(new Below(), 5);
  storeExtra({ name: "n" }, 6);
  storeName({ name: "n" }, "m");
}
log.length = 0;

let b = new Box(1);
say("nothing above: storeBoth", () => storeBoth((b = new Box(1)), 5));
console.log(" ", describe(b));
say("written setter: storeSize", () => storeSize(new Written(), 5));
say("written setter, from below: storeSize", () => storeSize(new Below(), 5));
say("written getter alone: storeFixed", () => storeFixed(new Written(), 5));
say("written getter alone, from below: storeFixed", () => storeFixed(new Below(), 5));

const above: [string, PropertyDescriptor][] = [
  ["a setter", { set(this: any, v: number) { log.push("set " + v); }, configurable: true }],
  ["a getter alone", { get: () => 77, configurable: true }],
  ["read only", { value: 78, writable: false, configurable: true }],
  ["a plain value", { value: 79, writable: true, configurable: true }],
];
for (const [name, descriptor] of above) {
  for (const key of ["depth", "width"]) {
    Object.defineProperty(Box.prototype, key, descriptor);
    say(`${key} above is ${name}: storeWidth`, () => storeWidth((b = new Box(1)), 5));
    console.log(" ", describe(b));
    say(`${key} above is ${name}: storeDepth`, () => storeDepth((b = new Box(1)), 5));
    console.log(" ", describe(b));
    say(`${key} above is ${name}: storeBoth`, () => storeBoth((b = new Box(1)), 5));
    console.log(" ", describe(b));
    say(`${key} above is ${name}: storeDepth where it is there`, () => {
      delete (Box.prototype as any)[key];
      b = new Box(1);
      b.depth = 2;
      Object.defineProperty(Box.prototype, key, descriptor);
      return storeDepth(b, 5);
    });
    console.log(" ", describe(b));
    say(`${key} above is ${name}: storeWidth where it was deleted`, () => {
      delete (Box.prototype as any)[key];
      b = new Box(1);
      Object.defineProperty(Box.prototype, key, descriptor);
      delete (b as any).width;
      return storeWidth(b, 5);
    });
    console.log(" ", describe(b));
    let list: Box[] = [];
    say(`${key} above is ${name}: storeDepthInLoop`, () => storeDepthInLoop((list = [new Box(1), new Box(2)]), 5));
    console.log(" ", list.map(describe).join(" | "));
    delete (Box.prototype as any)[key];
    say(`${key} above is gone again: storeBoth`, () => storeBoth((b = new Box(1)), 5));
    console.log(" ", describe(b));
  }
}

// Another object comes to stand above the receiver.
for (const [name, descriptor] of above) {
  const parent = Object.defineProperty({}, "extra", descriptor);
  let r: Record2 = { name: "n" };
  say(`a parent whose extra is ${name}: storeExtra`, () => storeExtra((r = Object.setPrototypeOf({ name: "n" }, parent)), 5));
  console.log(" ", describe(r));
  say(`a parent whose extra is ${name}: storeExtra where it is there`, () => storeExtra((r = Object.setPrototypeOf({ name: "n", extra: 1 }, parent)), 5));
  console.log(" ", describe(r));
  say(`a parent whose extra is ${name}: storeName`, () => storeName((r = Object.setPrototypeOf({ name: "n" }, parent)), "m"));
  console.log(" ", describe(r));
  const boxParent = Object.defineProperty(Object.create(Box.prototype), "depth", descriptor);
  say(`a parent of a Box whose depth is ${name}: storeBoth`, () => storeBoth((b = Object.setPrototypeOf(new Box(1), boxParent)), 5));
  console.log(" ", describe(b), b instanceof Box);
}

// The parent is frozen: what it holds is read only for whoever stands below it.
{
  const parent = Object.freeze({ extra: 1 });
  let r: Record2 = { name: "n" };
  say("a frozen parent: storeExtra", () => storeExtra((r = Object.setPrototypeOf({ name: "n" }, parent)), 5));
  console.log(" ", describe(r));
  say("a frozen parent: storeName", () => storeName((r = Object.setPrototypeOf({ name: "n" }, parent)), "m"));
  console.log(" ", describe(r));
  const made: Record2 = Object.create(parent);
  say("made below a frozen parent: storeExtra", () => storeExtra(made, 5));
  console.log(" ", describe(made));
}

// A proxy above the receiver sees the store of what the receiver lacks.
{
  const parent = new Proxy({}, { set(target, key, value) { log.push(`trap ${String(key)} ${value}`); return true; } });
  let r: Record2 = { name: "n" };
  say("a proxy above: storeExtra", () => storeExtra((r = Object.setPrototypeOf({ name: "n" }, parent)), 5));
  console.log(" ", describe(r));
  say("a proxy above: storeName", () => storeName((r = Object.setPrototypeOf({ name: "n" }, parent)), "m"));
  console.log(" ", describe(r));
}
