function outer() {
  let calls = 0;
  function maybe(action, other) { if (action) action(); other && other(); return !other ? typeof action : calls; }
  function visit() { calls++; }
  function ask(both) { return both ? maybe(visit, visit) : maybe(visit); }
  return [ask(true), ask(false), calls].join();
}
console.log(outer());
