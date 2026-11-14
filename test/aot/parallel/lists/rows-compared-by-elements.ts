// Rows of which nothing is known, compared, copied and tested for truth: booleans, whole numbers, fractions, text, holes, missing rows, views, and rows of several kinds in one array.
const T = JSON.parse("30") as number, log: string[] = [];
const shared = { s: 1 };
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "object" ? "o" : String(v);
const elements: ((i: number, j: number) => unknown)[] = [(i, j) => (i * j) % 3 === 0, (i, j) => (i * j) % 5, (i, j) => i * 0.5 + (j % 2), (i, j) => "k" + (i * j) % 3, (i, j) => i % 3 ? i : "x" + j, i => i % 4 ? i % 2 === 0 : null, i => i % 2 ? -0 : 0, i => i % 3 ? i : NaN, i => i % 2 ? shared : { i }];
function build(make: (i: number, j: number) => unknown): any[][] { return Array.from({ length: 5 }, (_, j) => Array.from({ length: 6 }, (_, i) => make(i, j))); }
function pairs(m: any[][], w: number): number { let s = 0; for (let r = 0; r + 1 < m.length; r++) for (let c = 0; c + 1 < w; c++) { const x = m[r][c]; if (x === m[r][c + 1] && x === m[r + 1][c] && x === m[r + 1][c + 1]) s += 3; } return s; }
function runs(m: any[][], w: number): number {
  let s = 0;
  const line = (get: (k: number) => any) => { let run = 1; for (let i = 1; i <= m.length; i++) { if (i < m.length && get(i) === get(i - 1)) { run++; continue; } if (run >= 2) s += run; run = 1; } };
  for (let i = 0; i < w; i++) { line(k => m[k][i]); line(k => m[i % m.length][k]); }
  return s;
}
function truth(m: any[][], w: number): number { let s = 0; for (let r = 0; r < m.length; r++) for (let c = 0; c < w; c++) { if (m[r][c]) s += c; if (!m[r][c]) s += 100; } return s; }
function copies(m: any[][], w: number): number { let s = 0; for (let r = 0; r < m.length; r++) { const out: any[] = []; for (let c = 0; c < w; c++) { out.push(m[r][c]); if (m[r][c] === out[0]) s++; } log.push(out.map(show).join()); } return s; }
function toggles(m: any[][], w: number, y: number): number { for (let r = 0; r < m.length; r++) for (let c = 0; c < w; c++) { if (m[r][c] === m[y][c]) m[r][c] = !m[r][c]; } return w; }
function bits(m: any[][], w: number, y: number): number { let s = 0; for (let r = 0; r < m.length; r++) for (let c = 0; c < w; c++) { const v = m[r][c]; if (v === m[y][c]) s++; s ^= v; } return s; }
function loose(m: any[][], w: number, y: number): number { let s = 0; for (let r = 0; r < m.length; r++) for (let c = 0; c < w; c++) { if (m[r][c] == m[y][c]) s++; if (m[r][c] != null) s += 2; if (typeof m[r][c] === "number") s += 4; } return s; }
for (let t = 0; t < T; t++) {
  const said: string[] = [];
  for (const make of elements) for (const run of [pairs, runs, truth, copies, toggles, bits, loose]) {
    const m = t % 2 ? build(make) : JSON.parse(JSON.stringify(build(make))) as any[][];
    if (t % 7 === 1) delete m[1][2];
    if (t % 7 === 2) m[2].length = 2;
    if (t % 7 === 3) (m as unknown[])[1] = undefined;
    if (t % 7 === 4) (m as unknown[])[1] = new Float64Array(7);
    if (t % 7 === 5) { m[0] = [1, 2, 3, 4, 5, 6]; m[1] = [0.5, 1.5, 2, 3, 4, 5]; m[2] = ["a", true, 3]; }
    let r: unknown;
    try { r = run(m, t % 5 === 3 ? 8 : 6, t % 5); } catch (error) { r = (error as Error).constructor.name; }
    said.push(show(r));
  }
  console.log(said.join(), log.length, log.slice(-4).join(";"));
}
