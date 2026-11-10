function outer() {
  const seen = new Set();
  function run(action) { return action(); }
  function visit() { seen.add(arguments.callee); return seen.size; }
  function ask() { return run(visit); }
  return [ask(), ask()].join();
}
console.log(outer());
