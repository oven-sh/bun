// A loop that suspends between the steps of a generator: once the generator has taken its first step and stored to its parameter, nothing holds the argument.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
let last;
function make(n) {
  const value = { n };
  last = new WeakRef(value);
  return value;
}
function plain(n) {
  return { n };
}
function* storesTo(p, n) {
  p = plain(n);
  yield 1;
  yield 2;
  yield 3;
}
async function ask() {
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
  }
  return last.deref() !== undefined ? "kept" : "collected";
}
function* delegates() {
  yield* storesTo(make(1), 2);
}
function* walks() {
  for (const value of storesTo(make(2), 2)) yield value;
}
async function waits() {
  const seen = [];
  for (const value of storesTo(make(3), 2)) seen.push(value, await ask());
  return seen.join();
}
for (const outer of [delegates, walks]) {
  const seen = [];
  const iterator = outer();
  for (let step = iterator.next(); !step.done; step = iterator.next()) seen.push(step.value, await ask());
  console.log(outer.name, seen.join());
}
console.log("waits", await waits());
