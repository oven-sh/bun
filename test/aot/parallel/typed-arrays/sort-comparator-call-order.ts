
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

for (const n of lengths) for (let p = 0; p < 8; p++) {
  const v = new Uint32Array(n); fill(v, p); const w = v.slice(), x = v.slice(), y = v.slice(), u = v.slice(), t = v.slice();
  const r = v.sort((a, b) => { calls++; note(a); note(b); return a - b; }); if (r !== v) out.push("not itself");
  report("up" + p, v);
  w.sort((a: number, b: number) => { calls++; note(a); note(b); return (a & 7) - (b & 7); }); report("low" + p, w);
  x.sort((a, b) => b > a ? 1 : b < a ? -1 : 0); report("down" + p, x);
  y.sort(((a: number, b: number) => { calls++; note(a); return a > b; }) as any); report("bool" + p, y);
  let turn = 0; u.sort((a, b) => { calls++; note(b); turn++; return turn % 3 - 1; }); report("odd" + p, u);
  t.sort(() => { calls++; return (next() % 5) - 2; }); report("random" + p, t);
}
const plain = new Uint32Array(40); fill(plain, 0); plain.sort(); report("default", plain); plain.sort(undefined); report("undefined", plain);
const sorted = plain.toSorted((a, b) => { calls++; note(a); return a < b ? 1 : a > b ? -1 : 0; }); report("toSorted", sorted);
console.log(out.join("\n"));
