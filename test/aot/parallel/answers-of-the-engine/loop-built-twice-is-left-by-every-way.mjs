// A loop with guesses at values that it does not change is built twice: typed behind the tests, closed where one fails. Each loop here runs in both copies and is left by break, continue, return, throw, a label, finally and switch. What it defines is read behind it, behind two loops, on two ways, and by a hint alone. Loops stand three deep, side by side with a counter that goes on, and around a suspension.
// The guard at the entry proves the parameters of many of these functions in the whole body. Without it each loop has its own tests.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
// Under: --aot-testing=CheckEffectsAtRunTime: a birth that the sweep moves down to where a copy in line leaves for the call is no deed
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Box { x; constructor(x) { this.x = x; } }
let calls = 0;
const other = { y: 0, x: 2 };
const counted = { get x() { calls++; return 2; } };
function tell(f) { try { report(f()); } catch (thrown) { report(thrown.name); } }
function each(f) { tell(() => f(new Box(2))); tell(() => f(other)); tell(() => f(counted)); report(calls); tell(() => f(null)); tell(() => f(7)); tell(() => f({ x: "2" })); }
function withBreak(o, n) { let s = 0; let i = 0; for (;i < n; i++) { s += o.x; if (s > 6) break; } return s * 100 + i; }
function withContinue(o, n) { let s = 0; for (let i = 0;i < n; i++) { if (i & 1) continue; s += o.x; } return s; }
function withReturn(o, n) { for (let i = 0;i < n; i++) { if (o.x * i > 6) return i; } return -1; }
function caught(o, n) { let s = 0; try { for (let i = 0;i < n; i++) { s += o.x; if (i === 2) throw new Error("stop"); } } catch (thrown) { s += 1000; } return s; }
function caughtInside(o, n) { let s = 0; for (let i = 0;i < n; i++) { try { if (i === 2) throw new Error("stop"); s += o.x; } catch (thrown) { s += 1000 + o.x; } } return s; }
function thrownOut(o, n) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; if (s > 7) throw new RangeError("far"); } return s; }
function labeled(o, n) { let s = 0; outer: for (let i = 0;i < n; i++) { for (let j = 0;j < n; j++) { s += o.x; if (j === 1 && i === 1) continue outer; if (s > 40) break outer; } s += 100; } return s; }
function twoExits(o, n) { let i = 0; let found = "none"; while (true) { if (i >= n) { found = "end"; break; } if (o.x === i) { found = "hit"; break; } i++; } return found + i; }
function lastValue(o, n) { let last; let i = 0; do { last = o.x + i; i++; } while (i < n); return last * 10 + i; }
function readBehindTwoWays(o, n) { let i = 0; let seen = 0; for (;i < n; i++) { seen = o.x * i; if (seen > 5) break; } if (n & 1) i += 100; return seen * 1000 + i; }
function withFinally(o, n) { let s = 0; for (let i = 0;i < n; i++) { try { s += o.x; if (i === 1) continue; if (i === 3) break; } finally { s += 10; } } return s; }
function withSwitch(o, n) { let s = 0; for (let i = 0;i < n; i++) { switch (i & 3) { case 0: s += o.x; break; case 1: continue; case 2: s += o.x * 2; default: s += 1; } } return s; }
function threeDeep(o, p, q, n) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; for (let j = 0;j < n; j++) { s += p.x * j; for (let k = 0;k < n; k++) s += q.x * k + o.x; } } return s; }
function madeInLoopAround(rows, n) { let s = 0; for (let i = 0;i < rows.length; i++) { const row = rows[i]; for (let j = 0;j < n; j++) s += row.x * j; } return s; }
function noTurn(o) { let s = 7; for (let i = 0;i < 0; i++) s += o.x; return s; }
function assigned(o, next, n) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; o = next; } return s; }
function changed(o, n, f) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; f(o); } return s; }
function twoLoops(o, n) { let s = 0; for (let i = 0;i < n; i++) s += o.x; for (let i = 0;i < n; i++) s += o.x * 2; return s; }
function readBehindBothLoops(rows, o, n) { let last; let i = 0; do { const row = rows[i]; let j = 0; do { last = row.x * j + o.x; j++; } while (j < n); i++; } while (i < rows.length); return last; }
function countersGoOn(lists) { let s = 0; for (let r = 0;r < lists.length; r++) { const a = lists[r]; let j = 0; for (;j < 4; j++) s += a[j]; for (;j < 8; j++) s += a[j] * 2; s = s * 3 + j; } return s; }
function boundGoesOn(lists, n) { let s = 0; for (let r = 0;r < lists.length; r++) { const a = lists[r]; let j = 0; let m = n + r; for (;j < m; j++) { if (a[j] > 6) break; s += a[j]; } if (j < m) s += 1000; s = s * 3 + j + m; } return s; }
function releasedOnTheWayOut(o, n) { let text = "a"; let i = 0; while (text !== null) { if (i >= n) break; if (o.x === i) { text = null; break; } text = text + "b"; i++; } return String(text) + i; }
function* generated(o, n) { for (let i = 0;i < n; i++) yield o.x + i; }
function drained(o, n) { let s = 0; for (const value of generated(o, n)) s += value; return s; }
async function countersGoOnBesideAwait(a, rounds) { let s = 0; let last; for (let r = 0;r < rounds; r++) { let j = 0; for (;j < 4; j++) s += a[j]; for (;j < 8; j++) s += a[j] * 2; s = s * 3 + j; last = j; await null; } return s + "," + last; }
async function awaited(o, n) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; await null; } return s; }
each((o) => withBreak(o, 9));
each((o) => withBreak(o, 0));
each((o) => withContinue(o, 5));
each((o) => withReturn(o, 9));
each((o) => withReturn(o, 2));
each((o) => caught(o, 5));
each((o) => caughtInside(o, 5));
each((o) => thrownOut(o, 9));
each((o) => labeled(o, 4));
each((o) => twoExits(o, 9));
each((o) => twoExits(o, 1));
each((o) => lastValue(o, 3));
each((o) => readBehindTwoWays(o, 9));
each((o) => readBehindTwoWays(o, 2));
each((o) => withFinally(o, 6));
each((o) => withSwitch(o, 9));
each((o) => threeDeep(o, new Box(3), new Box(4), 3));
each((o) => threeDeep(new Box(3), o, new Box(4), 3));
each((o) => threeDeep(new Box(3), new Box(4), o, 3));
each((o) => threeDeep(o, o, o, 2));
each((o) => madeInLoopAround([new Box(1), o, new Box(3)], 3));
each((o) => noTurn(o));
each((o) => assigned(o, new Box(5), 3));
each((o) => assigned(new Box(5), o, 3));
each((o) => changed(o, 3, (p) => { p.x = p.x + 1; }));
each((o) => twoLoops(o, 3));
each((o) => drained(o, 3));
each((o) => readBehindBothLoops([new Box(1), o, new Box(3)], new Box(4), 3));
each((o) => readBehindBothLoops([new Box(1), new Box(3), o], o, 2));
tell(() => countersGoOn([[1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1]]));
tell(() => countersGoOn([[1, 2, 3, 4, 5, 6, 7, 8], { 0: 1, 1: 2, 5: 3 }, [1.5, 2, 3, 4, 5, 6, 7, 8]]));
tell(() => countersGoOn([[1, 2, 3, 4, 5, 6, 7, 8], null]));
tell(() => boundGoesOn([[1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1], [1, 1, 1]], 2));
tell(() => boundGoesOn([[1, 2, 3, 4, 5, 6, 7, 8], "123456789", [1, 1, 1, 1, 1, 1]], 4));
each((o) => releasedOnTheWayOut(o, 5));
each((o) => releasedOnTheWayOut(o, 1));
report(await countersGoOnBesideAwait([1, 2, 3, 4, 5, 6, 7, 8], 3));
report(await countersGoOnBesideAwait({ 0: 1, 1: 2, 5: 3 }, 2));
report(await awaited(new Box(2), 3));
report(await awaited(other, 3));
report(await awaited(counted, 3));
report(calls);
report("end");
