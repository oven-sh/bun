function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Vec {
  x: number;
  y: number;
  name = "vec";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
}

const log: string[] = [];

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}

function same(a: Vec, b: Vec): boolean {
  return a === b;
}

function find(list: Vec[], item: Vec): number {
  return list.indexOf(item);
}

function weightOf(weights: Map<Vec, number>, item: Vec): number | undefined {
  return weights.get(item);
}

function equalFields(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y && a.name === b.name;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Vec(i, 1);
  warm += (same(honest, honest) ? 1 : 0) + find([honest], honest) + (weightOf(new Map([[honest, i]]), honest) ?? 0) + (equalFields(honest, new Vec(i, 1)) ? 1 : 0);
}
console.log("after 2000 honest vectors", warm);

const target = new Vec(3, 4);
const proxy = new Proxy(target, {});
const second = new Proxy(target, {});

attempt("=== and ==", () => [same(proxy, target), proxy == target, same(proxy, proxy), same(proxy, second), Object.is(proxy, target)]);
attempt("the fields are equal", () => [equalFields(proxy, target), equalFields(proxy, second)]);
attempt("indexOf and includes", () => [find([target], proxy), find([proxy], target), find([target, proxy], proxy), [target].includes(proxy)]);
attempt("keys of a map", () => {
  const weights = new Map<Vec, number>([[target, 1], [proxy, 2]]);
  return [weights.size, weightOf(weights, target), weightOf(weights, proxy), weightOf(weights, second)];
});
attempt("members of a set", () => new Set<Vec>([target, proxy, second, target, proxy]).size);
attempt("weak keys", () => {
  const notes = new WeakMap<Vec, string>([[proxy, "proxy"]]);
  return [notes.get(proxy), notes.get(target), notes.has(second)];
});
attempt("a store through one is seen through all", () => {
  proxy.x = 30;
  return [target.x, second.x, proxy.x];
});
attempt("this comes back as what it was called on", () => {
  class Chain {
    steps = 0;
    next(): this {
      this.steps++;
      return this;
    }
  }
  const chain = new Chain();
  const wrapped = new Proxy(chain, {});
  return [wrapped.next() === wrapped, wrapped.next() === chain, chain.next() === chain, chain.steps];
});
attempt("switch", () => {
  switch (proxy) {
    case target:
      return "the target";
    case second:
      return "the second proxy";
    case proxy:
      return "itself";
    default:
      return "nothing";
  }
});
attempt("sorted by identity in a list", () => [proxy, target, second].map(item => [target, proxy, second].indexOf(item)));
attempt("deep equality by JSON", () => JSON.stringify(proxy) === JSON.stringify(target));
attempt("Bun.deepEquals", () => [Bun.deepEquals(proxy, target), Bun.deepEquals(structuredClone(target), target), Bun.deepEquals(structuredClone(target), target, true)]);
