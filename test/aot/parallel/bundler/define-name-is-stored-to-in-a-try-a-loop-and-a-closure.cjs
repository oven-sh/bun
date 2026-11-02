// A store through a defined name whose `--define` value is one name is a store to the `let` of that name for the code around it: a `catch` clause, the code behind a loop, another closure and the closure of each round of a loop read what was stored.
// Flags: --define NAME=target
function inTry() {
  let target = 0;
  try {
    NAME = 1;
    throw new Error("thrown behind the store");
  } catch {
    return target;
  }
}
function inLoop() {
  let target = 0;
  for (let round = 0; round < 3; round++) {
    NAME += round + 1;
  }
  return target;
}
function inClosure() {
  let target = "the initializer";
  const store = value => {
    NAME = value;
  };
  const read = () => target;
  store("stored by the closure");
  return read();
}
function behindTheLastStore() {
  let target = "the initializer";
  NAME = "stored before the closure is made";
  const read = () => target;
  return read();
}
function byTheUpdateOfTheLoop() {
  const reads = [];
  for (let target = 0, rounds = 0; target < 3 && rounds < 5; NAME++, rounds++) {
    reads.push(() => target);
  }
  return reads.map(read => read()).join();
}
function inGenerator() {
  function* count() {
    let target = 0;
    while (true) {
      NAME++;
      yield target;
    }
  }
  const counted = count();
  return [counted.next().value, counted.next().value].join();
}
console.log(inTry(), inLoop(), inClosure(), "|", behindTheLastStore(), "|", byTheUpdateOfTheLoop(), inGenerator());
