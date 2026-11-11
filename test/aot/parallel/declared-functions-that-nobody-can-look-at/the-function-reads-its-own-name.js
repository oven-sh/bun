function outer(depth) {
  let calls = 0;
  function run(action, k) { return action(k); }
  function visit(k) { calls++; return k ? run(visit, k - 1) : calls; }
  function ask() { return run(visit, depth); }
  return ask() + ":" + ask();
}
console.log(outer(3));
