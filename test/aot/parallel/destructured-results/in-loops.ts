// const [a, b] = f() in loops, where every return of f is a literal.
let log = "";
function show(...values: any[]): void { log += values.map(v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v))).join(",") + ";"; }
function divide(a: number, b: number): [quotient: number, remainder: number] { return [Math.floor(a / b), a % b]; }
function mixed(line: string): [string, number] { const comma = line.indexOf(","); return [line.slice(comma + 1), comma]; }
function short(n: number): number[] { if (n % 3 === 0) return []; if (n % 3 === 1) return [n]; return [n, n + 1, n + 2]; }
function holes(n: number): (number | undefined)[] { return n % 2 ? [, n] : [n, , n + 2]; }
function thrower(n: number): [number, number] { if (n === 7) throw new RangeError("seven"); return [n, -n]; }
function nested(n: number): [[number, string], { x: number }] { return [[n, "s" + n], { x: n * 2 }]; }
let calls = 0;
function effect(n: any): [any, number] { calls++; return [n, calls]; }
function recursive(n: number): [number, number] { if (n <= 1) return [n, 0]; const [a, b] = recursive(n - 1); return [a + b, a]; }
const data: number[] = JSON.parse("[5,17,-3,0,-0,2.5,1e300,7,19,23,100000,3,4,8,9,1,2,6]");
const anything: any[] = [...data, "12", null, undefined, true, { valueOf() { log += "v"; return 9; } }, NaN, Infinity, "x"];
const lines = JSON.parse('["a,b","xx,yy,z","none",",lead","trail,"]') as string[];
function byIndex(list: any[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) { const [q, r] = divide(list[i], 3); total += q * 2 + r; if (i % 5 === 0) show(q, r); }
  return total;
}
function byForOf(list: any[]): number {
  let total = 0;
  for (const n of list) { const [q, r] = divide(n, 7); total += q + r; if (q === 2) continue; if (q > 1e200) break; show(r); }
  return total;
}
for (let round = 0; round < 3; round++) {
  show(byIndex(data), byForOf(data), byIndex(anything), byForOf(anything));
  for (const line of lines) { const [rest, at] = mixed(line); show(rest, at); }
  for (let i = 0; i < 12; i++) { const [a, b, c] = short(i); show(a, b, c); const [d = "d", e = i] = short(i); show(d, e); const [, f] = short(i); show(f); const [...g] = short(i); show(g); }
  for (let i = 0; i < 6; i++) { const [a, b = a, c = b] = holes(i); show(a, b, c); }
  for (let i = 0; i < 6; i++) { const [[a, b], { x }] = nested(i); show(a, b, x); }
  let a = 0, b = 0;
  for (let i = 0; i < 12; i++) { try { [a, b] = thrower(i); show(a, b); } catch (error) { show((error as Error).message, a, b, i); } finally { show("f"); } }
  for (let i = 1; i < 9; i++) { const [f, g] = recursive(i); show(f, g); }
  const closures: (() => number)[] = [];
  for (const n of data) { const [q, r] = divide(n, 4); closures.push(() => q * 10 + r); }
  show(...closures.map(c => c()));
  for (const n of anything) { const [m, c] = effect(n); show(typeof m, c); }
  outer: for (let i = 0; i < 4; i++) for (const n of data) { const [q, r] = divide(n + i, 5); if (r === 2) continue outer; if (q > 3) break; show(q); }
  function leaves(list: number[]): string { for (const n of list) { const [q, r] = divide(n, 6); if (q === 3) return "r" + r; } return "none"; }
  show(leaves(data), leaves([]), leaves([18, 19]));
  const growing = [1, 2, 3];
  for (let i = 0; i < growing.length && i < 9; i++) { const [q, r] = divide(growing[i], 2); growing.push(q + r); show(q, r); }
  for (let i = 0; i < data.length; i++) { let [q, r] = divide(data[i], 3); q++; r *= 2; show(q, r); const pair = divide(data[i], 4); const [s, t] = pair; show(s, t, pair.length); }
}
function* generated(list: number[]) { for (const n of list) { const [q, r] = divide(n, 3); yield q; yield r; } }
show(...generated(data));
async function awaited(list: number[]): Promise<number> { let sum = 0; for (const n of list) { const [q, r] = divide(n, 3); sum += q; await null; sum += r; } return sum; }
show(await awaited(data));
show(calls);
console.log(log);
