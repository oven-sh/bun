// `{ __proto__: p, x, y }` in loops: the same place makes objects with one prototype, with many in turn, with null and with values that are passed over, before and after collections
// and after the prototypes of an earlier round have died. Every object answers for its own prototype, keeps its fields and their order, and finds what it inherits.
type Point = { x: number; y: number };
const collect = (full: boolean) => Bun.gc(full);

class Base {
  kind = "base";
  describe(this: Point): string {
    return this.x + "," + this.y;
  }
}
const base = new Base();
const other = { kind: "other", describe: () => "other" };

function withPrototype(prototype: object | null, i: number): Point {
  return { __proto__: prototype, x: i, y: i + 1 } as Point;
}
function prototypeLast(prototype: object | null, i: number): Point {
  return { x: i, y: i + 1, __proto__: prototype } as Point;
}
function prototypeBetween(prototype: unknown, i: number): Point {
  return { x: i, __proto__: prototype, y: i + 1 } as Point;
}
function withoutPrototype(i: number): Point {
  return { __proto__: null, x: i, y: i + 1 } as Point;
}
function plain(i: number): Point {
  return { x: i, y: i + 1 };
}

function nameOf(prototype: unknown): string {
  if (prototype === null) return "null";
  if (prototype === Object.prototype) return "Object.prototype";
  if (prototype === base) return "base";
  if (prototype === other) return "other";
  return "fresh " + (prototype as { id: number }).id;
}
function check(label: string, made: Point, expected: unknown, i: number) {
  const actual = Object.getPrototypeOf(made);
  if (actual !== expected || made.x !== i || made.y !== i + 1 || Object.keys(made).join() !== "x,y")
    console.log("WRONG", label, i, nameOf(actual), "instead of", nameOf(expected), JSON.stringify(made));
}

let checked = 0;
for (let round = 0; round < 6; round++) {
  const fresh = Array.from({ length: 150 }, (_, id) => ({ id: round * 1000 + id }));
  for (let i = 0; i < 3000; i++) {
    check("one prototype", withPrototype(base, i), base, i);
    check("no prototype", withoutPrototype(i), null, i);
    check("plain beside them", plain(i), Object.prototype, i);
    const turning = i % 3 === 0 ? base : i % 3 === 1 ? other : null;
    check("three in turn", prototypeLast(turning, i), turning, i);
    const one = fresh[i % fresh.length];
    check("many in turn", withPrototype(one, i), one, i);
    const passedOver = [1, "text", undefined, true, 2n][i % 5];
    check("passed over", prototypeBetween(passedOver, i), Object.prototype, i);
    check("taken", prototypeBetween(i % 2 ? one : null, i), i % 2 ? one : null, i);
    checked += 7;
    if (i % 1000 === 999) collect(i === 1999);
  }
  const inherits = withPrototype(base, round) as Point & Base;
  console.log("round", round, inherits.kind, inherits.describe(), inherits instanceof Base, "kind" in inherits, Object.hasOwn(inherits, "kind"));
  collect(true);
}
console.log("checked", checked);

// The values are read in the order of the source, and the object is complete before anyone sees it.
const order: string[] = [];
const note = <T>(label: string, value: T): T => (order.push(label), value);
const ordered = { a: note("a", 1), __proto__: note("prototype", base), b: note("b", 2) } as unknown as { a: number; b: number } & Base;
console.log(order.join(), ordered.a, ordered.b, ordered.kind, Object.keys(ordered).join());

// A prototype that changes later changes what every object made with it inherits.
const late = withPrototype(other, 1) as Point & { added?: number };
(other as { added?: number }).added = 7;
console.log(late.added, (withPrototype(other, 2) as Point & { added?: number }).added);
Object.setPrototypeOf(late, base);
console.log(nameOf(Object.getPrototypeOf(late)), nameOf(Object.getPrototypeOf(withPrototype(other, 3))));
