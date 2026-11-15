// The same scans over arrays of doubles, strings, holes and objects, and past both ends.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "o" + v.k : String(v));
function partition(a, pivot) {
  let i = 0,
    j = a.length - 1,
    steps = 0;
  while (i <= j && steps++ < 50) {
    while (a[i] < pivot) i++;
    while (a[j] > pivot) j--;
    if (i <= j) {
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
      i++;
      j--;
    }
  }
  return i + " " + j + " " + Array.from(a, show).join();
}
function down(a, limit) {
  let j = a.length - 1,
    n = 0;
  for (let k = 0; k < 4; k++) {
    while (a[j] > limit) {
      j--;
      n++;
    }
    j -= 1;
  }
  return j + " " + n;
}
const object = k => ({ k, valueOf: () => k });
const arrays = [[3, 1, 2, 5, 4, 0], [0.5, 2.5, 1.5, -1], [1, , 3, 0], [], ["b", "a", "c"], [NaN, 1, 0], [-0, 0], [2147483647, -2147483648, 5], [object(2), object(1), object(3)], new Int8Array([3, 1, 2]), new Float64Array([0.5, -1, 2]), [3, "2", 1, null, undefined]];
for (const values of arrays) {
  for (const limit of [0, 1, 2.5, -5, "b", NaN, 2147483647]) {
    const copy = Array.isArray(values) ? values.slice() : values.slice();
    console.log(partition(copy, limit), down(values, limit));
  }
}
