function outer() {
  let last;
  function withDefault(action = null, copy = action) { const was = last; last = copy; return was === copy; }
  function withPattern({ length }) { return length; }
  function visit(a, b) {}
  function ask() { return withDefault(visit) + ":" + withPattern(visit); }
  return [ask(), ask()].join();
}
console.log(outer());
