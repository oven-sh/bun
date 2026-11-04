// A loop with guesses at values that it does not change is built twice: typed behind the tests in front of it, closed where one fails.
// Each loop here runs with what its types say and with what they do not say, and is left by break, continue, return, throw, a label, finally and switch.
// What it defines is read behind it, behind two loops, on two ways and by a hint alone. Loops stand three deep, side by side with a counter that goes on,
// around an await, and over lists, sets, maps, texts, generators and iterables of their own. `held` is no parameter: no guard at an entry proves it.
const report = (value: unknown) => console.log(String(value));
class Box { x: number; constructor(x: number) { this.x = x; } }
let calls = 0;
const other = { y: 0, x: 2 };
const counted = { get x() { calls++; return 2; } };
function tell(f: () => unknown) { try { report(f()); } catch (thrown) { report((thrown as Error).name); } }
function each(f: (o: Box) => unknown) { tell(() => f(new Box(2))); tell(() => f(other as any)); tell(() => f(counted as any)); report(calls); tell(() => f(null as any)); tell(() => f(7 as any)); tell(() => f({ x: "2" } as any)); }
function withBreak(o: Box, n: number) { let s = 0; let i = 0; for (; i < n; i++) { s += o.x; if (s > 6) break; } return s * 100 + i; }
function withContinue(o: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) { if (i & 1) continue; s += o.x; } return s; }
function withReturn(o: Box, n: number) { for (let i = 0; i < n; i++) { if (o.x * i > 6) return i; } return -1; }
function caught(o: Box, n: number) { let s = 0; try { for (let i = 0; i < n; i++) { s += o.x; if (i === 2) throw new Error("stop"); } } catch (thrown) { s += 1000; } return s; }
function caughtInside(o: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) { try { if (i === 2) throw new Error("stop"); s += o.x; } catch (thrown) { s += 1000 + o.x; } } return s; }
function thrownOut(o: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) { s += o.x; if (s > 7) throw new RangeError("far"); } return s; }
function labeled(o: Box, n: number) { let s = 0; outer: for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { s += o.x; if (j === 1 && i === 1) continue outer; if (s > 40) break outer; } s += 100; } return s; }
function twoExits(o: Box, n: number) { let i = 0; let found = "none"; while (true) { if (i >= n) { found = "end"; break; } if (o.x === i) { found = "hit"; break; } i++; } return found + i; }
function lastValue(o: Box, n: number) { let last; let i = 0; do { last = o.x + i; i++; } while (i < n); return last * 10 + i; }
function readBehindTwoWays(o: Box, n: number) { let i = 0; let seen = 0; for (; i < n; i++) { seen = o.x * i; if (seen > 5) break; } if (n & 1) i += 100; return seen * 1000 + i; }
function withFinally(o: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) { try { s += o.x; if (i === 1) continue; if (i === 3) break; } finally { s += 10; } } return s; }
function withSwitch(o: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) { switch (i & 3) { case 0: s += o.x; break; case 1: continue; case 2: s += o.x * 2; default: s += 1; } } return s; }
function threeDeep(o: Box, p: Box, q: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) { s += o.x; for (let j = 0; j < n; j++) { s += p.x * j; for (let k = 0; k < n; k++) s += q.x * k + o.x; } } return s; }
function madeInLoopAround(rows: Box[], n: number) { let s = 0; for (let i = 0; i < rows.length; i++) { const row = rows[i]; for (let j = 0; j < n; j++) s += row.x * j; } return s; }
function noTurn(o: Box) { let s = 7; for (let i = 0; i < 0; i++) s += o.x; return s; }
function assigned(o: Box, next: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) { s += o.x; o = next; } return s; }
function changed(o: Box, n: number, f: (o: Box) => void) { let s = 0; for (let i = 0; i < n; i++) { s += o.x; f(o); } return s; }
function twoLoops(o: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) s += o.x; for (let i = 0; i < n; i++) s += o.x * 2; return s; }
function readBehindBothLoops(rows: Box[], o: Box, n: number) { let last; let i = 0; do { const row = rows[i]; let j = 0; do { last = row.x * j + o.x; j++; } while (j < n); i++; } while (i < rows.length); return last; }
function countersGoOn(lists: number[][]) { let s = 0; for (let r = 0; r < lists.length; r++) { const a = lists[r]; let j = 0; for (; j < 4; j++) s += a[j]; for (; j < 8; j++) s += a[j] * 2; s = s * 3 + j; } return s; }
function boundGoesOn(lists: number[][], n: number) { let s = 0; for (let r = 0; r < lists.length; r++) { const a = lists[r]; let j = 0; let m = n + r; for (; j < m; j++) { if (a[j] > 6) break; s += a[j]; } if (j < m) s += 1000; s = s * 3 + j + m; } return s; }
function releasedOnTheWayOut(o: Box, n: number) { let text: string | null = "a"; let i = 0; while (text !== null) { if (i >= n) break; if (o.x === i) { text = null; break; } text = text + "b"; i++; } return String(text) + i; }
function* generated(o: Box, n: number) { for (let i = 0; i < n; i++) yield o.x + i; }
function drained(o: Box, n: number) { let s = 0; for (const value of generated(o, n)) s += value; return s; }
let closed = 0;
function overList(o: Box, list: number[]) { let s = 0; for (const value of list) s += value * o.x; return s; }
function overListLeft(o: Box, list: number[]) { let s = 0; for (const value of list) { s += value * o.x; if (s > 7) break; } return s; }
function overSet(o: Box, set: Set<number>) { let s = 0; for (const value of set) { s += value * o.x; if (s > 50) break; } return s; }
function overEntries(o: Box, map: Map<string, number>) { let s = ""; for (const [key, value] of map) s += key + value * o.x; return s; }
function overText(o: Box, text: string) { let s = ""; for (const letter of text) s += letter + o.x; return s; }
function overGenerated(o: Box, n: number) { let s = 0; for (const value of generated(new Box(1), n)) { s += value * o.x; if (s > 20) break; } return s; }
function overOwnIterable(o: Box, n: number) { const iterable = { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= n, value: i++ }), return() { closed++; return {}; } }; } }; let s = 0; for (const value of iterable) { s += value * o.x; if (value === 2) break; } return s * 10 + closed; }
function overOwnIterableThrown(o: Box, n: number) { const iterable = { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= n, value: i++ }), return() { closed++; return {}; } }; } }; let s = 0; try { for (const value of iterable) { s += value * o.x; if (value === 1) throw new Error("stop"); } } catch (thrown) { s += 100; } return s * 10 + closed; }
let held: Box = new Box(2);
function eachHeld(f: () => unknown) { each(o => { held = o; return f(); }); }
function heldWithBreak(n: number) { const o = held; let s = 0; let i = 0; for (; i < n; i++) { s += o.x; if (s > 6) break; } return s * 100 + i; }
function heldLastValue(n: number) { const o = held; let last; let i = 0; do { last = o.x + i; i++; } while (i < n); return last * 10 + i; }
function heldOverList(list: number[]) { const o = held; let s = 0; for (const value of list) { s += value * o.x; if (s > 7) break; } return s; }
function heldOverSet(set: Set<number>) { const o = held; let s = 0; for (const value of set) { s += value * o.x; if (s > 50) break; } return s; }
function heldOverOwnIterable(n: number) { const o = held; const iterable = { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= n, value: i++ }), return() { closed++; return {}; } }; } }; let s = 0; for (const value of iterable) { s += value * o.x; if (value === 2) break; } return s * 10 + closed; }
function heldChangedInLoop(n: number, next: Box) { let s = 0; for (let i = 0; i < n; i++) { s += held.x; if (i === 1) held = next; } return s; }
async function countersGoOnBesideAwait(a: number[], rounds: number) { let s = 0; let last; for (let r = 0; r < rounds; r++) { let j = 0; for (; j < 4; j++) s += a[j]; for (; j < 8; j++) s += a[j] * 2; s = s * 3 + j; last = j; await null; } return s + "," + last; }
async function awaited(o: Box, n: number) { let s = 0; for (let i = 0; i < n; i++) { s += o.x; await null; } return s; }
each(o => withBreak(o, 9));
each(o => withBreak(o, 0));
each(o => withContinue(o, 5));
each(o => withReturn(o, 9));
each(o => withReturn(o, 2));
each(o => caught(o, 5));
each(o => caughtInside(o, 5));
each(o => thrownOut(o, 9));
each(o => labeled(o, 4));
each(o => twoExits(o, 9));
each(o => twoExits(o, 1));
each(o => lastValue(o, 3));
each(o => readBehindTwoWays(o, 9));
each(o => readBehindTwoWays(o, 2));
each(o => withFinally(o, 6));
each(o => withSwitch(o, 9));
each(o => threeDeep(o, new Box(3), new Box(4), 3));
each(o => threeDeep(new Box(3), o, new Box(4), 3));
each(o => threeDeep(new Box(3), new Box(4), o, 3));
each(o => threeDeep(o, o, o, 2));
each(o => madeInLoopAround([new Box(1), o, new Box(3)], 3));
each(o => noTurn(o));
each(o => assigned(o, new Box(5), 3));
each(o => assigned(new Box(5), o, 3));
each(o => changed(o, 3, p => { p.x = p.x + 1; }));
each(o => twoLoops(o, 3));
each(o => drained(o, 3));
each(o => readBehindBothLoops([new Box(1), o, new Box(3)], new Box(4), 3));
each(o => readBehindBothLoops([new Box(1), new Box(3), o], o, 2));
tell(() => countersGoOn([[1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1]]));
tell(() => countersGoOn([[1, 2, 3, 4, 5, 6, 7, 8], { 0: 1, 1: 2, 5: 3 } as any, [1.5, 2, 3, 4, 5, 6, 7, 8]]));
tell(() => countersGoOn([[1, 2, 3, 4, 5, 6, 7, 8], null as any]));
tell(() => boundGoesOn([[1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1], [1, 1, 1]], 2));
tell(() => boundGoesOn([[1, 2, 3, 4, 5, 6, 7, 8], "123456789" as any, [1, 1, 1, 1, 1, 1]], 4));
each(o => releasedOnTheWayOut(o, 5));
each(o => releasedOnTheWayOut(o, 1));
each(o => overList(o, [1, 2, 3]));
each(o => overList(o, []));
each(o => overList(o, new Set([4, 5]) as any));
each(o => overListLeft(o, [1, 2, 3, 4, 5]));
each(o => overSet(o, new Set([1, 2, 30, 4])));
each(o => overEntries(o, new Map([["a", 1], ["b", 2]])));
each(o => overText(o, "xyz"));
each(o => overGenerated(o, 9));
each(o => overOwnIterable(o, 5));
each(o => overOwnIterable(o, 1));
each(o => overOwnIterableThrown(o, 5));
eachHeld(() => heldWithBreak(9));
eachHeld(() => heldWithBreak(0));
eachHeld(() => heldLastValue(3));
eachHeld(() => heldOverList([1, 2, 3, 4, 5]));
eachHeld(() => heldOverSet(new Set([1, 2, 30, 4])));
eachHeld(() => heldOverOwnIterable(5));
eachHeld(() => heldChangedInLoop(4, new Box(10)));
eachHeld(() => heldChangedInLoop(4, other as any));
report(await countersGoOnBesideAwait([1, 2, 3, 4, 5, 6, 7, 8], 3));
report(await countersGoOnBesideAwait({ 0: 1, 1: 2, 5: 3 } as any, 2));
report(await awaited(new Box(2), 3));
report(await awaited(other as any, 3));
report(await awaited(counted as any, 3));
report(calls);
report("end");
