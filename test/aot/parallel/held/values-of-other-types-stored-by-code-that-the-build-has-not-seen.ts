// Every store of the program brings one kind of value to each field. Code that the build has not seen gets hold of the objects and stores other kinds, by every way there is,
// between two reads of one function, in the middle of a loop and below two calls.
import vm from "node:vm";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return this.x * this.x + this.y * this.y;
  }
}

class Holder {
  point: Point;
  label: string;
  count: number;
  ratio: number;
  flag: boolean;
  act: () => number;
  constructor(seed: number) {
    this.point = new Point(seed, seed + 1);
    this.label = "label" + seed;
    this.count = seed;
    this.ratio = seed + 0.5;
    this.flag = seed > 0;
    this.act = () => seed * 2;
  }
}

type Deed = (holder: Holder) => void;
type Door = (holder: Holder, key: string, value: unknown) => void;

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (Object.is(value, -0)) return "-0";
  if (value !== null && typeof value === "object") return Array.isArray(value) ? "array" : "object";
  return String(value);
}

function attempt(read: () => unknown): string {
  try {
    return show(read());
  } catch (error) {
    return (error as Error).name;
  }
}

function readAll(holder: Holder): string {
  return [
    attempt(() => holder.point.x),
    attempt(() => holder.point.norm()),
    attempt(() => holder.label.length),
    attempt(() => holder.label + "!"),
    attempt(() => holder.count + 1),
    attempt(() => holder.count | 0),
    attempt(() => holder.ratio * 2),
    attempt(() => (holder.flag ? "yes" : "no")),
    attempt(() => holder.act()),
  ].join(" ");
}

function sumOf(holder: Holder): unknown {
  return (holder.point.x as any) + holder.count + holder.ratio + holder.label.length + holder.act();
}

function between(holder: Holder, deed: Deed): string {
  const before = sumOf(holder);
  deed(holder);
  return show(before) + " " + attempt(() => sumOf(holder));
}

function inLoop(holder: Holder, deed: Deed): string {
  let text = "";
  for (let turn = 0; turn < 8; turn++) {
    if (turn === 5) deed(holder);
    text += attempt(() => sumOf(holder)) + ";";
  }
  return text;
}

function lowest(holder: Holder, deed: Deed): unknown {
  deed(holder);
  return holder.count;
}

function middle(holder: Holder, deed: Deed): string {
  return show(holder.count) + show(lowest(holder, deed)) + show(holder.count);
}

function belowCalls(holder: Holder, deed: Deed): string {
  const x = holder.point.x;
  const text = middle(holder, deed);
  return show(x) + text + attempt(() => holder.point.x) + attempt(() => holder.label.length);
}

function storesAgain(holder: Holder, deed: Deed): string {
  deed(holder);
  const after = readAll(holder);
  holder.point = new Point(7, 8);
  holder.label = "again";
  holder.count = 9;
  holder.ratio = 1.25;
  holder.flag = false;
  holder.act = () => 11;
  return after + " > " + readAll(holder) + " " + Object.keys(holder).join();
}

const unseen = (text: string): any => (0, eval)(text);

const other = new Holder(40);

function probeAll(door: string, open: Door, key: string, value: unknown): void {
  const deed: Deed = holder => open(holder, key, value);
  const title = door + " | " + key + " = " + show(value) + " | ";
  console.log(title + "between: " + between(new Holder(3), deed));
  console.log(title + "in a loop: " + inLoop(new Holder(3), deed));
  console.log(title + "below calls: " + belowCalls(new Holder(3), deed));
  console.log(title + "stores again: " + storesAgain(new Holder(3), deed));
}

function throughDoor(door: string, open: Door): void {
  probeAll(door, open, "point", 5);
  probeAll(door, open, "point", "text");
  probeAll(door, open, "point", null);
  probeAll(door, open, "point", undefined);
  probeAll(door, open, "point", { x: "ex", y: 2, norm: () => "own" });
  probeAll(door, open, "point", other);
  probeAll(door, open, "point", [1, 2]);
  probeAll(door, open, "point", () => 1);
  probeAll(door, open, "point", new Point(30, 31));
  probeAll(door, open, "label", 5);
  probeAll(door, open, "label", { length: "long" });
  probeAll(door, open, "label", null);
  probeAll(door, open, "label", Symbol("s"));
  probeAll(door, open, "label", "other");
  probeAll(door, open, "count", "text");
  probeAll(door, open, "count", 1.5);
  probeAll(door, open, "count", -0);
  probeAll(door, open, "count", NaN);
  probeAll(door, open, "count", 2 ** 31);
  probeAll(door, open, "count", 2 ** 53);
  probeAll(door, open, "count", 10n);
  probeAll(door, open, "count", { valueOf: () => 100 });
  probeAll(door, open, "count", undefined);
  probeAll(door, open, "count", true);
  probeAll(door, open, "ratio", 3);
  probeAll(door, open, "ratio", "text");
  probeAll(door, open, "ratio", null);
  probeAll(door, open, "flag", 0);
  probeAll(door, open, "flag", "text");
  probeAll(door, open, "flag", undefined);
  probeAll(door, open, "act", 5);
  probeAll(door, open, "act", () => "other");
  probeAll(door, open, "act", Math.abs);
  probeAll(door, open, "act", other.act);
  probeAll(door, open, "act", class {});
  probeAll(door, open, "act", (() => 3).bind(null));
}

// The probes run on untouched objects first, as often as a cache takes to settle.
for (let turn = 0; turn < 50; turn++) {
  between(new Holder(turn), () => {});
  inLoop(new Holder(turn), () => {});
  belowCalls(new Holder(turn), () => {});
  storesAgain(new Holder(turn), () => {});
}

throughDoor("store under a computed key in evaluated text", unseen("(h, k, v) => { h[k] = v; }"));
throughDoor("store by name in evaluated text", (h, k, v) => new Function("h", "v", "h." + k + " = v;")(h, v));
throughDoor("sloppy store by name", (h, k, v) => new Function("h", "v", "with ({}) { h." + k + " = v; }")(h, v));
throughDoor("script of node:vm in this realm", vm.runInThisContext("(h, k, v) => { h[k] = v; }"));
throughDoor("script of node:vm in another realm", vm.runInNewContext("(h, k, v) => { h[k] = v; }"));
throughDoor("Reflect.set in evaluated text", unseen("(h, k, v) => { Reflect.set(h, k, v); }"));
throughDoor("Reflect.set handed over as a value", unseen("Reflect.set"));
throughDoor("Reflect.set with the object as receiver", unseen("(h, k, v) => { Reflect.set({}, k, v, h); }"));
throughDoor("Reflect.set above the object", unseen("(h, k, v) => { Reflect.set(Object.create(h), k, v, h); }"));
throughDoor("Object.defineProperty", unseen("(h, k, v) => { Object.defineProperty(h, k, { value: v }); }"));
throughDoor("Object.defineProperty with all attributes", unseen("(h, k, v) => { Object.defineProperty(h, k, { value: v, writable: true, enumerable: true, configurable: true }); }"));
throughDoor("Reflect.defineProperty", unseen("(h, k, v) => { Reflect.defineProperty(h, k, { value: v }); }"));
throughDoor("Object.defineProperties", unseen("(h, k, v) => { Object.defineProperties(h, { [k]: { value: v } }); }"));
throughDoor("Object.assign", unseen("(h, k, v) => { Object.assign(h, { [k]: v }); }"));
throughDoor("Object.assign handed over as a value", (h, k, v) => unseen("Object.assign")(h, { [k]: v }));
throughDoor("a proxy without traps", unseen("(h, k, v) => { new Proxy(h, {})[k] = v; }"));
throughDoor("a proxy of a proxy", unseen("(h, k, v) => { new Proxy(new Proxy(h, {}), {})[k] = v; }"));
throughDoor("delete and store", unseen("(h, k, v) => { delete h[k]; h[k] = v; }"));
throughDoor("destructuring in evaluated text", unseen("(h, k, v) => { [h[k]] = [v]; }"));
throughDoor("a loop of stores that settles its caches", unseen("(h, k, v) => { for (let i = 0; i < 40; i++) h[k] = v; }"));

// An object that was never touched is as it was.
console.log(readAll(new Holder(4)), readAll(other));
