// The nest stands in a callee that is copied into a caller under try: its inner body stands under no handler of its own, and the throw still goes into the catch of the caller, past no finally.
const log: string[] = []; const say = (x: unknown): void => { log.push(String(x)); };
const two = [[1, 2], [3, 4]];
function nest(stop: number): number { let s = 0; for (const row of two) for (const b of row) { if (b === stop) throw s; s += b; } return s; }
function caller(stop: number): number { try { return nest(stop); } catch (e) { return -(e as number) - 100; } finally { say("f"); } }
function twice(stop: number): number { let t = 0; for (const k of [1, 2]) { try { t += nest(stop) * k; } catch (e) { t -= (e as number) + k; } } return t; }
for (const stop of [9, 1, 2, 3, 4]) { say(caller(stop)); say(twice(stop)); }
console.log(log.join(" "));
