function outer() {
  let calls = 0;
  function run(action) { return action(); }
  function visit() { return ++calls; }
  function spare() { return 100; }
  function ask() { return run(visit, spare); }
  return ask() + ask();
}
console.log(outer());
