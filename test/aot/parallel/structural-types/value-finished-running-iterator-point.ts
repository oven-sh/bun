// The value of a finished or running iterator fills places of type point.
interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function" || typeof value === "symbol") return typeof value;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  for (const key of Object.keys(value)) parts.push(key + ": " + show(Reflect.get(value, key)));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

const things = {
  honest: { x: 1, y: 2 },
  swapped: { y: 2, x: 1 },
  wide: { w: 0, x: 1, y: 2, z: 3 },
  texts: { x: "1", y: "2" },
  partial: { x: 1 },
  empty: {},
  getters: {
    get x() {
      log.push("x");
      return 1;
    },
    get y() {
      log.push("y");
      return "2";
    },
  },
  inherited: Object.create({ x: 1, y: 2 }),
  bare: Object.assign(Object.create(null), { x: 1, y: 2 }),
  proxy: new Proxy(
    { x: 1, y: 2 },
    {
      get(target, key, receiver) {
        log.push("get " + String(key));
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        log.push("set " + String(key));
        return Reflect.set(target, key, value, receiver);
      },
      ownKeys(target) {
        log.push("keys");
        return Reflect.ownKeys(target);
      },
    },
  ),
  frozen: Object.freeze({ x: 1, y: 2 }),
  list: [1, 2],
  callable: Object.assign(() => 0, { x: 1, y: 2 }),
  bigints: { x: 1n, y: 2n },
  boxes: {
    x: new Number(1),
    y: {
      valueOf() {
        log.push("valueOf");
        return 2;
      },
    },
  },
  zeros: { x: -0, y: -0 },
  nothing: null,
  missing: undefined,
  text: "xy",
  number: 5,
};
const names = Object.keys(things);

const all = new Map<string, unknown>(Object.entries(things));

function once(value: unknown): Iterator<never> {
  return { next: () => ({ done: true, value }) };
}

function get(name: string) {
  return once(all.get(name)).next().value;
}

function sum(p: Point): number {
  return p.x + p.y;
}

class Holder {
  p: Point;
  constructor(name: string) {
    this.p = get(name);
  }
  sum(): number {
    return this.p.x + this.p.y;
  }
}

console.log("honest callers: " + [sum({ x: 1, y: 2 }), sum({ x: 3, y: 4 }), sum({ y: 6, x: 5 })].join(" "));

const sinks: [string, (name: string) => unknown][] = [
  [
    "a local",
    name => {
      const p: Point = get(name);
      return [p.x, p.y, p.x + p.y, typeof p.x];
    },
  ],
  [
    "a field",
    name => {
      const holder = new Holder(name);
      return [holder.p.x, holder.sum()];
    },
  ],
  ["a parameter", name => sum(get(name))],
  [
    "an element",
    name => {
      const list: Point[] = [{ x: 1, y: 2 }, get(name)];
      list.push(get(name));
      let total = 0;
      for (const p of list) total += p.x;
      return [total, list[1].y, list.length];
    },
  ],
  [
    "a map value",
    name => {
      const map = new Map<string, Point>([["first", { x: 1, y: 2 }]]);
      map.set("second", get(name));
      let total = 0;
      for (const p of map.values()) total += p.y;
      return total;
    },
  ],
  [
    "its keys",
    name => {
      const p: Point = get(name);
      return [Object.keys(p).join(), JSON.stringify(p), "x" in p];
    },
  ],
  [
    "a store",
    name => {
      const p: Point = get(name);
      p.x = 7;
      return [p.x, sum(p)];
    },
  ],
];

for (const [sink, run] of sinks) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run("honest");
    rounds++;
  }
  console.log(sink + ": " + rounds + " honest rounds");
  for (const name of names) attempt(sink + ", " + name, () => run(name));
  attempt(sink + ", honest again", () => run("honest"));
}

export {};
