// One callback, written once, goes to a callee that borrows it on one path and leaves on another: stored, returned, thrown, handed to a callee that keeps it. Whatever got it has one function, the same one every time it looks.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "") as <T>(list: T[], i: number) => T;
type F = (v: number) => number;
const kept: F[] = [];
const box: { f: F | null } = { f: null };
function borrows(f: F): number { return f(1) + f(2); }
function keeps(f: F): number { kept.push(f); return f(3); }
function trample(n: number): number { const a = [n, n + 1, n + 2, n + 3]; return n > 0 ? trample(n - 1) + a[n & 3] : a[0]; }

function storedOnOnePath(i: number, k: number): number { const f: F = v => v + k; if (i & 1) { box.f = f; return 0; } return borrows(f); }
function returnedOnOnePath(i: number, k: number): F | number { const f: F = v => v * k; if (i & 1) return f; return borrows(f); }
function thrownOnOnePath(i: number, k: number): number { const f: F = v => v - k; if (i & 1) throw f; return borrows(f); }
function keptOnOnePath(i: number, k: number): number { const f: F = v => v + 2 * k; return i & 1 ? keeps(f) : borrows(f); }
function borrowedThenKept(i: number, k: number): number { const f: F = v => v + 3 * k; const n = borrows(f); return i & 1 ? n + keeps(f) : n; }
function keptThenBorrowed(i: number, k: number): number { const f: F = v => v + 4 * k; const n = i & 1 ? keeps(f) : 0; return n + borrows(f) + (kept[kept.length - 1] === f ? 1000 : 0); }
function keptTwice(i: number, k: number): number { const f: F = v => v + 5 * k; if (i & 1) { keeps(f); keeps(f); return kept[kept.length - 1] === kept[kept.length - 2] ? 1 : -1; } return borrows(f); }
function unknownOnBothPaths(i: number, k: number): number { const f: F = v => v + 6 * k; return i & 2 ? pick([borrows, keeps], i & 1)(f) : pick([keeps, borrows], i & 1)(f); }
function capturesNothing(i: number): number { const f: F = v => v + 7; if (i & 1) { kept.push(f); return 0; } return borrows(f); }
function inALoop(i: number, k: number): number { let n = 0; for (let j = 0; j < 3; j++) { const f: F = v => v + j + k; n += (i + j) & 1 ? keeps(f) : borrows(f); } return n; }
function madeBeforeTheLoop(i: number, k: number): number { const f: F = v => v + 8 * k; let n = 0; for (let j = 0; j < 3; j++) n += (i + j) & 1 ? keeps(f) : borrows(f); return n + (new Set(kept.slice(-1).concat(f)).size); }
function heldByAnotherCallback(i: number, k: number): number { const f: F = v => v + 9 * k; const g: F = v => f(v) + 1; if (i & 1) return keeps(g); return borrows(f) + borrows(g); }
function heldByARecord(i: number, k: number): number { const f: F = v => v + 10 * k; const r = { f, k }; if (i & 1) { kept.push(r.f); return r.f === f ? 1 : -1; } return borrows(f) + borrows(r.f); }

const all = [heldByAnotherCallback, heldByARecord, storedOnOnePath, returnedOnOnePath, keptOnOnePath, borrowedThenKept, keptThenBorrowed, keptTwice, unknownOnBothPaths, inALoop, madeBeforeTheLoop];
let sum = 0;
for (let i = 0; i < 400; i++) {
  for (const test of all) { const r = test(i, i + 1); sum += typeof r === "function" ? r(1) : r; trample(20); }
  try { sum += thrownOnOnePath(i, i); } catch (f) { sum += (f as F)(1); }
  sum += capturesNothing(i);
}
if (typeof Bun !== "undefined") Bun.gc(true);
trample(50);
let later = 0; for (const f of kept) later += f(1);
console.log(sum, kept.length, new Set(kept).size, later, box.f!(1));
