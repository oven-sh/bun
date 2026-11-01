// The callee puts the callback it is given into a callback of its own. Where that one stays with the callee, nobody keeps either. Where it leaves, by whatever way, both have to live on.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "") as <T>(list: T[], i: number) => T;
type P = (v: number) => boolean;
const kept: P[] = [];
const box: { f: P | null } = { f: null };
function trample(n: number): number { const a = [n, n + 1, n + 2, n + 3]; return n > 0 ? trample(n - 1) + a[n & 3] : a[0]; }
function count(xs: number[], f: P): number { let n = 0; for (const x of xs) if (f(x)) n++; return n; }
function keep(xs: number[], f: P): number { kept.push(f); return count(xs, f); }

function wrapperStays(xs: number[], f: P): number { return count(xs, f) + count(xs, v => v > 6 || f(v)); }
function wrapperIsKept(xs: number[], f: P): number { const g: P = v => v > 6 || f(v); kept.push(g); return count(xs, g); }
function wrapperIsKeptOnOnePath(xs: number[], f: P, i: number): number { const g: P = v => v > 5 || f(v); if (i & 1) kept.push(g); return count(xs, g); }
function wrapperIsReturned(f: P): P { return v => !f(v); }
function wrapperGoesToACalleeThatKeeps(xs: number[], f: P): number { return keep(xs, v => v > 4 || f(v)); }
function wrapperGoesToSomebody(xs: number[], f: P, i: number): number { return pick([count, keep], i & 1)(xs, v => v > 3 || f(v)); }
function wrapperGivesItBack(f: P): number { const g = () => f; kept.push(g()); return 1; }
function wrapperStoresIt(f: P): number { const g = () => { box.f = f; }; g(); return 1; }
function wrapperOfAWrapper(xs: number[], f: P): number { return wrapperStays(xs, v => v === 2 || f(v)); }
function wrapperOfAWrapperThatIsKept(xs: number[], f: P): number { return wrapperIsKept(xs, v => v === 2 || f(v)); }
function allTheWayDown(n: number, f: P): boolean { return n ? allTheWayDown(n - 1, v => f(v + 1)) : f(0); }
function allTheWayDownAndKept(n: number, f: P): boolean { if (!n) { kept.push(f); return f(0); } return allTheWayDownAndKept(n - 1, v => f(v + 1)); }
function inALoop(xs: number[], f: P): number { let n = 0; for (let j = 0; j < 3; j++) n += count(xs, v => v === j || f(v)); return n; }
function inALoopAndOneIsKept(xs: number[], f: P, i: number): number { let n = 0; for (let j = 0; j < 3; j++) { const g: P = v => v === j || f(v); if (j === i % 3) kept.push(g); n += count(xs, g); } return n; }
async function wrapperAcrossAnAwait(xs: number[], f: P): Promise<number> { const g: P = v => v > 7 || f(v); await null; return count(xs, g); }
function* wrapperAcrossAYield(xs: number[], f: P): Generator<number> { const g: P = v => v > 7 || f(v); yield 1; yield count(xs, g); }

const xs = [1, 2, 3, 4, 5, 6, 7, 8];
let sum = 0;
const waiting: Promise<number>[] = [];
for (let i = 0; i < 300; i++) {
  const k = i & 7;
  sum += wrapperStays(xs, v => v === k) + wrapperIsKept(xs, v => v === k) + wrapperIsKeptOnOnePath(xs, v => v === k, i) + count(xs, wrapperIsReturned(v => v === k));
  sum += wrapperGoesToACalleeThatKeeps(xs, v => v === k) + wrapperGoesToSomebody(xs, v => v === k, i) + wrapperGivesItBack(v => v === k) + wrapperStoresIt(v => v === k);
  sum += wrapperOfAWrapper(xs, v => v === k) + wrapperOfAWrapperThatIsKept(xs, v => v === k) + (allTheWayDown(20, v => v === k + 20) ? 1 : 0) + (allTheWayDownAndKept(5, v => v === k + 5) ? 1 : 0);
  sum += inALoop(xs, v => v === k) + inALoopAndOneIsKept(xs, v => v === k, i);
  waiting.push(wrapperAcrossAnAwait(xs, v => v === k));
  for (const n of wrapperAcrossAYield(xs, v => v === k)) sum += n;
  trample(20);
}
if (typeof Bun !== "undefined") Bun.gc(true);
trample(60);
for (const n of await Promise.all(waiting)) sum += n;
let later = 0;
for (const f of kept) later += count(xs, f);
console.log(sum, kept.length, new Set(kept).size, later, count(xs, box.f!));
