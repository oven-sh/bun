// Elements moved between rows of one grid: transposes, mirrors, rotations in place. Rows hold int32s, doubles, holes, texts; they are short, shared, frozen, views, or missing.
function shown(x: any, depth = 0): string { if (depth > 3) return "deep"; return Array.isArray(x) || ArrayBuffer.isView(x) ? `[${Array.from({ length: Math.min((x as any).length, 8) }, (_, i) => (i in (x as any) ? shown((x as any)[i], depth + 1) : "hole")).join(",")}]` : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }

function transpose(g: number[][]): void { for (let i = 0; i < 5; i++) for (let k = i + 1; k < 5; k++) { const kept = g[i]![k]!; g[i]![k] = g[k]![i]!; g[k]![i] = kept; } }
function byPattern(g: number[][]): void { for (let i = 0; i < 5; i++) for (let k = i + 1; k < 5; k++) [g[i]![k], g[k]![i]] = [g[k]![i]!, g[i]![k]!]; }
function mirrorRows(g: number[][]): void { for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) { const kept = g[k]![i]!; g[k]![i] = g[4 - k]![i]!; g[4 - k]![i] = kept; } }
function mirrorColumns(g: number[][]): void { for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) { const kept = g[i]![k]!; g[i]![k] = g[i]![4 - k]!; g[i]![4 - k] = kept; } }
function rotate(g: number[][]): void { for (let i = 0; i < 2; i++) for (let k = i; k < 4 - i; k++) { const kept = g[i]![k]!; g[i]![k] = g[4 - k]![i]!; g[4 - k]![i] = g[4 - i]![4 - k]!; g[4 - i]![4 - k] = g[k]![4 - i]!; g[k]![4 - i] = kept; } }
function shiftDown(g: number[][]): void { for (let k = 0; k < 5; k++) for (let i = 4; i > 0; i--) g[i]![k] = g[i - 1]![k]!; }
function copyAcross(g: number[][]): void { for (let i = 0; i < 5; i++) for (let k = 0; k < i; k++) g[i]![k] = g[k]![i]!; }
function bubbleColumns(g: number[][]): void { for (let k = 0; k < 5; k++) for (let i = 0; i + 1 < 5; i++) if (g[i]![k]! > g[i + 1]![k]!) { const kept = g[i]![k]!; g[i]![k] = g[i + 1]![k]!; g[i + 1]![k] = kept; } }
function transposeAndCount(g: number[][]): any { let n: any = 0; for (let i = 0; i < 5; i++) for (let k = i + 1; k < 5; k++) { const kept = g[i]![k]!; g[i]![k] = g[k]![i]!; g[k]![i] = kept; n += kept; } return n; }
function transposeWithCall(g: number[][]): void { for (let i = 0; i < 5; i++) for (let k = i + 1; k < 5; k++) { const kept = g[i]![k]!; g[i]![k] = g[k]![i]!; if (k === 3) poke(g); g[k]![i] = kept; } }
let poked = 0;
function poke(g: any): void { poked++; if (poked % 7 === 0) g[2] = ["x", 1, 2, 3, 4]; if (poked % 11 === 0) g[1].length = 2; }

const rows: (() => any)[] = [
  () => [1, 2, 3, 4, 5],
  () => [1.5, 2.5, 3.5, 4.5, 5.5],
  () => JSON.parse("[1,2,3,4,5]"),
  () => [1, , 3, , 5],
  () => [1.5, , 3.5, 4, ,],
  () => [NaN, -0, 1e300, 4, 5],
  () => ["a", 2, 3, 4, "e"],
  () => [1, 2],
  () => [],
  () => Object.freeze([1, 2, 3, 4, 5]),
  () => Int32Array.of(1, 2, 3, 4, 5),
  () => Float64Array.of(1.5, 2, 3, 4, 5),
  () => [undefined, null, true, 4, 5],
  () => new (class Own extends Array<number> {})(1, 2, 3, 4, 5),
];
const functions: any[] = [transpose, byPattern, mirrorRows, mirrorColumns, rotate, shiftDown, copyAcross, bubbleColumns, transposeAndCount, transposeWithCall];
for (const run of functions) {
  const lines: string[] = [];
  for (let seed = 0; seed < 90; seed++) {
    const g: any[] = [];
    for (let i = 0; i < 5; i++) g.push(rows[seed < 3 ? seed : (seed * 7 + (seed % 5 === i ? seed : i * (seed % 3))) % rows.length]!());
    if (seed % 13 === 5) g[3] = g[1];
    if (seed % 17 === 6) g[2] = undefined;
    if (seed % 19 === 7) g[4] = g;
    if (seed % 23 === 8) Object.freeze(g);
    let answer = "";
    const grid = veil(g);
    try { answer = shown(run(grid)); } catch (e: any) { answer = e.constructor.name; }
    lines.push(answer + g.map(x => x === g ? "itself" : shown(x)).join(";"));
  }
  console.log(run.name, Bun.hash(lines.join("\n")).toString(16), lines[0], lines[1], lines[4]);
}
export {};
