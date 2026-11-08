function outer() {
  function run(action) { return action(); }
  function visit() { return 1; }
  function ask() { return run(visit); }
  function give() { return visit; }
  return [ask(), give() === give(), give() === visit].join();
}
console.log(outer());
