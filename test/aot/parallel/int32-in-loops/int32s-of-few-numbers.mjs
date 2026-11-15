// Flags: --aot-check=verify-each-stage
// The callers pass few numbers, one of them no int32. What the loop makes of it where it is one is typed by its range.
const table = [5, 4, 3];
function negated(a) {
  let last = a, product = -1, i = 0;
  while (i < a && i < 6) {
    let k = 2;
    do { last = table[i]; } while (--k > 0);
    product = -(a * 2);
    i++;
  }
  return [last, product];
}
for (const result of [negated(2147483648), negated(1), negated(NaN)]) console.log(result.join());
function summed(a, b) {
  let last = 0, sum = 0;
  for (let i = 0; i < a && i < 5; i++) {
    for (const x of table) last += x;
    sum = -(a * 3) + b;
  }
  return sum + last;
}
console.log(summed(7, 1), summed(1e10, 2), summed(NaN, 3), summed(0.5, 4));
