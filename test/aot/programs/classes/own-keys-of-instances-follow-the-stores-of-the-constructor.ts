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

interface Leaf { pos: number; end: number; kind: number; id: number; flags: number; parent: Leaf | undefined; note?: string }
function Leaf(this: Leaf, kind: number, pos: number, end: number) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
  this.id = 0;
  this.flags = 0;
  this.parent = undefined;
}
interface Token { kind: number; flags: number; pos: number; text?: string; end: number }
function Token(this: Token, kind: number, pos: number, end: number) {
  this.kind = kind;
  this.flags = kind & 1;
  this.pos = pos;
  if (kind > 2) this.text = "t" + kind;
  this.end = end;
}
const allocator = {
  getLeafConstructor: () => Leaf as unknown as new (kind: number, pos: number, end: number) => Leaf,
  getTokenConstructor: () => Token as unknown as new (kind: number, pos: number, end: number) => Token,
};
function makeLeaf(kind: number, pos: number, end: number): Leaf {
  return new (allocator.getLeafConstructor())(kind, pos, end);
}
function makeToken(kind: number, pos: number, end: number): Token {
  return new (allocator.getTokenConstructor())(kind, pos, end);
}
function sumOfLeaf(leaf: Leaf): number {
  return leaf.kind * 1000 + leaf.flags * 100 + leaf.pos * 10 + leaf.end + leaf.id + (leaf.parent ? leaf.parent.kind : 0);
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
  const parent = makeLeaf(i % 7, i, i + 1);
  const leaf = makeLeaf(i % 5, i, i + 2);
  leaf.parent = parent;
  leaf.flags |= i & 3;
  total += sumOfLeaf(leaf) + makeToken(i % 5, i, i + 1).end;
}
lines.push("total " + total);

show("leaf", makeLeaf(1, 2, 3));
show("token without text", makeToken(1, 2, 3));
show("token with text", makeToken(3, 2, 3));
show("point", new Point(1, 2));
show("point with label", new Point(1, 2, "p"));
show("point3", new Point3(1, 2, 3));

const again = makeLeaf(4, 5, 6);
delete (again as Partial<Leaf>).kind;
show("kind deleted", again);
lines.push("kind reads " + String(again.kind) + " " + ("kind" in again) + " " + sumOfLeaf(again));
again.kind = 9;
show("kind added again", again);
lines.push("sum " + sumOfLeaf(again));

const late = makeLeaf(1, 1, 1);
late.note = "late";
delete (late as Partial<Leaf>).pos;
late.pos = 7;
show("a late field, then pos again", late);

const other = makeLeaf(2, 2, 2);
(other as unknown as { flags: unknown }).flags = "many";
show("flags holds a string", other);
lines.push("flags reads " + String((other as unknown as { flags: unknown }).flags));

const redefined = makeLeaf(3, 3, 3);
Object.defineProperty(redefined, "kind", { get: () => 42, enumerable: true, configurable: true });
show("kind is an accessor", redefined);
lines.push("sum " + sumOfLeaf(redefined));
Object.defineProperty(redefined, "flags", { value: 5, enumerable: false, writable: true, configurable: true });
show("flags is not enumerable", redefined);
lines.push("sum " + sumOfLeaf(redefined));

const taken: number[] = [];
Object.defineProperty(Leaf.prototype, "flags", { set(value: number) { taken.push(value); }, get() { return -1; }, configurable: true });
const underSetter = makeLeaf(5, 5, 5);
show("made under a setter for flags", underSetter);
lines.push("flags reads " + underSetter.flags + ", own " + Object.hasOwn(underSetter, "flags") + ", taken " + taken.join(",") + ", sum " + sumOfLeaf(underSetter));
delete (Leaf.prototype as Partial<Leaf>).flags;
lines.push("behind the setter flags reads " + String(underSetter.flags) + ", sum " + sumOfLeaf(underSetter));
underSetter.flags = 1;
show("flags stored later", underSetter);
show("made behind the setter", makeLeaf(5, 5, 5));

Object.defineProperty(Leaf.prototype, "id", { value: 77, writable: false, configurable: true });
let stopped: Leaf | undefined;
let holder: Leaf | undefined;
function Watched(this: Leaf, kind: number) {
  holder = this;
  Leaf.call(this, kind, 1, 2);
}
Watched.prototype = Object.create(Leaf.prototype);
try {
  stopped = makeLeaf(6, 6, 6);
} catch (error) {
  lines.push("stopped: " + (error as Error).constructor.name);
}
lines.push("stopped is " + String(stopped));
try {
  new (Watched as unknown as new (kind: number) => Leaf)(6);
} catch (error) {
  lines.push("watched: " + (error as Error).constructor.name);
}
show("left half made", holder!);
lines.push("id reads " + holder!.id + ", flags " + String(holder!.flags) + ", sum " + sumOfLeaf(holder!));
delete (Leaf.prototype as Partial<Leaf>).id;
show("made behind the read-only id", makeLeaf(6, 6, 6));
show("watched", new (Watched as unknown as new (kind: number) => Leaf)(7));

class Other {}
show("another new.target", Reflect.construct(Leaf, [8, 8, 8], Other));
lines.push("is Other " + (Reflect.construct(Leaf, [8, 8, 8], Other) instanceof Other));
const onPlainObject = { first: 1 } as unknown as Leaf;
Leaf.call(onPlainObject, 9, 9, 9);
show("called on a plain object", onPlainObject);
const twice = makeLeaf(1, 1, 1);
delete (twice as Partial<Leaf>).end;
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
  (frozen as Leaf).kind = 5;
} catch (error) {
  lines.push("frozen: " + (error as Error).constructor.name);
}
show("frozen", frozen);
lines.push("sum " + sumOfLeaf(frozen));

console.log(lines.join("\n"));
