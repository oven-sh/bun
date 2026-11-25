function outer() {
  const out = [];
  let calls = 0;
  function later(action) { out.push(() => action()); return out.length; }
  function visit() { return ++calls; }
  function ask() { return later(visit); }
  ask(); ask();
  return out.map(f => f()).join();
}
console.log(outer());
