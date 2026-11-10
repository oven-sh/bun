// break, return and throw out of the inner loop where return() itself throws: what it throws takes the place of a break or a return and gives way to a throw.
const log: string[] = []; const say = (x: unknown): void => { log.push(String(x)); };
const run = (f: () => unknown): void => { try { say(f()); } catch (e) { say(e instanceof Error ? e.message : e); } };
const throwing = (n: number, name: string): any => ({ i: 0, [Symbol.iterator]() { return this; }, next() { return { done: this.i >= n, value: this.i++ }; }, return() { say("return-" + name); throw new Error("from-return-" + name); } });
const list = [1, 2, 3], lists = [[1, 2], [3, 4]];
function outerThrows(mode: number): number { let s = 0; for (const a of throwing(3, "outer")) for (const b of list) { s += a * 10 + b; if (b === 2 && a === 1) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
function innerThrows(mode: number): number { let s = 0; for (const row of lists) for (const b of throwing(3, "inner")) { s += row[0]! * 10 + b; if (b === 1 && row[0] === 3) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
function bothThrow(mode: number): number { let s = 0; for (const a of throwing(2, "outer")) for (const b of throwing(2, "inner")) { s += a * 10 + b; if (b === 1 && a === 1) { if (mode === 0) break; if (mode === 1) return s; if (mode === 2) throw new Error("thrown" + s); } } return s; }
for (const f of [outerThrows, innerThrows, bothThrow]) for (let mode = 0; mode < 4; mode++) run(() => f(mode));
console.log(log.join(" "));
