// What the programs of several generators start with: `look` prints what an object answers to every way of asking for its properties, one line for each way.
export const tsconfig = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true, types: [] } });

export class Random {
  s: number;
  constructor(seed: number) {
    this.s = (seed * 2654435761 + 12345) >>> 0 || 1;
    for (let i = 0; i < 8; i++) this.next();
  }
  next() {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return (this.s = x);
  }
  int(n: number) {
    return this.next() % n;
  }
  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }
  chance(p: number) {
    return this.int(1000) < p * 1000;
  }
  shuffle<T>(list: readonly T[]): T[] {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  sample<T>(list: readonly T[], n: number): T[] {
    return this.shuffle(list).slice(0, n);
  }
}

export const look = String.raw`const masked = new Set<PropertyKey>(["stack", "line", "column", "sourceURL", "originalLine", "originalColumn"]);
function show(v: unknown, depth = 0): string {
  if (typeof v === "string") return /=>|function/.test(v) ? "the text of a function" : JSON.stringify(v);
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "symbol" || typeof v === "bigint" || typeof v === "undefined" || typeof v === "boolean" || v === null) return String(v);
  if (typeof v === "function") return "fn:" + v.name;
  if (depth > 3) return "..";
  if (Array.isArray(v)) return "[" + v.map(x => show(x, depth + 1)).join(",") + "]";
  const o = v as Record<PropertyKey, unknown>;
  return "{" + Reflect.ownKeys(o).map(k => { const d = Reflect.getOwnPropertyDescriptor(o, k)!; return String(k) + ":" + (masked.has(k) ? "masked" : "value" in d ? show(d.value, depth + 1) : "accessor"); }).join(",") + "}";
}
function attempt(f: () => unknown): string {
  try { return show(f()); } catch (e) { return "THROWS " + (e as Error)?.constructor?.name; }
}
function describe(o: object): string {
  return Reflect.ownKeys(o).map(k => {
    const d = Reflect.getOwnPropertyDescriptor(o, k)!;
    const flags = (d.writable === undefined ? "-" : d.writable ? "w" : "_") + (d.enumerable ? "e" : "_") + (d.configurable ? "c" : "_");
    return String(k) + "(" + flags + ")" + (masked.has(k) ? "masked" : "value" in d ? show(d.value) : "get:" + show(d.get) + ",set:" + show(d.set));
  }).join(" ");
}
function look(label: string, o: object): void {
  if (Array.isArray(o) && o.length > 1000) return console.log(label + " | a long list " + o.length);
  const say = (k: string, f: () => unknown) => console.log(label + " | " + k + " " + attempt(f));
  say("keys", () => Object.keys(o));
  say("names", () => Object.getOwnPropertyNames(o));
  say("symbols", () => Object.getOwnPropertySymbols(o));
  say("ownKeys", () => Reflect.ownKeys(o));
  say("forin", () => { const r: string[] = []; for (const k in o) r.push(k); return r; });
  say("entries", () => Object.entries(o));
  say("values", () => Object.values(o));
  say("describe", () => describe(o));
  say("descriptors", () => describe(Object.getOwnPropertyDescriptors(o)));
  say("json", () => JSON.stringify(o));
  say("json2", () => JSON.stringify(o, null, 1));
  say("jsonr", () => JSON.stringify(o, (k, v) => v));
  say("spread", () => ({ ...o }));
  say("assign", () => Object.assign({}, o));
  say("assignOnto", () => Object.assign({ zz: 1 }, o, { zy: 2 }));
  say("clone", () => structuredClone(o));
  say("inspect", () => (o instanceof Error || Object.hasOwn(o, "stack") ? "an error" : Bun.inspect(o).split("\n").sort()));
  say("integrity", () => [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)]);
  say("proto", () => { const p = Object.getPrototypeOf(o); return p === null ? "null" : p === Object.prototype ? "Object.prototype" : (p.constructor?.name ?? "?"); });
  say("equals", () => [Bun.deepEquals({ ...o }, { ...o }), Bun.deepEquals({ ...o }, { ...o }, true), Bun.deepEquals(o, o, true)]);
  say("hasOwn", () => Reflect.ownKeys(o).map(k => [Object.hasOwn(o, k), k in o, Object.prototype.propertyIsEnumerable.call(o, k), Object.prototype.hasOwnProperty.call(o, k)].map(Number).join("")));
  say("fromEntries", () => Object.fromEntries(Object.entries(o)));
  say("tag", () => Object.prototype.toString.call(o));
  say("mapKeys", () => new Map(Object.entries(o)).size);
}
function hide<T>(v: T): T { return (globalThis as any).__hide ? (globalThis as any).__hide(v) : v; }
`;
