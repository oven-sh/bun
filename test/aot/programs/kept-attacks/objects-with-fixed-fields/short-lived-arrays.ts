// Arrays that die young, as a request or a type check makes them.
function header(name: string, value: string): string[] { return [name, value]; }
function mapped(a: number[]): number[] { const r: number[] = []; for (let i = 0; i < a.length; i++) r.push(a[i] * 2); return r; }
let answer = 0; const seed = [1, 2, 3, 4, 5];
const table: Record<string, string[]> = {};
for (let i = 0; i < 6000000; i++) {
  const h = header("content-type", "text/plain"); table["k" + (i & 7)] = h;
  const m = mapped(seed); const s = m.slice(1, 4); const c = s.concat(h.length);
  answer += m[4] + s.length + c[3] + h[0].length;
}
console.log(answer);
