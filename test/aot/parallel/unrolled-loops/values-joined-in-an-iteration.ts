// A value that is joined inside an iteration is read behind the loop's exit: returned, summed, boxed for a callback, kept in an object.
type Bytes = Uint8Array | number[];
function order(a: Bytes, b: Bytes): number { for (let i = 0; i < a.length; i++) { const d = a[i]! < b[i]! ? -1 : a[i]! > b[i]! ? 1 : 0; if (d !== 0) return d; } return a.length - b.length; }
function views(a: Uint8Array, b: Uint8Array): number { for (let i = 0; i < a.length; i++) { const d = a[i] === b[i] ? 0 : a[i]! < b[i]! ? -1 : 1; if (d !== 0) return d; } return 0; }
function doubles(a: Float64Array, limit: number): number { let m = -1; for (let i = 0; i < a.length; i++) { const x = a[i]!; const b = m > x ? m : x; if (b > limit) return b; m = b; } return m; }
function lists(a: number[], limit: number): string { let s = 0; for (let i = 0; i < a.length; i++) { const d = i < limit ? i : limit; if (a[i] === -7) return d + "/" + s; s += d; } return "end/" + s; }
function texts(s: string, t: string): number { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i), d = t.charCodeAt(i); const e = c === d ? 0 : c < d || d !== d ? -1 : 1; if (e !== 0) return e * (i + 1); } return 0; }
function kept(a: number[]): object { let d = 0, i = 0; for (; i < a.length; i++) { d = i & 1 ? i * 2 : i + 9; if (d > 20) break; } return { d, i, twice: [d, d] }; }
function twice(a: Uint8Array, q: number): number { for (let i = 0; i < a.length; i++) { const d = a[i]! < 4 ? 1 : 2; const e = d === 1 && i > q ? 3 : d; if (e === 3) return e * 10 + d; if (a[i] === 9) return d; } return 0; }
function called(a: Uint8Array, f: (x: number) => number): number { for (let i = 0; i < a.length; i++) { const d = a[i]! > 5 ? a[i]! : -1; if (d > 0) return f(d); } return f(0); }
const out: (string | number)[] = [];
for (let n = 0; n < 20; n++) {
  for (let p = 0; p <= n; p += 3) {
    const a = Uint8Array.from({ length: n }, (_, k) => (k === p ? 9 : k % 5)), b = Uint8Array.from({ length: n }, (_, k) => (k === p ? 8 : k % 5)), l = Array.from(a, (x, k) => (k === p ? -7 : x + (n & 1 ? 0.5 : 0)));
    out.push(order(a, b), order(l, [...b]), order([...b], [...a]), views(a, b), views(b, a), doubles(Float64Array.from(l), n - p), lists(l, p), texts(String(a), String(b)), JSON.stringify(kept(l)), twice(a, p), called(a, x => x * 2));
  }
}
console.log(out.length, out.join(" "));
console.log([[3, 1], [1, 2], [1, 1, 9], [0]].sort(order as any).join("|"));
