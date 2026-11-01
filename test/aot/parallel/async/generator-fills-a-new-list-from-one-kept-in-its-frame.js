// Flags: --aot-verify-each-pass
// The list that the generator walks comes out of its frame, and the list that it fills goes into the frame later: the two are never one object, so a guard on the first outlasts the stores into the second.
function taker(numbers) {
  const steps = function* () {
    const [first, ...rest] = numbers;
    rest[5] = 1;
    yield first;
    yield rest;
  };
  return [...steps()];
}
console.log(taker([1, 2, 3]), taker([process.argv.length, 5]), taker([1.5, 2.5, 3.5, 4.5]), taker([]));
function* copies(from, n) {
  yield "start";
  const to = [];
  for (let i = 0; i < from.length; i++) to.push(from[i] * n);
  yield to;
  for (let i = 0; i < from.length; i++) to.push(from[i]);
  yield to.length;
  // One object under both names: the frame holds it twice.
  const same = from;
  yield "again";
  same.push(n);
  yield from.length;
}
console.log([...copies([1, 2, 3], 2)], [...copies([0.5], process.argv.length)]);
