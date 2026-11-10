function outer() {
  const names = [];
  function run(action) { names.push(action.name, action.length); return action.call(null, 1) + action.apply(null, [2]); }
  function visit(x) { return x * 2; }
  function ask() { return run(visit); }
  return ask() + ask() + names.join();
}
console.log(outer());
