function outer() {
  let last;
  function peek(action) { const was = last; last = arguments[0]; return was === last; }
  function visit() {}
  function ask() { return peek(visit); }
  return [ask(), ask()].join();
}
console.log(outer());
