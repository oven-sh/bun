function outer() {
  const out = [];
  function later(action) { out.push(() => action); return out.length; }
  function visit() {}
  function ask() { return later(visit); }
  ask(); ask();
  return out[0]() === out[1]();
}
console.log(outer());
