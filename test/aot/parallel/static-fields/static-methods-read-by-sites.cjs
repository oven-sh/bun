// Methods are read by sites, and names of fields are asked for alone.
class L { static m() { return 1; } static n() { return L.own; } static own = 2; }
globalThis.holder = [L];
const M = globalThis.holder[0];
const method = X => X.m;
const has = (X, key) => key in X;
for (let i = 0; i < 5; i++) {
  const read = M.m;
  console.log(i, typeof read, method(M) === read, "later" in M, "own" in M, "never" in M, has(M, "own"), has(M, "later"), "own" in L, "later" in L, L.own, L.later, L.n(), M.n());
  if (i === 1) L.later = i;
  if (i === 3) delete L.own;
}
console.log(Object.keys(L).join());
class P { static m() { return 1; } static own = 2; }
class Q extends P { static below = 3; static q() { return super.own; } }
globalThis.holder = [P, Q];
const R = globalThis.holder[1];
for (let i = 0; i < 5; i++) {
  console.log(i, typeof R.m, typeof R.q, "own" in R, "below" in R, "later" in R, Object.hasOwn(R, "own"), P.own, Q.own, Q.below, P.later, R.q());
  if (i === 1) P.later = i;
  if (i === 2) Q.below = "changed";
  if (i === 3) R.own = "below";
}
console.log(Object.keys(P).join(), Object.keys(R).join(), P.own, Q.own);
