// COUNT: operation:operationAOTNewGenerator <= 200
// A generator function that nobody has asked for its `prototype` has none, and its generators are made in a few instructions. 4,000 functions of two texts are called here for the first time, and the
// run counts the entries of the operation that makes a generator with its prototype. What is known is kept for each function text: a third text is asked all the while, which costs the two nothing.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
const first = tag => hide(function* () { const sent = yield tag + 1; yield tag + 2; return sent; });
const second = tag => hide(function* () { for (let i = 0; i < 2; i++) yield tag + i; });
const asked = hide(function* () { yield 1; });
let sum = 0, right = 0;
for (let i = 0; i < 2000; i++) {
  const g = hide(first(i)()), h = hide(second(i)());
  sum += g.next().value + g.next("sent").value + (g.next().done ? 1 : 0);
  for (const value of h) sum += value;
  if (i % 100 === 0) right += Object.getPrototypeOf(hide(asked())) === asked.prototype ? 1 : 0;
}
console.log(sum, right);
