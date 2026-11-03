// A generator has ten steps, one of them behind a test and one that hands over to a list. A loop walks it and adds up what it gives.
function* steps(x) {
  yield x + 0;
  if (x > 1) yield 1;
  yield x + 2;
  yield x + 3;
  yield x + 4;
  yield x + 5;
  yield x + 6;
  yield x + 7;
  yield* [8, x];
  yield x + 9;
}
let sum = 0;
for (const each of steps(2)) sum += each;
console.log(sum);
