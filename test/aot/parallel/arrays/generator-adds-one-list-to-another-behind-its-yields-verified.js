// Flags: --aot-check=verify-each-stage
function* sums(n, rounds) {
  const total = Array();
  const added = Array(n);
  for (let round = 0; round < rounds; round++) yield round;
  let k = 0;
  do {
    total[k] = total[k] + added[k];
  } while (++k < n);
  yield total.length;
  yield String(total[0]);
}
for (const n of [0, 3, 33]) for (const value of sums(n, 4)) console.log(value);

function* shares(n, rounds, picksTotal) {
  const total = Array(n).fill(1);
  const added = Array(n).fill(2);
  const either = picksTotal ? total : added;
  for (let round = 0; round < rounds; round++) yield round;
  let k = 0;
  do {
    const before = total[k];
    either[k] = 0.5;
    total[k] = before + added[k];
  } while (++k < n);
  yield total.join() + " | " + added.join() + " | " + either.join();
}
for (const picksTotal of [true, false, true]) for (const value of shares(4, 2, picksTotal)) console.log(value);

function* takesItsOwnListBack(n) {
  const total = Array(n).fill(1);
  const sent = yield total;
  let k = 0;
  do {
    const before = total[k];
    sent[k] = 0.25;
    total[k] = total[k] + before;
  } while (++k < n);
  yield total.join();
}
const steps = takesItsOwnListBack(3);
console.log(steps.next(steps.next().value).value);
console.log(takesItsOwnListBack(2).next().value.join());
const others = takesItsOwnListBack(3);
others.next();
console.log(others.next([7, 7, 7]).value);
