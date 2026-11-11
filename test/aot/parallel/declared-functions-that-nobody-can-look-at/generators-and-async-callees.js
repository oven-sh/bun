function outer() {
  let calls = 0;
  function* steps(action) { yield action(); yield action(); }
  async function later(action) { await null; return action(); }
  function visit() { return ++calls; }
  function ask() { return [...steps(visit)].join() + ":"; }
  return later(visit).then(v => ask() + v + ":" + calls);
}
console.log(await outer());
