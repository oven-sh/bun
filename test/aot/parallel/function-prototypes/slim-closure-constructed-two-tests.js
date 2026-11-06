// A function that calls itself is made, called, constructed and called again in one function. Constructing it gives its closure room for properties. It stays the closure of the same function: every call goes where plain Bun's goes, and a validating build has nothing to find.
// Flags: --aot-validate
function one() { function sum(n) { return n <= 0 ? 0 : n + sum(n - 1); } new sum(0); return sum(4); }
function calledFirst() { function sum(n) { return n <= 0 ? 0 : n + sum(n - 1); } const first = sum(1); new sum(0); return first + ":" + sum(4); }
function oneOfTwo(flag) {
  function a(n) { return n <= 0 ? 0 : n + a(n - 1); }
  function b(n) { return n <= 0 ? 100 : n + b(n - 1); }
  const f = flag ? a : b;
  const first = f(1);
  new f(0);
  return first + ":" + f(4);
}
function oneOfThree(which) {
  function a(n) { return n <= 0 ? 0 : n + a(n - 1); }
  function b(n) { return n <= 0 ? 100 : n + b(n - 1); }
  function c() { return 1000; }
  const f = [a, b, c][which];
  const first = f(1);
  Reflect.construct(f, [0]);
  return [first, f(4), f === a, f === b, f === c, f.name, f.length, new f(0) instanceof f].join();
}
function inALoop(flag) {
  function a(n) { return n <= 0 ? 0 : n + a(n - 1); }
  function b(n) { return n <= 0 ? 100 : n + b(n - 1); }
  const f = flag ? a : b;
  let sum = 0;
  for (let i = 0; i < 4; i++) { sum += f(i); if (i === 1) new f(0); }
  return sum;
}
let last;
for (let round = 0; round < 300; round++) last = [one(), calledFirst(), oneOfTwo(true), oneOfTwo(false), oneOfThree(0), oneOfThree(1), oneOfThree(2), inALoop(true), inALoop(false)].join(" ");
console.log(last);
