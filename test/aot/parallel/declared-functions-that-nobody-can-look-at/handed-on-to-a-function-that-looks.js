function outer() {
  let last;
  function looks(action) { const was = last; last = action; return was === action; }
  function first(action) { return second(action); }
  function second(action) { return looks(action); }
  function visit() {}
  function ask() { return first(visit); }
  return [ask(), ask()].join();
}
console.log(outer());
