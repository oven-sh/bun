// Names that are read before an assignment makes them: by sites, by known reads, by heirs, as keys.
class C { static m() { return 1; } }
class D extends C { static n() { return super.m(); } }
globalThis.holder = [C, D];
const K = globalThis.holder[0], E = globalThis.holder[1];
function bySite(X) { return String(X.late) + String(X.other) + String(X.m()); }
function straight() { return [K.late, K.other, E.late, E.other].map(String).join(); }
function known() { return [C.late, C.other, D.late].map(String).join(); }
const key = () => "la" + "te";
for (let i = 0; i < 6; i++) {
  console.log(i, C.m(), D.n(), bySite(K), bySite(E), straight(), known(), K[key()], E[key()], "late" in K, "late" in E, Object.hasOwn(C, "late"), "other" in D);
  if (i === 1) C.late = i;
  if (i === 3) C.other = i;
  if (i === 4) D.late = "own";
}
console.log(Object.keys(C).join(), Object.keys(D).join());
