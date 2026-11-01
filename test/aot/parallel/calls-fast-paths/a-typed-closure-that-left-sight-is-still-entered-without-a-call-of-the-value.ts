// Two function objects of one typed arrow function have been handed to text that is made at run time, where either may get a name. The function makes no tail call, so a caller may keep
// the function object in its own frame and enter the function directly, or copy it in. The tests at its entrance hand over to its body: that was taken for a tail call of the program's,
// and every call went by the value: 35 instructions for 1.
// Alone: what the compiler knows of a function goes by all that the executable holds
// COUNT: arrivals <= 40
// COUNT: operations <= 40
// COUNT: branches <= 25000
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never) as <F>(f: F) => F;
let rare = 0;
function makeAdder(k: number): (a: number) => number {
  return (a: number): number => {
    if (rare > 1000000) rare = (rare * 3 + a) | 0;
    return (a + k) | 0;
  };
}
const one = handedBack(makeAdder(1)), two = handedBack(makeAdder(2));
function fourTimes(f: (a: number) => number, r: number): number {
  r = f(r);
  r = f(r);
  r = f(r);
  r = f(r);
  return r;
}
function run(n: number): number {
  let x = 0;
  for (let i = 0; i < n; ++i) x = fourTimes((i & 1) === 0 ? one : two, x);
  return x;
}
console.log(run(2000));
