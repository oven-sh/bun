// The number that a[i] = x stores is compared before the iterations: checked builds take the comparison, and what rests on it is tested.
function f(a, b, n, x) { let s = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) { if (b[i] > a[i]) { a[i] = x; if (a[i] < 0) break; } s += b[i] | 0; } return s + a.join(); }
console.log(f([0.5, 1.5, -2.5, 3, 4.25, -0], [1, 2, null, 4], 6, "s"), f([1, 2, null, 4], [1, 2.5, 3, NaN, 5, 6], 4, -1), f([0.5, , 2.5, 3], [1, 2.5, 3, NaN, 5, 6], 3, "s"), f([1, 2.5, 3, NaN, 5, 6], [0.5, 1.5, -2.5, 3, 4.25, -0], 6, 2));
