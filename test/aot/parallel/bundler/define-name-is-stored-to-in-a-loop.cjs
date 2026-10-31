// Stores through a defined name whose `--define` value is one name, made in the body of a loop, in its update, and in a `try` that throws behind the store, are stores to the `let` of that name: the code behind the loop, each closure of a turn and the `catch` read what was stored.
// Flags: --define TOTAL=total --define TURN=turn --define TRIED=tried
function sum(steps) {
  let total = 0;
  for (const step of steps) TOTAL += step;
  return total;
}
console.log(sum([1, 2, 3]));
function turns() {
  const made = [];
  for (let turn = 0; turn < 3; TURN++) made.push(() => turn);
  return made.map(read => read()).join();
}
console.log(turns());
function attempt() {
  let tried = "not yet";
  try {
    TRIED = "stored";
    throw new Error("behind the store");
  } catch {
    return tried;
  }
}
console.log(attempt());
