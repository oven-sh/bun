// A generator that yields from two loops, taken in part by another loop
function* pairs(n) {
  for (let a = 0; a < n; a++) {
    yield "row" + a;
    for (let b = a; b < n; b++) {
      const skip = yield [a, b];
      if (skip) b += skip;
    }
  }
}
function take(n, limit, skip) {
  const out = [];
  const iterator = pairs(n);
  for (let step = iterator.next(); !step.done && out.length < limit; step = iterator.next(out.length % 3 === 0 ? skip : 0)) out.push(step.value);
  for (const value of iterator) out.push("rest " + value);
  return out.join(" ");
}
console.log(take(3, 5, 0));
console.log(take(4, 99, 1));
console.log(take(0, 1, 1), take(2, 0, 2));
