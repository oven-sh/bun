// `L[j2 & 3]` reads outside a typed array of three. The outer loop is copied for a counter of 32 bits, and behind `i > 2147483649` that copy never runs; the arm for a read outside the array,
// which the copy that does run shares with it, was taken for code that nothing comes to and cut: the program ended in a trap.
console.log(String({ n: 5, m: [5] }.n));
function f4(L, o) {
  let t = 0, z = 0, y = 0, v = 0;
  for (let i = o.n; i > 2147483649; ) {
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
  const L = new Float64Array(3), o = { n: 2147483650, m: [1] }; console.log(String(f4(L, o)));
}
