// An edge comes round before the iteration has reached the read of an element that the loop carries.
function swaps(n, keys) {
  const a = new Array(n).fill(1);
  for (let k = 0; k < n; k++) a[k] = k + 1;
  for (const i of keys) {
    const x = i & 7;
    if (x >= a.length) continue;
    const spare = a[x];
    a[x] = a[0];
    a[0] = spare;
  }
  return a.join();
}
function written(n) {
  const a = new Array(n).fill(1);
  for (const i of [0, 3, 1, 7, 9]) {
    const x = i & 7;
    if (x >= a.length) continue;
    const spare = a[x];
    a[x] = a[0];
    a[0] = spare;
  }
  return a.join();
}
function sums(a, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i % 3 === 0) continue;
    s += a[1];
    a[1] = s & 255;
    a[2] = a[1] + a[2];
  }
  return s + ":" + a.join();
}
function steps(a, n) {
  let s = 0;
  for (let i = 1; i < n; i++) {
    if ((i & 3) === 2) continue;
    s += a[i - 1];
    a[i] = s * 0.5;
  }
  return s + ":" + a.join();
}
function both(a, n) {
  let i = 0;
  while (i++ < n) {
    if (i === 4 || i === 5) continue;
    if (i === 9) break;
    const t = a[0];
    a[0] = a[3];
    if (t > 2) continue;
    a[3] = t + a[0];
  }
  return a.join();
}
console.log(written(5), written(8));
console.log(swaps(5, [0, 3, 1, 7, 9]), swaps(3, [7, 2, 6, 1, 1]), swaps(8, [1, 2, 3, 4]));
console.log(sums([1, 2, 3], 12), sums([0.5, 1.5, 2.5], 10), sums([1, 2, 3], 1));
console.log(steps([1, 2, 3, 4, 5, 6, 7, 8], 8), steps([0.5, 1, 1.5, 2, 2.5], 5));
console.log(both([1, 2, 3, 4], 12), both([3, 0, 0, 1], 7));
