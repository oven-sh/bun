// Elements moved between rows of one grid whose rows hold int32s, doubles, holes, texts, or are shared, frozen, short, views or missing.
function shown(x: any, depth = 0): string { if (depth > 2) return "deep"; return Array.isArray(x) || ArrayBuffer.isView(x) ? `[${Array.from({ length: Math.min((x as any).length, 8) }, (_, i) => (i in (x as any) ? shown((x as any)[i], depth + 1) : "hole")).join(",")}]` : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }
const rows: (() => any)[] = [() => [1, 2, 3, 4, 5, 6], () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5], () => JSON.parse("[1,2,3,4,5,6]"), () => JSON.parse("[1,2.5,3,4,5,6]"), () => [1, , 3, , 5, 6], () => [1.5, , 3.5, 4, , 6], () => [NaN, -0, 1e300, 4, 5, 6], () => ["a", 2, 3, 4, "e", {}], () => [1, 2], () => [], () => Object.freeze([1, 2, 3, 4, 5, 6]), () => Int32Array.of(1, 2, 3, 4, 5, 6), () => Float64Array.of(1.5, 2, 3, 4, 5, 6), () => [undefined, null, true, 4, 5, 6], () => new (class Own extends Array<number> {})(1, 2, 3, 4, 5, 6), () => Object.seal([6, 5, 4, 3, 2, 1]), () => { const a = [1, 2, 3, 4, 5, 6]; (a as any).x = 1; return a; }, () => ({ 0: 1, 1: 2, length: 2 }), () => new Array(6).fill(0), () => Array.from({ length: 6 }, (_, i) => i * 2147483647)];
function run(g: number[][], h: number[][]): any { const n = 6; let t: any = 0; for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { const r = g[i]!; const kept = r[k]!; r[k] = g[k]![i]!; g[k]![i] = kept; } return t; }
const work = veil(run);
const lines: string[] = [];
for (let seed = 0; seed < 160; seed++) {
  const make = () => { const g: any[] = []; for (let i = 0; i < 6; i++) g.push(rows[seed < 4 ? seed : (seed * 7 + (seed % 5 === i ? seed : i * (seed % 3))) % rows.length]!()); return g; };
  const g = make(), h = make();
  if (seed % 13 === 5) g[3] = g[1];
  if (seed % 17 === 6) g[2] = undefined;
  if (seed % 19 === 7) g[4] = g;
  if (seed % 23 === 8) Object.freeze(g);
  if (seed % 29 === 9) h[2] = g[2];
  let answer = "";
  const grid = veil(g);
  try { answer = shown(work(grid, seed % 31 === 10 ? grid : veil(h))); } catch (e: any) { answer = e.constructor.name; }
  lines.push(answer + g.map(x => x === g ? "itself" : shown(x)).join(";") + h.map(x => shown(x)).join(";"));
}
for (let k = 0; k < lines.length; k += 10) console.log(k, Bun.hash(lines.slice(k, k + 10).join("\n")).toString(16));
export {};
