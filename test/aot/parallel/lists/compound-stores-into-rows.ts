// `holder.rows[y][i] += d` in a loop: the row is there, missing, null, replaced or taken away by a turn, no array, a view, shared with another row; no turn is run at all; what runs before the check has run when it throws.
const T = JSON.parse("36") as number, log: number[] = [];
class Holder {
  rows: number[][] = []; flags: boolean[][] = []; spare: number[] = [9, 8, 7, 6, 5, 4]; maybe: number[] | undefined = [1, 2, 3, 4, 5, 6];
  constructor(t: number) { for (let j = 0; j < 3; j++) { const row: number[] = [], flags: boolean[] = []; for (let i = 0; i < 6; i++) { row.push(t % 4 === 2 ? i * 0.5 + j : i + j); flags.push((i * j + t) % 3 === 0); } this.rows.push(row); this.flags.push(flags); } }
}
function f(i: number): number { log.push(-i); return i; }
function plain(h: Holder, y: number, n: number, d: number): number { for (let i = 0; i < n; i++) h.rows[y][i] += d; return n; }
function logged(h: Holder, y: number, n: number, d: number): number { for (let i = 0; i < n; i++) { log.push(i); h.rows[y][i] -= d; } return n; }
function called(h: Holder, y: number, n: number, d: number): number { for (let i = 0; i < n; i++) h.rows[y][f(i)] += f(d); return n; }
function field(h: Holder, y: number, n: number, d: number): number { for (let i = 0; i < n; i++) h.maybe![i] *= d; return y; }
function replaced(h: Holder, y: number, n: number, d: number): number { for (let i = 0; i < n; i++) { if (i === 2) h.rows[y] = h.spare; h.rows[y][i] += d; } return n; }
function removed(h: Holder, y: number, n: number, d: number): number { for (let i = 0; i < n; i++) { if (i === 3) (h.rows as (number[] | undefined)[])[y] = undefined; h.rows[y][i] += d; } return n; }
function nested(h: Holder, y: number, n: number, d: number): number { for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) h.rows[j][i] += h.rows[(j + 1) % 3][i] * d; return y; }
function stepped(h: Holder, y: number, n: number, d: number): number { let s = 0; for (let i = 0; i < n; i++) { s += h.rows[y][i]++; --h.rows[y][i & 3]; h.rows[y][i] |= d; } return s; }
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : String(v);
for (let t = 0; t < T; t++) {
  for (const run of [plain, logged, called, field, replaced, removed, nested, stepped]) {
    const h = new Holder(t);
    if (t % 9 === 1) (h.rows as unknown[])[1] = undefined;
    if (t % 9 === 2) (h.rows as unknown[])[2] = null;
    if (t % 9 === 3) delete h.rows[0][2];
    if (t % 9 === 4) h.rows[1].length = 3;
    if (t % 9 === 5) (h.rows as unknown[])[1] = { 0: 5, 1: 6, length: 2 };
    if (t % 9 === 6) (h.rows as unknown[])[1] = new Float64Array(6);
    if (t % 9 === 7) h.rows[2] = h.rows[0];
    if (t % 9 === 8) h.maybe = undefined;
    let r: unknown;
    try { r = run(h, t % 4, t % 5 === 4 ? 0 : t % 7 === 3 ? 8 : 6, t % 2 ? 1 : 2); } catch (error) { r = (error as Error).constructor.name; }
    console.log(run.name, r, h.rows.map(row => Array.from(row ?? [], show).join()).join("/"), (h.maybe ?? []).map(show).join(), log.length, log.slice(-8).join());
  }
}
