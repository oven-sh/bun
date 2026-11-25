// The constants of `condition ? one : zero` are used elsewhere in the function too.
function after(n) {
  let one = 1, zero = 0, s = 0, t = 0;
  for (let i = 0; i < n; i++) {
    s += i > 2 ? one : zero;
    t += one * 10;
  }
  return s + " " + t + " " + one + " " + zero;
}
function inverted(n) {
  let one = 1, zero = 0, s = 0, t = 0;
  for (let i = 0; i < n; i++) {
    s += i > 2 ? zero : one;
    t += one * 10 + zero;
  }
  return s + " " + t + " " + one + " " + zero;
}
function compared(a, n) {
  let one = 1, zero = 0, s = 0, below = 0;
  for (let i = 0; i < n; i++) {
    s = (a.length | (a[i] > one ? one : zero)) + s;
    if (i < one) below++;
    if (i > zero) below += 100;
  }
  return s + " " + below + " " + one + " " + zero;
}
function nested(a, given) {
  let zero = 0, one = 1, v = 0, i = 0;
  for (;;) {
    if (i++ > 1) break;
    let j = 0;
    for (;;) {
      if (j++ > 3) break;
      given[i & 3] = Math.sqrt(zero);
      for (let k = 2.25; k >= 0; k--) {
        given[1] = v + 1;
        v = a[2];
      }
    }
    v = a.length | (a[v] > one ? one : zero);
  }
  return [zero, one, v, given].join();
}
function twice(n) {
  let one = 1, zero = 0, s = 0, t = 0;
  for (let i = 0; i < n; i++) {
    s += i & 1 ? one : zero;
    t -= i & 2 ? one : zero;
    s += one;
  }
  return s + " " + t;
}
function returned(n) {
  let one = 1, s = 0;
  for (let i = 0; i < n; i++) {
    s += i % 3 === 0 ? one : 0;
    if (s > 4) return one + 100;
  }
  return one + s;
}
console.log(after(6), after(2), after(0));
console.log(inverted(6), inverted(2));
console.log(compared([3, 0.5, 2, 1], 4), compared([], 3));
console.log(nested([], [3, 1, 2]), nested([5, 4, 1], [3, 1, 2]));
console.log(twice(7), returned(3), returned(30));
