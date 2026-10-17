// ECMAScript has a label in front of any statement, a `var` statement among them. TypeScript refuses it (TS1344).
outer: var x = 0, y = 0;
loop: do {
  inner: x = 2;
  break;
  never: var y = 2;
} while (0);
another: do {} while (0);
function count() {
  first: var n = 1;
  second: for (var i = 0; i < 3; i++) {
    third: var m = i;
    if (i === 1) continue second;
    n += m;
  }
  return n;
}
console.log(x, y, count());
