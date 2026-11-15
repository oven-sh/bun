function outer() {
  let last;
  function peek(...all) { const was = last; last = all[0]; return was === last; }
  function visit() {}
  function ask() { return peek(visit); }
  return [ask(), ask()].join();
}
console.log(outer());
