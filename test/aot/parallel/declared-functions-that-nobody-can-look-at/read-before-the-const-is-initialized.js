function outer() {
  function run(action) { try { return action(); } catch (e) { return e.constructor.name; } }
  function visit() { return late.n; }
  function ask() { return run(visit); }
  const early = ask();
  const late = { n: 5 };
  return early + ":" + ask();
}
console.log(outer());
