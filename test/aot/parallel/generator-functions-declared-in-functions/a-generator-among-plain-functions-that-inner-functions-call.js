const n = +process.argv[2] || 3;
function f() {
  function one() { return 1; }
  function* gen() { yield one(); }
  function two() { return 2; }
  const a = () => gen(), b = () => gen(), c = () => one() + two();
  return [Object.getPrototypeOf(a()) === Object.getPrototypeOf(b()), c(), [...a()].join()].join();
}
console.log(String(f()));
