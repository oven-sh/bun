// horner() is copied into the loop of bisect(). Its reads stand in a loop of its own, which not every turn of bisect's loop need reach: the question for a list is one of some turns. In the copy without it the first read is told apart by kind of storage inside a stretch that ends behind the read: what meets there is wider than a number, so a hole is not read as NaN.
// STATISTIC: LoopsBuiltOnceMoreWithoutGuessesOfSomeTurns >= 1
const methods = {
  horner(c, x) { let s = 0; for (let i = 3; i >= 0; i--) s = s * x + c[i]; return s; },
  bisect(c, lo, hi) { for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (methods.horner(c, mid) > 50) hi = mid; else lo = mid; } return lo; },
};
function run(d) { let s = 0; for (const c of d) s += methods.bisect(c, 0, 3); return s; }
globalThis.kept = run;
console.log(run([[1.5, 2.5, 3.5, 4.5]]), run([[1.5, , 3.5, 4.5]]), run([[1, 2, , 4]]), run([["1", 2, 3, 4]]), run([new Uint8Array([1, 2, 3, 4])]));
