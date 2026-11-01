// Classes below built-in classes whose objects have fields. Their objects reach code that nobody follows, and get, lose and hide names in every way.
class Settings extends Map<string, number> {
  fallback: number;
  label = "settings";
  constructor(entries: [string, number][], fallback: number, more?: object) { super(entries); this.fallback = fallback; if (more) Object.assign(this, more); }
  getOr(key: string): number { return this.get(key) ?? this.fallback; }
  describe(): string { return this.label + this.size; }
}
class Failure extends Error {
  code: number;
  constructor(message: string, code: number, more?: object) { super(message); this.code = code; if (more) Object.assign(this, more); }
  isFatal(limit: number): boolean { return this.code > limit; }
  describe(): string { return this.name + this.message + this.code; }
}
class Row extends Array<number> {
  tag = "row";
  total(): number { let sum = 0; for (let i = 0; i < this.length; i++) sum += this[i] ?? 0; return sum; }
  describe(): string { return this.tag + this.length; }
}
function useSettings(s: Settings): string { return s.getOr("a") + "," + s.getOr("z") + "," + s.describe() + "," + (s as any).missing; }
function useFailure(f: Failure): string { return f.isFatal(3) + "," + f.describe() + "," + (f as any).missing; }
function useRow(r: Row): string { return r.total() + "," + r.describe() + "," + (r as any).missing; }
const sink: unknown[] = []; (globalThis as any).sink = sink;
function attempt(label: string, run: () => string) { try { console.log(label, run()); } catch (e) { console.log(label, "threw", (e as Error).constructor.name); } }
const hiding = { getOr() { return -1; }, describe() { return "hidden"; }, isFatal() { return "hidden"; }, total() { return -2; }, missing: "found" };
const changes: [string, (o: any) => void][] = [
  ["as made", () => {}],
  ["a name nobody declares", o => { o.missing = "now there"; }],
  ["a method hidden", o => { o.describe = () => "own"; }],
  ["hidden and shown again", o => { o.describe = () => "own"; delete o.describe; }],
  ["a field deleted", o => { delete o.fallback; delete o.code; delete o.tag; }],
  ["a field deleted and another name in its place", o => { delete o.fallback; delete o.code; delete o.tag; o.describe = () => "in its place"; }],
  ["a field made an accessor", o => { for (const k of ["fallback", "code", "tag"]) if (k in o) Object.defineProperty(o, k, { get() { return 77; }, configurable: true }); }],
  ["a hidden method that is not enumerable", o => { Object.defineProperty(o, "describe", { value: () => "quiet", enumerable: false }); }],
  ["a symbol", o => { o[Symbol("s")] = 1; }],
  ["to-primitive", o => { o[Symbol.toPrimitive] = () => 5; }],
  ["two hundred names", o => { for (let i = 0; i < 200; i++) o["n" + i] = i; o.describe = () => "among many"; }],
  ["two hundred names and gone", o => { for (let i = 0; i < 200; i++) o["n" + i] = i; for (let i = 0; i < 200; i++) delete o["n" + i]; }],
  ["the stack read", o => { void o.stack; }],
  ["the stack stored", o => { o.stack = "mine"; o.message = "other"; o.cause = 1; }],
  ["frozen", o => { Object.freeze(o); }],
];
for (let round = 0; round < 3; round++) {
  for (const [label, change] of changes) {
    const s = new Settings([["a", 1]], 9), f = new Failure("no", 4), r = new Row(); r.push(1, 2, 3);
    sink.push(s, f, r); sink.length = 0;
    attempt(label + " before", () => useSettings(s) + " " + useFailure(f) + " " + useRow(r));
    change(s); change(f); change(r);
    attempt(label, () => useSettings(s)); attempt(label, () => useFailure(f)); attempt(label, () => useRow(r));
  }
  attempt("born with hiding names", () => useSettings(new Settings([["a", 1]], 9, hiding)));
  attempt("born with hiding names", () => useFailure(new Failure("no", 4, hiding)));
  attempt("born with one more name", () => useSettings(new Settings([["a", 1]], 9, { missing: 3 })));
  if (round === 1) Bun.gc(true);
}
