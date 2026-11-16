function outer() {
  const seen = new Set();
  function note(action) { seen.add(action); return seen.size; }
  function visit() {}
  function ask() { return note(visit); }
  return [ask(), ask(), note(visit)].join();
}
console.log(outer());
