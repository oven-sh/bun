// indexed-stores-below-typed-arrays-before-and-after-a-prototype-gets-an-indexed-accessor.cjs with types, all of it strict code.
const lines: string[] = [];
function report(label: string, ...values: unknown[]) {
  lines.push(label + ": " + values.map(value => JSON.stringify(value) ?? String(value)).join(" "));
}
function attempt(run: () => unknown) {
  try { return run(); } catch (error) { return (error as Error).constructor.name; }
}
function storeStrict(object: any, key: string | number, value: unknown) { object[key] = value; return object[key]; }
function storeSloppy(object: any, key: string | number, value: unknown) { try { object[key] = value; } catch {} return object[key]; }

class OverBytes { n = 0; }
Object.setPrototypeOf(OverBytes.prototype, new Uint8Array(4));
function OverDoubles(this: any) { this.n = 0; }
OverDoubles.prototype = new Float64Array(4);
class List extends Array {}
Object.setPrototypeOf(List.prototype, new Uint8Array(4));

const kinds: Record<string, () => any> = {
  "class instance": () => new OverBytes(),
  "function instance": () => new (OverDoubles as any)(),
  "literal": () => Object.setPrototypeOf({ n: 0 }, new Uint8Array(4)),
  "literal with __proto__": () => ({ __proto__: new Uint8Array(4), n: 0 }),
  "literal with an element": () => Object.setPrototypeOf({ n: 0, 0: "own" }, new Uint8Array(4)),
  "literal below an empty typed array": () => Object.setPrototypeOf({ n: 0 }, new Uint8Array(0)),
  "literal below a typed array without a prototype": () => Object.setPrototypeOf({ n: 0 }, Object.setPrototypeOf(new Uint8Array(4), null)),
  "literal below a literal": () => Object.setPrototypeOf({ n: 0 }, Object.setPrototypeOf({ m: 0 }, new Uint8Array(4))),
  "literal below Object.create": () => Object.setPrototypeOf({ n: 0 }, Object.create(new Uint8Array(4))),
  "Object.create": () => Object.create(new Uint8Array(4)),
  "Object.create with an element": () => Object.defineProperty(Object.create(new Uint8Array(4)), 0, { value: "own", writable: true, enumerable: true, configurable: true }),
  "Object.create below a literal": () => Object.create(Object.setPrototypeOf({ m: 0 }, new Uint8Array(4))),
  "array": () => Object.setPrototypeOf(["own"], new Uint8Array(4)),
  "array of doubles": () => Object.setPrototypeOf([0.5], new Uint8Array(4)),
  "array with a hole": () => Object.setPrototypeOf(["own", , "own"], new Uint8Array(4)),
  "instance of a class that extends Array": () => new List(),
  "function": () => Object.setPrototypeOf(function () {}, new Uint8Array(4)),
  "Map": () => Object.setPrototypeOf(new Map(), new Uint8Array(4)),
};
const create = (): [string, any][] => Object.entries(kinds).map(([label, createObject]) => [label, createObject()]);

function store(phase: string, objects: [string, any][]) {
  for (const [label, o] of objects) {
    const receiver = { r: 0 };
    report(
      phase + ", " + label,
      storeSloppy(o, 1, "inside"),
      storeSloppy(o, 9, "outside"),
      attempt(() => storeStrict(o, 10, "strict")),
      storeSloppy(o, "11", "text"),
      Reflect.set(o, 12, "reflect"),
      o[12],
      Reflect.set(o, 13, "receiver", receiver),
      Object.keys(receiver),
      Reflect.set(Object.getPrototypeOf(o), 14, "from above", o),
      o[14],
      Object.defineProperty(o, 15, { value: "defined", writable: true, enumerable: true, configurable: true })[15],
      storeSloppy(o, 15, "again"),
      (Object.assign(o, { 16: "assigned" }) as any)[16],
      Object.keys(o),
    );
  }
}

store("before", create());
const createdBefore = create();

class Watched {}
const watched: any = new Watched();
Object.defineProperty(Watched.prototype, 3, { set(this: any, value: unknown) { this.seen = value; }, configurable: true });
watched[3] = "stored";
report("watched", watched.seen, Object.keys(watched));

store("created before", createdBefore);
store("created after", create());
delete (Watched.prototype as any)[3];
store("accessor deleted", create());
console.log(lines.join("\n"));
