// Thirteen ways to delete, redefine, store to, freeze or move an object, each on an instance of a class and on a typed record, and what typed code reads afterwards.
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } sum(): number { return this.x + this.y; } }
type Pair = { x: number; y: number };
function pair(i: number): Pair { return { x: i, y: i + 1 }; }
function total(p: Pair): number { return p.x + p.y; }
const out: string[] = [];
const steps: ((o: object) => unknown)[] = [
  o => Reflect.deleteProperty(o, "x"),
  o => Reflect.defineProperty(o, "x", { get() { return 40; }, configurable: true }),
  o => Reflect.defineProperty(o, "y", { value: "text", writable: false }),
  o => Reflect.set(o, "x", "str"),
  o => Reflect.set({}, "x", 9.5, o),
  o => Reflect.set(Object.create(o), "y", null),
  o => Reflect.setPrototypeOf(o, { get x() { return 77; }, z: 1 }),
  o => Reflect.preventExtensions(o),
  o => Object.freeze(o),
  o => Object.seal(o),
  o => Object.defineProperties(o, { x: { enumerable: false }, w: { value: 1 } }),
  o => Object.assign(o, { x: undefined, y: 2n }),
  o => { delete (o as any).y; (o as any).y = 5; (o as any).x = 6; },
];
for (const step of steps) {
  for (const o of [new Point(1, 2), pair(1)] as (Point | Pair)[]) {
    let r: unknown; try { r = step(o); } catch (e) { r = (e as Error).name; }
    let stored = "ok"; try { o.x = 3; o.y = 4; } catch (e) { stored = (e as Error).name; }
    out.push([typeof r === "object" ? "object" : String(r), o instanceof Point ? String(o.sum()) : String(total(o)), String(o.x), String(o.y), stored, Object.keys(o).join(), JSON.stringify(Object.getOwnPropertyDescriptor(o, "x")), "x" in o, Object.isFrozen(o)].join(" "));
  }
}
console.log(out.join("\n"));
