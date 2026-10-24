// `new` and `super(..)` reach host constructors through values of type `any`, with 0 to 6 arguments. Closures, bound functions and functions without [[Construct]] take the generic path.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function show(label: string, run: () => unknown): void {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "throws", (error as Error).constructor.name);
  }
}

function construct(callee: any, args: any[]): any {
  switch (args.length) {
    case 0:
      return new callee();
    case 1:
      return new callee(args[0]);
    case 2:
      return new callee(args[0], args[1]);
    case 3:
      return new callee(args[0], args[1], args[2]);
    case 4:
      return new callee(args[0], args[1], args[2], args[3]);
    case 5:
      return new callee(args[0], args[1], args[2], args[3], args[4]);
    default:
      return new callee(args[0], args[1], args[2], args[3], args[4], args[5]);
  }
}

function describe(instance: any): string {
  const tag = Object.prototype.toString.call(instance).slice(8, -1);
  if (instance instanceof Map || instance instanceof Set) return `${tag} ${instance.size}`;
  if (instance instanceof Date) return `${tag} ${instance.getTime()}`;
  if (instance instanceof Uint8Array || Array.isArray(instance)) return `${tag} ${instance.length} [${Object.keys(instance).length}]`;
  if (instance instanceof URL) return `${tag} ${instance.href}`;
  if (instance instanceof RegExp) return `${tag} ${instance.source} ${instance.flags}`;
  if (instance instanceof Error) return `${tag} ${instance.name} ${instance.message}`;
  return tag;
}

const hostCalls: [any, any[]][] = [
  [Map, []],
  [Date, [0]],
  [Uint8Array, [4]],
  [URL, ["http://a/b"]],
  [Set, [[1, 2, 2]]],
  [Array, [3]],
  [RegExp, ["a+", "g"]],
  [URL, ["c", "http://a/b/"]],
  [Error, ["message"]],
  [TypeError, ["message"]],
  [Object, []],
];
for (let round = 0; round < 3300; round++) {
  const [callee, args] = hostCalls[round % hostCalls.length];
  const instance = construct(callee, args);
  if (Object.getPrototypeOf(instance) !== callee.prototype) throw new Error("wrong prototype");
  if (round < hostCalls.length) console.log(callee.name, describe(instance));
  if (round % 1000 === 999) collect();
}

const components = [2020, 5, 15, 12, 30, 45];
for (let count = 0; count <= 6; count++) {
  const args = components.slice(0, count);
  console.log(count, describe(construct(Array, args)), count ? describe(construct(Date, args)) : typeof construct(Date, args).getTime());
}

const extendWith: ((Base: any) => any)[] = [
  Base => class extends Base { arity = 0; constructor() { super(); } },
  Base => class extends Base { arity = 1; constructor(a: any) { super(a); } },
  Base => class extends Base { arity = 2; constructor(a: any, b: any) { super(a, b); } },
  Base => class extends Base { arity = 3; constructor(a: any, b: any, c: any) { super(a, b, c); } },
  Base => class extends Base { arity = 4; constructor(a: any, b: any, c: any, d: any) { super(a, b, c, d); } },
  Base => class extends Base { arity = 5; constructor(a: any, b: any, c: any, d: any, e: any) { super(a, b, c, d, e); } },
  Base => class extends Base { arity = 6; constructor(a: any, b: any, c: any, d: any, e: any, f: any) { super(a, b, c, d, e, f); } },
];
const hostBases: [any, any[]][] = [
  [Set, []],
  [Map, [[["a", 1]]]],
  [Promise, [() => {}]],
  [Error, ["message"]],
  [TypeError, ["message"]],
  [URL, ["c", "http://a/b/"]],
  [Uint8Array, [new ArrayBuffer(8), 2, 4]],
  [Date, components.slice(0, 4)],
  [Array, [1, 2, 3, 4, 5]],
  [Date, components],
];
for (const [Base, args] of hostBases) {
  const Derived = extendWith[args.length](Base);
  for (let round = 0; round < 300; round++) {
    const instance = construct(Derived, args);
    if (!(instance instanceof Base) || Object.getPrototypeOf(instance) !== Derived.prototype || instance.arity !== args.length) throw new Error("wrong instance");
  }
  console.log("extends", Base.name, describe(construct(Derived, args)));
}

class Registry extends Map<string, number> {
  constructor(entries: [string, number][]) {
    super(entries);
  }
  total(): number {
    let sum = 0;
    for (const value of this.values()) sum += value;
    return sum;
  }
}
class Triple extends Array<number> {
  constructor(first: number, second: number, third: number) {
    super(first, second, third);
  }
  total(): number {
    return this[0] + this[1] + this[2];
  }
}
class Deferred extends Promise<number> {
  constructor(executor: (resolve: (value: number) => void, reject: (reason: unknown) => void) => void) {
    super(executor);
  }
}
class Failure extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "Failure";
    this.code = code;
  }
}
let total = 0;
for (let round = 0; round < 500; round++) {
  total += construct(Registry, [[["a", round], ["b", 2]]]).total();
  total += construct(Triple, [round, 2, 3]).total();
  total += construct(Failure, ["failed", round]).code;
}
console.log(total, describe(construct(Registry, [[]])), describe(construct(Triple, [1, 2, 3])), describe(construct(Failure, ["failed", 1])));

class Shape {
  name: string;
  constructor(name: string) {
    if (!name) throw new RangeError("a shape needs a name");
    this.name = name;
  }
}
const withSides = (Base: any): any =>
  class extends Base {
    sides: number;
    constructor(name: string, sides: number) {
      super(name);
      this.sides = sides;
    }
  };
const withSize = (Base: any): any =>
  class extends Base {
    size: number;
    constructor(name: string, sides: number, size: number) {
      super(name, sides);
      this.size = size;
    }
  };
const Polygon = withSides(Shape);
const Square = withSize(Polygon);
class Animal {
  legs: number;
  constructor(legs: number) {
    this.legs = legs;
  }
}
class Bird extends Animal {
  wings: number;
  constructor(wings: number) {
    super(2);
    this.wings = wings;
  }
}
class Penguin extends Bird {
  swims = true;
  constructor() {
    super(2);
  }
}
let area = 0;
for (let round = 0; round < 1000; round++) {
  const square = construct(Square, ["square", 4, round % 7]);
  if (!((square as unknown) instanceof Shape) || Object.getPrototypeOf(square) !== Square.prototype) throw new Error("wrong prototype");
  area += square.size * square.size + square.sides + square.name.length;
  const penguin = construct(Penguin, []);
  area += penguin.legs + penguin.wings + Number(penguin.swims);
}
console.log("three levels", area, JSON.stringify(construct(Square, ["square", 4, 5])), JSON.stringify(construct(Penguin, [])));

const guarded = (Base: any): any =>
  class extends Base {
    constructor(first: any, second: any) {
      const label = "guarded " + first;
      const pair = [first, second];
      const length = label.length * 2;
      try {
        super(first, second);
      } catch (error) {
        return { caught: (error as Error).message, label, pair, length } as any;
      }
    }
  };
const GuardedPolygon = guarded(Polygon);
const GuardedURL = guarded(URL);
for (let round = 0; round < 300; round++) {
  const polygon = new GuardedPolygon(round % 2 ? "triangle" : "", 3);
  const url = new GuardedURL(round % 2 ? "c" : "", round % 2 ? "http://a/b/" : undefined);
  if (round < 2) console.log(JSON.stringify(polygon), JSON.stringify(url));
  const throws = round % 2 === 0;
  if (("caught" in polygon) !== throws || ("caught" in url) !== throws) throw new Error("wrong result");
}

const arrow = () => 1;
const notConstructors: [string, any][] = [
  ["Symbol", Symbol],
  ["Math.max", Math.max],
  ["bound Math.max", Math.max.bind(null)],
  ["arrow function", arrow],
  ["bound arrow function", arrow.bind(null)],
  ["method", { method() {} }.method],
  ["async function", async function () {}],
  ["generator function", function* () {}],
  ["proxy of an arrow function", new Proxy(arrow, {})],
  ["undefined", undefined],
  ["null", null],
  ["number", 5],
  ["string", "Map"],
  ["object", {}],
];
for (const [label, callee] of notConstructors) {
  for (let count = 0; count <= 6; count += 3) show(`new ${label}, ${count} arguments:`, () => describe(construct(callee, components.slice(0, count))));
}

const otherConstructors: [string, any, any[]][] = [
  ["bound Map", Map.bind(null), []],
  ["bound Date", (Date as any).bind(null, 0), []],
  ["bound class", Shape.bind(null, "bound"), []],
  ["proxy of Map", new Proxy(Map, {}), [[["a", 1]]]],
  ["function", function (this: any, value: number) { this.value = value; }, [1]],
];
for (const [label, callee, args] of otherConstructors) {
  for (let round = 0; round < 3; round++) show(`new ${label}:`, () => describe(construct(callee, args)));
}

const Reparented = extendWith[0](Map);
const parents: [string, any][] = [
  ["Set", Set],
  ["Math.max", Math.max],
  ["Symbol", Symbol],
  ["bound Map", Map.bind(null)],
  ["arrow function", arrow],
  ["null", null],
  ["Shape", Shape],
  ["Polygon", Polygon],
  ["Map", Map],
];
for (const [label, parent] of parents) {
  Object.setPrototypeOf(Reparented, parent);
  for (let round = 0; round < 3; round++) {
    show(`super() reaches ${label}:`, () => {
      const instance = new Reparented();
      return [instance.arity, Object.getPrototypeOf(instance) === Reparented.prototype].join();
    });
  }
}

for (let round = 0; round < 3; round++) {
  try {
    construct(URL, [""]);
    console.log("constructed");
  } catch (error) {
    console.log(String((error as Error).stack).split("\n")[0]);
  }
}
show("new Map(5):", () => describe(construct(Map, [5])));
show("new Uint8Array(-1):", () => describe(construct(Uint8Array, [-1])));
show("new Array(-1):", () => describe(construct(Array, [-1])));
show("super(\"\") reaches URL:", () => describe(construct(extendWith[1](URL), [""])));

function nameOfThrown(run: () => unknown): string {
  try {
    run();
    return "nothing";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function nestIterables(callee: any, depth: number): number {
  let deepest = depth;
  new callee({
    [Symbol.iterator]() {
      return {
        next() {
          deepest = nestIterables(callee, depth + 1);
          return { done: true, value: undefined };
        },
      };
    },
  });
  return deepest;
}
class Nested {
  inner: any;
  constructor(callee: any) {
    this.inner = new callee(callee);
  }
}
const NestedMap: any = class extends (Map as any) {
  inner: any;
  constructor(callee: any) {
    super();
    this.inner = new callee(callee);
  }
};
console.log("nested iterables throw", nameOfThrown(() => nestIterables(Map, 0)), "then", describe(construct(Map, [])));
console.log("nested closures throw", nameOfThrown(() => construct(Nested, [Nested])), "then", describe(construct(Date, [0])));
console.log("nested subclasses throw", nameOfThrown(() => construct(NestedMap, [NestedMap])), "then", describe(construct(extendWith[0](Set), [])));

construct(Deferred, [(resolve: (value: number) => void) => resolve(42)]).then((value: number) => console.log("deferred", value));
