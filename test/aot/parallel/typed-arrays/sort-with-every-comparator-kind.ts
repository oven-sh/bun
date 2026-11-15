
let seed = 12345;
function next(): number { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return seed; }
let hash = 0, calls = 0;
function note(x: any): void { const n = typeof x === "bigint" ? Number(x & 0xffffffn) : x; hash = (Math.imul(hash, 31) + (n | 0) + (n > 2147483647 ? 7 : 0)) | 0; }
const out: string[] = [];
function report(name: string, v: any): void { let h = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; h = (Math.imul(h, 31) + (Number(x) | 0) + (Object.is(x, -0) ? 3 : 0)) | 0; } out.push(name + " " + v.length + " " + h + " calls " + calls + " " + hash); calls = 0; hash = 0; }
const lengths = [0, 1, 2, 3, 5, 7, 8, 9, 10, 16, 17, 63, 64, 65, 66, 73, 100, 127, 128, 129, 200, 257, 300, 700];
function fill(v: any, pattern: number): void {
  const big = typeof v[0] === "bigint";
  for (let i = 0; i < v.length; i++) {
    let x = pattern === 0 ? next() : pattern === 1 ? i : pattern === 2 ? v.length - i : pattern === 3 ? (i * 7) % 40 : pattern === 4 ? 5 : pattern === 5 ? (i < v.length / 2 ? i : v.length - i) : pattern === 6 ? next() & 3 : i < 20 ? i : 19 - i;
    v[i] = big ? BigInt(x) : x;
  }
}

const makers: Record<string, () => any> = {
  nan: () => () => NaN, undef: () => () => undefined, nul: () => () => null, text: () => (a: number, b: number) => String(a - b), object: () => (a: number, b: number) => ({ valueOf() { calls++; return a - b; } }),
  big: () => () => 1n, symbol: () => () => Symbol("x"), infinite: () => (a: number, b: number) => a < b ? -Infinity : Infinity, minusZero: () => () => -0, fraction: () => (a: number, b: number) => (a - b) / 1e6,
  bound: () => function (this: any, k: number, a: number, b: number) { calls += k; note(this.z); return a - b; }.bind({ z: 9 }, 2), proxy: () => new Proxy((a: number, b: number) => b - a, {}),
  proxyApply: () => new Proxy((a: number, b: number) => b - a, { apply(f, t, args) { calls++; note(args.length); note(t === undefined ? 1 : 2); return f(args[0], args[1]); } }),
  args: () => function () { calls++; note(arguments.length); note(arguments[0]); return arguments[0] - arguments[1]; }, rest: () => (...xs: number[]) => { calls++; note(xs.length); return xs[0]! - xs[1]!; },
  that: () => function (this: any, a: number, b: number) { note(this === undefined ? 1 : 2); return a - b; }, method: () => ({ compare(a: number, b: number) { return a - b; } }).compare, one: () => (a: number) => a & 1 ? -1 : 1,
  generator: () => function* (a: number, b: number) { yield a - b; }, async: () => async (a: number, b: number) => a - b, klass: () => class { }, math: () => Math.max, number: () => Number, throwing: () => { let n = 0; return (a: number, b: number) => { calls++; if (++n === 11) throw new Error("at 11"); return a - b; }; },
  throwingObject: () => { let n = 0; return (a: number, b: number) => ({ valueOf() { if (++n === 5) throw new RangeError("value"); return a - b; } }); },
  defaults: () => (a = 5, b = 6) => a - b,
};
const bad: any[] = [null, 1, "x", {}, [], true, Symbol.iterator, /x/, 5n];
function sortInt32(v: Int32Array, f: any): any { return v.sort(f); }
function sortBytes(v: Uint8Array, f: (a: number, b: number) => number): Uint8Array { return v.sort(f); }
for (const n of [0, 1, 2, 6, 12, 90, 200]) {
  for (const name of Object.keys(makers)) {
    for (let p = 0; p < 4; p++) {
      const v = new Int32Array(n), w = new Uint8Array(n), x = new Uint32Array(n); fill(v, p); fill(w, p); fill(x, p);
      for (const [label, f] of [["i", () => sortInt32(v, makers[name]!())], ["b", () => sortBytes(w, makers[name]!())], ["u", () => x.sort(makers[name]!())]] as [string, () => any][]) {
        try { const r = f(); if (r !== v && r !== w && r !== x) out.push("other"); } catch (e: any) { out.push(e.name + ": " + e.message); }
        report(name + label + p, label === "i" ? v : label === "b" ? w : x);
      }
    }
  }
  for (const f of bad) { const v = new Int32Array(n); fill(v, 0); try { sortInt32(v, f); out.push("sorted"); } catch (e: any) { out.push(e.name + ": " + e.message); } try { (v as any).sort(f, 1); out.push("sorted"); } catch (e: any) { out.push(e.name + ": " + e.message); } report("bad", v); }
}
console.log(out.join("\n"));
