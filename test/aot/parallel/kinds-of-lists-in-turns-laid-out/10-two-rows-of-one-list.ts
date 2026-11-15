// Two rows of one list are read in an inner loop: of doubles, of whole numbers, of unlike kinds, with holes, a text, shorter, missing, the same row twice.
export {};
function product(m: any[][], w: number): any { let s: any = 0; for (let i = 0; i < m.length; i++) for (let j = 0; j < m.length; j++) for (let k = 0; k < w; k++) s += m[i]![k] * m[j]![k]; return s; }
function both(m: number[][], w: number): number { let s = 0; for (let i = 0; i + 1 < m.length; i++) for (let k = 0; k < w; k++) if (m[i]![k]! < m[i + 1]![k]!) s += k; return s; }
const row = (n: number, d: number): number[] => Array.from({ length: n }, (_, i) => i / d + 1);
const out: string[] = [];
const say = (f: () => unknown): void => { try { const v = f(); out.push(Object.is(v, -0) ? "-0" : String(v).slice(0, 20)); } catch (e) { out.push((e as Error).name); } };
for (let r = 0; r < 12; r++) {
  out.length = 0;
  const same = row(12, 2);
  for (const m of [[row(12, 2), row(12, 4)], [row(12, 1), row(12, 1)], [row(12, 1), row(12, 2)], [row(12, 2), row(5, 2)], [[1.5, , 2.5], [1, 2, 3]], [[1.5, "x"], [2, 3]], [same, same], [row(9, 2), null], [], [[]]] as any[][][]) for (const w of [0, 1, 7, 8, 9, 12, 20]) { say(() => product(m, w)); say(() => both(m as number[][], w)); }
}
console.log(out.join());
