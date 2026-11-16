// Lists changed at the front and in the middle in two loops
function weave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.unshift(a[i]);
    for (let k = 0; k < out.length && k <= i; k += 2) {
      if (i < b.length) out.splice(k, k % 4 ? 1 : 0, b[i]);
    }
    if (out.length > 8) out.length = 8;
  }
  return out.join() + " " + out.indexOf(b[0]);
}
console.log(weave([1, 2, 3], ["x", "y"]));
console.log(weave([0.5], [1, 2, 3, 4]));
console.log(weave([], []), weave([null, undefined], [NaN, -0]));
