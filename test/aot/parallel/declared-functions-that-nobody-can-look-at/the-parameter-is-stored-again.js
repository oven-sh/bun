function outer() {
  let kept;
  function swap(action) { const before = action; action = 1; kept = kept || before; return kept === before; }
  function visit() {}
  function ask() { return swap(visit); }
  return [ask(), ask()].join();
}
console.log(outer());
