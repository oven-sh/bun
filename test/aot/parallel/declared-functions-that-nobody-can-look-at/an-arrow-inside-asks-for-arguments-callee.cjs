function outer() {
  const seen = new Set();
  function run(action) { return action(); }
  function visit() { const inner = () => arguments.callee; seen.add(inner()); return seen.size; }
  function ask() { return run(visit); }
  return [ask(), ask()].join();
}
console.log(outer());
