// A class without heirs whose names are absent at first.
class C { static m() { return C.late === undefined ? 1 : 2; } }
globalThis.holder = [C];
const K = globalThis.holder[0];
function bySite(X) { let out = ""; for (let i = 0; i < 3; i++) out += String(X.late) + String(X.other); return out; }
for (let i = 0; i < 6; i++) {
  console.log(i, C.m(), K.m(), bySite(K), "late" in K, "late" in C, Object.hasOwn(K, "other"), K?.late, K.other ?? "none");
  if (i === 2) C.late = i;
  if (i === 4) C.other = i;
}
class L { static m() { return 1; } static own = 2; }
globalThis.holder = [L];
const M = globalThis.holder[0];
for (let i = 0; i < 5; i++) {
  console.log(i, L.m(), "later" in L, "own" in L, "never" in L, "later" in M, "own" in M, M.later, L.later, M.own);
  if (i === 1) L.later = i;
  if (i === 2) delete L.own;
  if (i === 3) M.later = "through the alias";
}
console.log(Object.keys(L).join());
