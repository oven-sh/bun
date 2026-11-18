
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

function sortOptional(v: Int32Array, f?: (a: number, b: number) => number): any { return v.sort(f); }
function sortNullable(v: Uint8Array, f: ((a: number, b: number) => number) | null | undefined | {}): any { return v.sort(f as any); }
class Own extends Int16Array { constructor(n: any) { super(n); (this as any).sort = (f: any) => { out.push("own"); return Int16Array.prototype.sort.call(this, f); }; } toSorted(f?: any): any { out.push("toSorted"); return this.slice().sort(f); } }
for (const n of [0, 1, 3, 70, 200]) for (let turn = 0; turn < 3; turn++) {
  for (const f of [undefined, (a: number, b: number) => b - a, (a: number, b: number) => (a & 3) - (b & 3)]) { const v = new Int32Array(n); fill(v, 0); sortOptional(v, f); report("optional", v); }
  for (const f of [undefined, null, {}, (a: number, b: number) => b - a, (a: number, b: number) => (a & 3) - (b & 3)]) { const v = new Uint8Array(n); fill(v, 0); try { sortNullable(v, f); } catch (e: any) { out.push(e.name + " " + e.message); } report("nullable", v); }
  for (const f of [undefined, (a: number, b: number) => b - a, {} as any]) { const v = new Own(n); fill(v, 0); try { v.sort(f); } catch (e: any) { out.push(e.name + " " + e.message); } report("own", v); try { Int8Array.prototype.sort.call(v as any, f); } catch (e: any) { out.push(e.name + " " + e.message); } report("own", v); }
  { const v = new Int32Array(n); fill(v, 0); sortOptional(v); report("none", v); }
}
console.log(out.join("\n"));
