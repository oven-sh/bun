function outer() {
  let last;
  function peek(a, action) { const was = last; last = action; return was === action; }
  function visit() {}
  function ask() { return peek(...[1], visit); }
  return [ask(), ask()].join();
}
console.log(outer());
