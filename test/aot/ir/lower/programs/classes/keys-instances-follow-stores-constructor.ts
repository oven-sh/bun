// RUN: lower
// OPTIONS: builtin-modules

// The own keys of an instance stand in the order in which its constructor's stores ran, whatever the compiler knows about fields that every constructor fills: Object.keys, entries, for-in, JSON.stringify, spread, Reflect.ownKeys; a field deleted and added again, stored on one path only, taken by a setter or stopped by a read-only property above, redefined, or missing because the constructor threw
const lines: string[] = [];
function show(title: string, object: object): void {
  const inLoop: string[] = [];
  for (const key in object) inLoop.push(key);
  lines.push(
    title + ": " + Object.keys(object).join(",") + " | " + Object.entries(object).map(([key, value]) => key + "=" + String(value)).join(",") + " | " + inLoop.join(",") +
      " | " + JSON.stringify(object) + " | " + Object.keys({ ...object }).join(",") + " | " + Reflect.ownKeys(object).map(String).join(",") + " | " + Object.getOwnPropertyNames(object).join(","),
  );
}

interface Leaf { hue: number; spots: number; branch: Leaf | undefined; till: number; from: number; mark: number; note?: string }
function Leaf(this: Leaf, hue: number, from: number, till: number) {
  this.hue = hue;
  this.spots = 0;
  this.branch = undefined;
  this.till = till;
  this.from = from;
  this.mark = 0;
}
interface Bud { hue: number; spots: number; from: number; text?: string; till: number }
function Bud(this: Bud, hue: number, from: number, till: number) {
  this.hue = hue;
  this.spots = hue & 1;
  this.from = from;
  if (hue > 2) this.text = "t" + hue;
  this.till = till;
}
const makers = {
  leafMaker: () => Leaf as unknown as new (hue: number, from: number, till: number) => Leaf,
  budMaker: () => Bud as unknown as new (hue: number, from: number, till: number) => Bud,
};
function makeLeaf(hue: number, from: number, till: number): Leaf {
  return new (makers.leafMaker())(hue, from, till);
}
function makeBud(hue: number, from: number, till: number): Bud {
  return new (makers.budMaker())(hue, from, till);
}
function sumOfLeaf(leaf: Leaf): number {
  return leaf.hue * 1000 + leaf.spots * 100 + leaf.from * 10 + leaf.till + leaf.mark + (leaf.branch ? leaf.branch.hue : 0);
}

class Point {
  y: number;
  x: number;
  label: string | undefined;
  constructor(x: number, y: number, label?: string) {
    this.x = x;
    if (label !== undefined) this.label = label;
    this.y = y;
  }
}
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const branch = makeLeaf(i % 7, i, i + 1);
  const leaf = makeLeaf(i % 5, i, i + 2);
  leaf.branch = branch;
  leaf.spots |= i & 3;
  total += sumOfLeaf(leaf) + makeBud(i % 5, i, i + 1).till;
}
lines.push("total " + total);

show("leaf", makeLeaf(1, 2, 3));
show("bud without text", makeBud(1, 2, 3));
show("bud with text", makeBud(3, 2, 3));
show("point", new Point(1, 2));
show("point with label", new Point(1, 2, "p"));
show("point3", new Point3(1, 2, 3));

const again = makeLeaf(4, 5, 6);
delete (again as Partial<Leaf>).hue;
show("hue deleted", again);
lines.push("hue reads " + String(again.hue) + " " + ("hue" in again) + " " + sumOfLeaf(again));
again.hue = 9;
show("hue added again", again);
lines.push("sum " + sumOfLeaf(again));

const late = makeLeaf(1, 1, 1);
late.note = "late";
delete (late as Partial<Leaf>).from;
late.from = 7;
show("a late field, then from again", late);

const other = makeLeaf(2, 2, 2);
(other as unknown as { spots: unknown }).spots = "many";
show("spots holds a string", other);
lines.push("spots reads " + String((other as unknown as { spots: unknown }).spots));

const redefined = makeLeaf(3, 3, 3);
Object.defineProperty(redefined, "hue", { get: () => 42, enumerable: true, configurable: true });
show("hue is an accessor", redefined);
lines.push("sum " + sumOfLeaf(redefined));
Object.defineProperty(redefined, "spots", { value: 5, enumerable: false, writable: true, configurable: true });
show("spots is not enumerable", redefined);
lines.push("sum " + sumOfLeaf(redefined));

const taken: number[] = [];
Object.defineProperty(Leaf.prototype, "spots", { set(value: number) { taken.push(value); }, get() { return -1; }, configurable: true });
const underSetter = makeLeaf(5, 5, 5);
show("made under a setter for spots", underSetter);
lines.push("spots reads " + underSetter.spots + ", own " + Object.hasOwn(underSetter, "spots") + ", taken " + taken.join(",") + ", sum " + sumOfLeaf(underSetter));
delete (Leaf.prototype as Partial<Leaf>).spots;
lines.push("behind the setter spots reads " + String(underSetter.spots) + ", sum " + sumOfLeaf(underSetter));
underSetter.spots = 1;
show("spots stored later", underSetter);
show("made behind the setter", makeLeaf(5, 5, 5));

Object.defineProperty(Leaf.prototype, "mark", { value: 77, writable: false, configurable: true });
let stopped: Leaf | undefined;
let holder: Leaf | undefined;
function Watched(this: Leaf, hue: number) {
  holder = this;
  Leaf.call(this, hue, 1, 2);
}
Watched.prototype = Object.create(Leaf.prototype);
try {
  stopped = makeLeaf(6, 6, 6);
} catch (error) {
  lines.push("stopped: " + (error as Error).constructor.name);
}
lines.push("stopped is " + String(stopped));
try {
  new (Watched as unknown as new (hue: number) => Leaf)(6);
} catch (error) {
  lines.push("watched: " + (error as Error).constructor.name);
}
show("left half made", holder!);
lines.push("mark reads " + holder!.mark + ", spots " + String(holder!.spots) + ", sum " + sumOfLeaf(holder!));
delete (Leaf.prototype as Partial<Leaf>).mark;
show("made behind the read-only mark", makeLeaf(6, 6, 6));
show("watched", new (Watched as unknown as new (hue: number) => Leaf)(7));

class Other {}
show("another new.target", Reflect.construct(Leaf, [8, 8, 8], Other));
lines.push("is Other " + (Reflect.construct(Leaf, [8, 8, 8], Other) instanceof Other));
const onPlainObject = { first: 1 } as unknown as Leaf;
Leaf.call(onPlainObject, 9, 9, 9);
show("called on a plain object", onPlainObject);
const twice = makeLeaf(1, 1, 1);
delete (twice as Partial<Leaf>).till;
Leaf.call(twice, 2, 2, 2);
show("constructed twice", twice);

let seenEarly = "";
function peek(leaf: Early): void {
  seenEarly += Object.keys(leaf).join(",") + ";" + String(leaf.b) + ";";
}
class Early {
  a: number;
  b: number;
  constructor() {
    seenEarly += String((this as Partial<Early>).a) + ";";
    this.a = 1;
    peek(this);
    this.b = 2;
    peek(this);
  }
}
show("early", new Early());
lines.push("seen early " + seenEarly);

const frozen = Object.freeze(makeLeaf(1, 2, 3));
try {
  (frozen as Leaf).hue = 5;
} catch (error) {
  lines.push("frozen: " + (error as Error).constructor.name);
}
show("frozen", frozen);
lines.push("sum " + sumOfLeaf(frozen));

console.log(lines.join("\n"));

// CHECK-LABEL: function {{*}}name="Early"
// CHECK-LABEL: function {{*}}name="leafMaker"
// CHECK-LABEL: function {{*}}name="Point3"
