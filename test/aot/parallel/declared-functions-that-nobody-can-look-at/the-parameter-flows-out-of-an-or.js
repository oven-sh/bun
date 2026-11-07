function outer() {
  function pick(action, other) { return action || other; }
  function visit() {}
  function ask() { return pick(visit, null); }
  return ask() === ask();
}
console.log(outer());
