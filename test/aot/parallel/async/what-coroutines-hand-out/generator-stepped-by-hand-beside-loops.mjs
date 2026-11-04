// One call of a generator function goes into a loop, and another is stepped by hand, which sends values in.
// Under: --aot-testing=CheckProofsAtRunTime: what `yield` gives and what a step hands out (LinkedCoroutine::sent, yielded, objectsAreOnlyIterated)
function* echo(n) {
  let log = "";
  for (let i = 0; i < n; i++) {
    const sent = yield i;
    log += typeof sent + ":" + String(sent) + " ";
  }
  return log;
}
function looped(n) {
  let sum = 0;
  for (const value of echo(n)) sum += value;
  return sum;
}
function deed(n) {
  const generator = echo(n);
  let step = generator.next("lost");
  let turn = 0;
  while (!step.done) step = generator.next(turn++ % 2 ? { toString: () => "object" } : "text");
  return step.value;
}
console.log(looped(3));
console.log(deed(3));
for (let i = 0; i < 300; i++) {
  if (looped(4) !== 6) console.log("the loop is wrong at", i);
  if (deed(2) !== "string:text object:object ") console.log("the deed is wrong at", i);
}
console.log(looped(0), JSON.stringify(deed(0)));
