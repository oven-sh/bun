// break, return and throw out of the inner loop: a return() that counts is called once for each iterator that is left, at the outer level, the inner level and both; two lists call none.
const log: string[] = []; const say = (x: unknown): void => { log.push(String(x)); };
const run = (f: () => unknown): void => { try { say(f()); } catch (e) { say(e instanceof Error ? e.message : e); } };
let closed = 0;
const counting = (n: number): any => ({ i: 0, [Symbol.iterator]() { return this; }, next() { return { done: this.i >= n, value: this.i++ }; }, return() { closed++; say("closed" + closed); return {}; } });
const list = [1, 2, 3], lists = [[1, 2], [3, 4]];
function outerCounts(mode: number): number { let s = 0; for (const a of counting(3)) for (const b of list) { s += a * 10 + b; if (b === 2 && a === 1) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
function innerCounts(mode: number): number { let s = 0; for (const row of lists) for (const b of counting(3)) { s += row[0]! * 10 + b; if (b === 1 && row[0] === 3) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
function bothCount(mode: number): number { let s = 0; for (const a of counting(2)) for (const b of counting(2)) { s += a * 10 + b; if (b === 1 && a === 1) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
function bothLists(mode: number): number { let s = 0; for (const row of lists) for (const b of row) { s += b; if (b === 3) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
for (const f of [outerCounts, innerCounts, bothCount, bothLists]) for (let mode = 0; mode < 4; mode++) run(() => f(mode));
say(closed);
console.log(log.join(" "));
