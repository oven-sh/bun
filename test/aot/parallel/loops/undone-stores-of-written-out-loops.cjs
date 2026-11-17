"use strict";
// A break leaves the written out iterations of an inner loop before the key of their store is built.
function left(b, a, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 2; j++) {
      if (i === 4) break;
      b[i & 1] = a[1];
    }
    if (b[i & 3] > 2) s += a[0];
  }
  return s;
}
function keyed(b, a, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const at = (i + 1) & 3;
    for (let j = 0; j < 3; j++) {
      if (i === j + 2) break;
      b[at] = a[j] + i;
      b[(i + j) & 3] = a[1];
    }
    if (b[i & 3] > 2) s += a[0];
    else s -= b[at];
  }
  return s;
}
const numbers = () => [0.5, 1.5, -0, 3.25, 1e9, 6.5, 7, 8, 9];
const mixed = [1, "t", 3, null, 5, 6, 7, 8, 9];
const first = numbers();
console.log(left(first, first, 11), first.join());
const second = numbers();
console.log(left(second, mixed, 12), second.join());
const third = numbers();
console.log(keyed(third, numbers(), 9), third.join());
const fourth = [1, , 3, 4];
console.log(keyed(fourth, mixed, 7), fourth.join());
