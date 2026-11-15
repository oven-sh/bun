function f(a, n) {
  let hits = 0, g = 0;
  let i = 0;
  while (i < n) {
    let j = 0;
    while (j !== a.length) {
      let k = a.length - 1;
      for (; k >= 1; k--) {
        hits++;
      }
      if (++g > 8) break;
      j++;
    }
    i++;
  }
  for (let m = 3; m > 0; --m) { try { if (a[m] === 1) throw m; } catch (e) { hits += 2; break; } }
  return hits + g;
}
const out = [];
function go(a, n) { out.push(f(a, n)); }
for (let round = 0; round < 3; round++) {
  go(new Float64Array(5), 2);
  go([1, 2, 3], 2);
  go(new Int8Array(2), 3);
}
console.log(out.join(" "));
