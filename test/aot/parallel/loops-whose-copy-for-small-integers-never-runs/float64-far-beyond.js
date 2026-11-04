// One form of ../loops-values-behind-tests/a-read-outside-a-typed-array-in-a-loop-whose-copy-for-small-integers-never-runs.js: the kind of typed array and the way the counter steps.
console.log(String({ n: 5, m: [5] }.n));
function f4(L, o) {
  let t = 0, z = 0, y = 0, v = 0;
  for (let i = o.n; i > 9007199254740989; ) {
    if (++t > 9) break;
    for (let j1 = i - 1; j1 < i; j1++) { z += j1; }
    L[i & 3] = o.m[t & 1];
    const p = i--;
    for (let j2 = p; j2 < p + 2; ++j2) { v = L[j2 & 3]; z += v; }
    for (let j3 = p; j3 < p; j3++) { y += j3; }
  }
  return [z, y, v];
}
for (let round = 0; round < 2; round++) {
  const L = new Float64Array(3), o = { n: 9007199254740990, m: [1] }; console.log(String(f4(L, o)));
}
