// Loops over a generator are left by break, by return and by a throw. The finally of the generator runs once each time, and once it yields, which the close passes over.
// Under: --aot-testing=CheckProofsAtRunTime: what `yield` gives where only loops step (LinkedCoroutine::sent) and what a step hands out (yielded)
const log = [];
function* count(n, yieldsInFinally) {
  try {
    for (let i = 0; i < n; i++) log.push("sent " + String(yield i));
  } finally {
    log.push("finally");
    if (yieldsInFinally) log.push("behind " + String(yield "late"));
  }
}
function broken(n, yieldsInFinally) {
  let last = -1;
  for (const value of count(n, yieldsInFinally)) {
    last = value;
    if (value === 1) break;
  }
  return last;
}
function returned(n) {
  for (const value of count(n, false)) if (value === 1) return "returned " + value;
  return "through";
}
function thrown(n) {
  try {
    for (const value of count(n, false)) if (value === 1) throw "thrown " + value;
    return "through";
  } catch (error) {
    return error;
  }
}
function deed() {
  log.length = 0;
  return [broken(3, false), broken(3, true), broken(1, true), returned(3), returned(1), thrown(3), thrown(1)].join() + " | " + log.join();
}
const first = deed();
console.log(first);
for (let i = 0; i < 300; i++) {
  if (deed() !== first) console.log("wrong at", i);
}
