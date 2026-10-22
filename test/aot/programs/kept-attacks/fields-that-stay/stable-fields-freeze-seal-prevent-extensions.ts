// Object.freeze, Object.seal and Object.preventExtensions work on an object born in a .ts file as in plain Bun.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
interface Point { x: number; y?: number }
class Pair { x: number = 1; y?: number = 2 }
const makers: [string, () => any][] = [
  ["a class instance", () => new Pair()],
  ["a literal", () => { const point: Point = { x: 1, y: 2 }; return point; }],
];
const levels: [string, (o: object) => unknown][] = [
  ["frozen", o => Object.freeze(o)],
  ["sealed", o => Object.seal(o)],
  ["not extensible", o => Object.preventExtensions(o)],
  ["not extensible by Reflect", o => Reflect.preventExtensions(o)],
];
for (const [how, make] of makers) {
  for (const [level, apply] of levels) {
    const o = make();
    apply(o);
    console.log(how + ", " + level + ":", Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o), JSON.stringify(Object.getOwnPropertyDescriptors(o)));
    attempt("  a store", () => { o.x = 5; return o.x; });
    attempt("  a new property", () => { o.extra = 1; return o.extra; });
    attempt("  delete of the optional property", () => delete o.y);
    attempt("  Reflect.set", () => Reflect.set(o, "x", 6));
    attempt("  Reflect.deleteProperty of the optional property", () => Reflect.deleteProperty(o, "y"));
    console.log("  afterwards:", JSON.stringify(o));
  }
}
