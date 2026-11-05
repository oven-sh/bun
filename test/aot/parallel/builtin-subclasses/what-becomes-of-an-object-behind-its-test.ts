// The object passes the test of a typed function, then changes, then is used again in the same function and in others.
class Numbers extends Array<number> {
  sum(): number { let total = 0; for (let i = 0; i < this.length; i++) total += this[i] ?? 0; return total; }
  first(): number | undefined { return this[0]; }
}
class Failure extends Error {
  code: number;
  constructor(message: string, code: number) { super(message); this.code = code; }
  describe(): string { return this.name + ":" + this.message + ":" + this.code; }
}
class Registry extends Map<string, number> {
  total(): number { let sum = 0; for (const value of this.values()) sum += value; return sum; }
}
const changes: [string, (o: any) => void][] = [
  ["nothing", () => {}],
  ["own method", o => { o.sum = o.describe = o.total = () => "own"; }],
  ["own property", o => { o.added = 1; }],
  ["many own properties", o => { for (let i = 0; i < 200; i++) o["k" + i] = i; }],
  ["added and deleted", o => { o.added = 1; delete o.added; }],
  ["null prototype", o => { Object.setPrototypeOf(o, null); }],
  ["plain prototype", o => { Object.setPrototypeOf(o, { sum() { return "plain"; }, describe() { return "plain"; }, total() { return "plain"; } }); }],
  ["prototype there and back", o => { const p = Object.getPrototypeOf(o); Object.setPrototypeOf(o, {}); Object.setPrototypeOf(o, p); }],
  ["frozen", o => { Object.freeze(o); }],
  ["sealed", o => { Object.seal(o); }],
  ["not extensible", o => { Object.preventExtensions(o); }],
  ["accessor", o => { Object.defineProperty(o, "code", { get() { return "got"; }, configurable: true }); Object.defineProperty(o, "length2", { get() { return 1; } }); }],
  ["symbol key", o => { o[Symbol.iterator] = function* () { yield 41; }; }],
  ["becomes a prototype", o => { Object.create(o); }],
];
function useNumbers(n: Numbers, change: (o: any) => void): string { const before = n.sum(); change(n); let after: unknown; try { after = n.sum(); } catch (e) { after = (e as Error).constructor.name; } return before + "|" + after; }
function useFailure(f: Failure, change: (o: any) => void): string { const before = f.describe() + f.code; change(f); let after: unknown; try { after = f.describe() + f.code; } catch (e) { after = (e as Error).constructor.name; } return before + "|" + after; }
function useRegistry(r: Registry, change: (o: any) => void): string { const before = r.total(); change(r); let after: unknown; try { after = r.total(); } catch (e) { after = (e as Error).constructor.name; } return before + "|" + after; }
function again(n: Numbers | Failure | Registry): string {
  try {
    if (n instanceof Numbers) return "numbers " + n.sum();
    if (n instanceof Failure) return "failure " + n.describe();
    if (n instanceof Registry) return "registry " + n.total();
    return "none of them " + Object.prototype.toString.call(n);
  } catch (e) { return "threw " + (e as Error).constructor.name; }
}
for (let round = 0; round < 3; round++) {
  for (const [label, change] of changes) {
    const n = new Numbers(); n.push(1, 2, 3);
    const f = new Failure("no", 7);
    const r = new Registry([["a", 1], ["b", 2]]);
    console.log(label, useNumbers(n, change), useFailure(f, change), useRegistry(r, change));
    console.log(label, again(n), again(f), again(r));
    console.log(label, Array.isArray(n), n.length, Error.isError?.(f), f instanceof Error, r.size, JSON.stringify(n), JSON.stringify(Object.keys(f).slice(0, 3)));
  }
}
