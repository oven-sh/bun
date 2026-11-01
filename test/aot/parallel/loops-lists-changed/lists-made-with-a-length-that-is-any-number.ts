// new Array(n) where n is only known to be a number: behind the call n is a valid length or -0, in front of it and in a catch it is anything.
const out: string[] = [];
const show = (label: string, value: unknown) => out.push(`${label}: ${Array.isArray(value) ? value.map(String).join(" ") : String(value)}`);
const attempt = (run: () => unknown) => { try { return run(); } catch (error) { return (error as Error).constructor.name; } };

function squares(count: number): number[] { const list = new Array<number>(count); for (let k = 0; k < count; k++) list[k] = k * k; return list; }
function mirrored(count: number): number[] { const list = new Array<number>(count); for (let k = 0; count > k; k++) list[k] = k + 0.5; return list; }
function onePast(count: number): number[] { const list = new Array<number>(count); for (let k = 0; k <= count; k++) list[k] = k; return list; }
function holes(count: number): number { const list = new Array(count); let seen = 0; for (let k = 0; k < count; k++) if (list[k] === undefined) seen++; return seen; }
function pair(count: number): string { const xs = new Array<number>(count); const ys = new Array<number>(count); for (let k = 0; k < count; k++) { xs[k] = k; ys[k] = -k * 0.5; } return xs.join() + "|" + ys.join(); }

// -0 makes an empty list, and it stays -0 for everybody but the comparison.
function zero(count: number): unknown[] { const list = new Array(count); let turns = 0; for (let k = 0; k < count; k++) turns++; return [list.length, turns, 1 / count, Object.is(count, -0)]; }
function zeroOnBothArms(count: number): number { const list = new Array(count); if (list.length < count) return 7; if (0 < count) return 1 / count; return 1 / count; }
function zeroBehindLoop(count: number): number { const list = new Array<number>(count); let k = 0; while (k < count) list[k++] = 1; return 1 / (count + k); }

// What did not return says nothing of n.
function inCatch(count: number): string { try { return "made " + new Array(count).length; } catch { return (count < 2 ? "below two " : "not below two ") + count; } }
function behindCatch(count: number): number { let list: unknown[] | null = null; try { list = new Array(count); } catch {} let turns = 0; for (let k = 0; k < count && k < 5; k++) turns++; return turns + (list ? 100 : 0); }
function inFront(count: number): number { let below = 0; for (let round = 0; round < 3; round++) { if (count < 1.6) below++; try { new Array(count); } catch {} } return below; }
function inFinally(count: number): string { let said = ""; try { new Array(count); } catch { said += "threw "; } finally { said += count < 1 ? "below one" : "not below one"; } return said; }

// Lengths that no int32 holds.
function long(count: number): unknown[] { const list = new Array<number>(count); let k = 0; for (; k < count && k < 3; k++) list[k] = k; return [list.length, k, count > 2147483647, count >= 4294967295]; }

// The list does not keep the length it was made with.
function cutInLoop(count: number): number[] { const list = new Array<number>(count); for (let k = 0; k < count; k++) { list[k] = k; if (k === 1) list.length = 2; } return list; }
function cutInFront(count: number): number[] { const list = new Array<number>(count); list.length = 1; for (let k = 0; k < count; k++) list[k] = k; return list; }
function grownInLoop(count: number): number[] { const list = new Array<number>(count); for (let k = 0; k < count; k++) { list[k] = k; if (k === 0) list.push(9.5); } return list; }
function handed(count: number, change: (list: number[]) => void): number[] { const list = new Array<number>(count); change(list); for (let k = 0; k < count; k++) list[k] = k; return list; }

// Another n each turn.
function many(counts: number[]): number { let total = 0; for (const count of counts) { const list = new Array<number>(count); for (let k = 0; k < count; k++) list[k] = count; for (let k = 0; k < count; k++) total += list[k]; } return total; }

const lengths = [0, -0, 1, 3, 20];
const wrong = [1.5, -1, NaN, Infinity, -Infinity, 4294967296, 0.1, -0.5];
for (const n of lengths) { show("squares " + n, squares(n)); show("mirrored " + n, mirrored(n)); show("one past " + n, onePast(n)); show("holes " + n, holes(n)); show("pair " + n, pair(n)); }
for (const n of wrong) show("wrong " + n, [attempt(() => squares(n)), attempt(() => mirrored(n)), attempt(() => onePast(n)), attempt(() => holes(n)), attempt(() => pair(n)), attempt(() => zero(n)), attempt(() => long(n))]);
for (const n of [0, -0, 2]) { show("zero " + n, zero(n)); show("zero on both arms " + n, zeroOnBothArms(n)); show("zero behind the loop " + n, zeroBehindLoop(n)); }
for (const n of [...lengths, ...wrong]) show("around a catch " + n, [inCatch(n), behindCatch(n), inFront(n), inFinally(n)]);
for (const n of [2147483647, 2147483648, 4294967294, 4294967295]) show("long " + n, long(n));
for (const n of [0, 1, 2, 4]) show("changed " + n, [cutInLoop(n).join(), cutInFront(n).join(), grownInLoop(n).join(), handed(n, list => { list.length = 1; }).join(), handed(n, list => { list.push(1.5); }).join()]);
show("many", many([3, 0, -0, 5, 1]));
show("many, one wrong", attempt(() => many([3, 2.5, 1])));
let sum = 0;
for (let round = 0; round < 2000; round++) { const list = squares(round % 50); sum += list.length ? list[list.length - 1] : 0.25; }
show("often", sum);
console.log(out.join("\n"));
