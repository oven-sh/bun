// One function gets a list or an iterator at each of its two levels; three levels with an iterator in the middle.
const log: string[] = []; const say = (x: unknown): void => { log.push(String(x)); };
const run = (f: () => unknown): void => { try { say(f()); } catch (e) { say(e instanceof Error ? e.message : e); } };
let closed = 0;
const counting = (n: number): any => ({ i: 0, [Symbol.iterator]() { return this; }, next() { return { done: this.i >= n, value: this.i++ }; }, return() { closed++; return {}; } });
function either(outer: Iterable<number>, inner: Iterable<number>, mode: number): number { let s = 0; for (const a of outer) for (const b of inner) { s += a * 10 + b; if (b === 1 && a === 1) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
for (let mode = 0; mode < 4; mode++) { run(() => either([0, 1, 2], [0, 1, 2], mode)); run(() => either(counting(3), [0, 1, 2], mode)); run(() => either([0, 1, 2], counting(3), mode)); run(() => either(counting(3), counting(3), mode)); say("c" + closed); }
function three(mode: number): number { let s = 0; for (const a of [1, 2]) for (const b of counting(2)) for (const c of [1, 2]) { s += a + b + c; if (a === 2 && b === 1 && c === 2) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
for (let mode = 0; mode < 4; mode++) run(() => three(mode)); say("c" + closed);
console.log(log.join(" "));
