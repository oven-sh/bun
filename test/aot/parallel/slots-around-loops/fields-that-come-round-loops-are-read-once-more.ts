// Under: --aot-harden=proof-checks: the field that a header brings is held against memory at the first read of every iteration.
// STATISTIC: SlotsCarriedAroundLoops >= 4
class Cursor { pos = 0; end = 9; }
class Wide extends Cursor { more = 1; }
const run = (f: () => unknown): string => { try { return String(f()); } catch (error) { return (error as Error).name; } };
function bounded(x: Cursor, y: any): string { let n = 0; x.pos = 0; while (x.pos < 9 && n++ < 20) { x.pos++; y.pos += 2; } return n + ":" + x.pos; }
function broken(x: Cursor, y: any): string { let n = 0; x.pos = 0; while (n++ < 20) { if (x.pos > 9) break; x.pos++; y.pos += 2; } return n + ":" + x.pos; }
function between(x: Cursor, end: number): string { let n = 0, t = 0; x.pos = 0; while (x.pos < end && n++ < 40) { t = (t * 3 + x.pos) | 0; x.pos++; } return t + ":" + x.pos; }
function called(x: Cursor, act: (i: number) => void): string { let n = 0; x.pos = 0; while (x.pos < x.end && n++ < 30) { x.pos++; act(n); } return n + ":" + x.pos + ":" + x.end; }
function halves(x: Cursor): string { let n = 0; x.pos = 0; while (x.pos < 9 && n++ < 40) { x.pos += 0.5; } return n + ":" + x.pos; }
function kept(x: Cursor, y: Cursor): string { let n = 0; x.pos = 0; while (x.pos < 9 && n++ < 20) { y.pos = x.pos + 1; if (n % 3 === 0) x.pos += 2; } return n + ":" + x.pos + ":" + y.pos; }
const cursors = [new Cursor(), new Wide(), new Cursor()];
for (let turn = 0; turn < 60; turn++) {
  const told: string[] = [];
  for (const x of cursors) {
    for (const y of [x, cursors[0], { pos: 1 }, { get pos() { return 1; }, set pos(v: number) { x.pos = v; } }]) told.push(run(() => bounded(x, y)), run(() => broken(x, y)));
    told.push(run(() => between(x, 7)), run(() => between(x, 3.5)), run(() => called(x, i => { if (i === 3) x.pos += 4; })), run(() => called(x, i => { if (i === 2) x.end = 5; })), run(() => halves(x)), run(() => kept(x, cursors[1])));
    x.end = 9;
  }
  if (turn === 0 || turn === 32 || turn === 59) console.log(told.join(" "));
}
export {};
