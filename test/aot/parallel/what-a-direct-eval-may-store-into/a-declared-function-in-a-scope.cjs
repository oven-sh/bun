function outer(code) {
  function inner() { return 1; }
  function reader() { return typeof inner; }
  eval(code);
  return typeof inner + " " + reader();
}
console.log(outer("inner = 5"), outer(""), outer("inner = 'text'"));
