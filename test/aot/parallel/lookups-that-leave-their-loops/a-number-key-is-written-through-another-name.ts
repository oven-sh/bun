const N = (text: string): number => JSON.parse(text);
const a = new Map<number, number>([[1, 1]]), b = new Map<number, number>([[1, 5]]);
function f(p: Map<number, number>, q: Map<number, number>, k: number, n: number) { let s = 0; for (let i = 0; i < n; i++) { s = s * 10 + (p.get(k) ?? 9); q.set(k, (i & 3) + 2); } return s; }
console.log(f(a, b, 1, N("3")), f(a, a, 1, N("3")), f(a, b, 2, N("2")), f(a, a, 1, N("0")));
const o = {}, seen = new Set<object>();
function g(s: Set<object>, t: Set<object>, k: object, n: number) { let r = ""; for (let i = 0; i < n; i++) { r += s.has(k) ? "y" : "n"; if (i === 1) t.add(k); if (i === 3) t.delete(k); } return r; }
console.log(g(seen, new Set<object>(), o, N("4")), g(seen, seen, o, N("6")));
