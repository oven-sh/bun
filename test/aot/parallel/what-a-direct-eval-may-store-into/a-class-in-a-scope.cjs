function outer(code) {
  class Inner { m() { return 1; } }
  function reader() { return typeof Inner; }
  eval(code);
  return typeof Inner + " " + reader();
}
console.log(outer("Inner = 5"), outer(""));
