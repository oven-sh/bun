// A string gets into a number field of the object, a field is deleted, becomes an accessor or changes its attributes, each time by another construct of the language or tool of the run time than a plain assignment:
// targets of destructuring and of loops, compound and logical assignment, Reflect with a receiver, a store to `super`, a class field defined on an object that the base constructor hands back,
// a proxy without traps around the object. The holder reads the field raw in front of the call and behind it.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const viaSuper = {
  __proto__: {},
  put(this: any): void {
    super.x = "super";
  },
} as any;
const handsBack = function (this: any, o: any): any {
  return o;
} as any;
class Stamp extends handsBack {
  x = "field";
}
const key = ["x"];

const ways: ((p: any) => void)[] = [
  p => void ([p.x] = ["array pattern"]),
  p => void ({ v: p.x } = { v: "object pattern" }),
  p => {
    for (p.x of ["for of"]);
  },
  p => {
    for (p.x in { "for in": 1 });
  },
  p => void (p.x += "+="),
  p => void (p.y &&= "&&="),
  p => void Reflect.set(p, "x", "Reflect.set"),
  p => void Reflect.set({}, "x", "receiver", p),
  p => void Object.assign(p, { x: "assign" }),
  p => viaSuper.put.call(p),
  p => void new (Stamp as any)(p),
  p => void (p[key[0]] = "computed"),
  p => void Object.defineProperty(p, "x", { value: "defined" }),
  p => void Object.defineProperty(p, "x", { enumerable: false }),
  p => void Object.defineProperty(p, "x", { writable: false }),
  p => void p.__defineGetter__("x", () => "__defineGetter__"),
  p => void Reflect.deleteProperty(p, "x"),
  p => void delete p[key[0]],
  p => void (new Proxy(p, {}).x = "through a proxy"),
  p => void delete new Proxy(p, {}).x,
  p => void Object.defineProperty(new Proxy(p, {}), "x", { get: () => "defined through a proxy", configurable: true }),
  p => void Object.setPrototypeOf(new Proxy(p, {}), { z: "prototype through a proxy" }),
  p => void (p.__proto__ = { z: "__proto__" }),
  p => void Object.defineProperties(p, { y: { value: "both" }, x: { value: "defineProperties" } }),
];

let way = -1;
function touch(p: Point): number {
  if (way >= 0) ways[way](p);
  return 1;
}

function holder(p: Point): string {
  const before = p.x + p.y;
  const got = touch(p);
  let stored = "stored";
  const x = p.x, y = p.y;
  try {
    p.x = 7;
  } catch (error) {
    stored = (error as Error).name;
  }
  return before + " " + got + " " + typeof x + ":" + x + " " + typeof y + ":" + y + " " + stored + ":" + p.x + " " + (p as any).z + " " + Object.keys(p).join("");
}

function outer(round: number): string {
  const p = new Point(round, 1);
  const before = p.x - p.y;
  const inner = holder(p);
  return before + " [" + inner + "] " + typeof p.x + ":" + p.x + "," + p.y;
}

for (let round = 0; round < 50 * ways.length; round++) {
  way = round % 50 === 49 ? (round - 49) / 50 : -1;
  const line = outer(round);
  if (way >= 0 || round === 0) console.log(round + ": " + line);
}
