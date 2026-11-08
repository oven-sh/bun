function outer() {
  function pass(action) { return action; }
  function visit() { return 1; }
  function ask() { return pass(visit); }
  return ask() === ask() && ask() === pass(visit);
}
console.log(outer());
