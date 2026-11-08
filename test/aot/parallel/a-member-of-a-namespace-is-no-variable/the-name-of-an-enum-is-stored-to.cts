// By a function that an initializer calls, and behind the enum. An enum in a function has an object for each call.
let kept: any, read: any;
// @ts-ignore
function swap() { Level = { Low: 9 }; return 1; }
function keep(it: any) { kept = it; return 3; }
enum Level { Low = swap(), Middle = Low + 1, High = keep(() => Low + Middle) }
console.log(JSON.stringify(Level), kept());

function make(seed: number) {
  function one() { return seed; }
  function hold(it: any) { read = it; return 2; }
  enum Step { Near = one(), Far = hold(() => Near) }
  // @ts-ignore
  Step = { Near: "another object" };
  return read;
}
const near = make(1), far = make(5);
console.log(near(), far());
