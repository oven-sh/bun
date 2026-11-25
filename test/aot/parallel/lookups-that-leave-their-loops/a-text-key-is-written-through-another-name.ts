const N = (text: string): number => JSON.parse(text);
const a = new Map<string, number>([["x", 1]]), b = new Map<string, number>([["x", 5]]);
function f(p: Map<string, number>, q: Map<string, number>, k: string, n: number) { let s = 0; for (let i = 0; i < n; i++) { s = s * 10 + (p.get(k) ?? 9); q.set(k, (i & 3) + 2); } return s; }
console.log(f(a, b, "x", N("3")), f(a, a, "x", N("3")), f(a, b, "y", N("2")), f(a, a, "x", N("0")));
