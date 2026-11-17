function outer(code) {
  function inner() { return 1; }
  const reader = () => inner();
  eval(code);
  return String(inner()) + " " + reader();
}
console.log(outer("function inner() { return 'two'; }"), outer("var inner = () => 3"), outer(""));
