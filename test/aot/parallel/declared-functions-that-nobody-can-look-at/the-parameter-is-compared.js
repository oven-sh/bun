function outer() {
  let last;
  function same(action) { const was = last; last = action; return was === action; }
  function visit() {}
  function ask() { return same(visit); }
  return [ask(), ask(), same(visit)].join();
}
console.log(outer());
