// Sums and differences of fields that are held as numbers: one of them holds something else now and then.
interface P { x: number; y: number; z: number }
const out: string[] = [];
let calls = 0;
function show(v: any): string { return typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "o" : typeof v === "symbol" ? "symbol" : String(v); }
function adds(ps: P[]): void { for (const p of ps) { p.x += p.y; p.y -= p.z; } }
function same(ps: P[]): void { for (const p of ps) { p.x = p.y + p.y; p.z = p.x - p.x; } }
function constants(ps: P[]): void { for (const p of ps) { p.x = p.x + 1; p.y = 10 - p.y; p.z = p.z - 0.5; } }
function three(ps: P[]): void { for (const p of ps) { p.z = p.x + p.y + p.z; p.x = p.z - p.y - p.x; } }
function total(ps: P[]): any { let t = 0; for (const p of ps) t += p.x + p.y - p.z; return t; }
function compared(ps: P[]): any { let n = 0; for (const p of ps) if (p.x + p.y > p.z) { n++; p.z = p.x + p.y; } return n; }
function indexed(ps: P[]): void { for (let i = 0; i < ps.length; i++) { const p = ps[i]!; const q = ps[(i * 3) % ps.length]!; p.x = p.y + q.y; q.z = p.x - q.x; } }
const values: any[] = [1, -0, 0.5, 2147483647, -2147483648, 4294967295, 1e300, NaN, Infinity, "7", "", "s", null, undefined, true, 5n, {}, [3], { valueOf() { calls++; return 2; } }, { valueOf() { throw new RangeError("no"); } }, Symbol("s"), () => 1];
for (const run of [adds, same, constants, three, total, compared, indexed]) {
  for (const value of values) for (const key of ["x", "y", "z"]) {
    const ps: any[] = [];
    for (let i = 0; i < 7; i++) ps.push({ x: i % 3 === 2 ? i + 0.5 : i, y: i * 2, z: i % 2 === 1 ? 2147483646 : -i });
    let answer = "";
    for (let round = 0; round < 5; round++) {
      if (round === 2) ps[3][key] = value;
      try { answer += show(run(ps)) + " "; } catch (e: any) { answer += e.name + " "; }
    }
    out.push([run.name, show(value), key, answer, calls, ...ps.map(p => [p.x, p.y, p.z].map(show).join())].join(" "));
  }
}
console.log(out.join("\n"));
