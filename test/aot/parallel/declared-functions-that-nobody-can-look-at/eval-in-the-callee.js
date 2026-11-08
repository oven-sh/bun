function outer() {
  let last;
  function peek(action) { const now = eval("action"); const was = last; last = now; return was === now; }
  function visit() {}
  function ask() { return peek(visit); }
  return [ask(), ask()].join();
}
console.log(outer());
