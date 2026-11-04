function outer(text) {
  eval(text);
  return f();
  function f() { return 1; }
}
function hidden(text) {
  const run = () => eval(text);
  run();
  return g() + inner();
  function g() { return 1; }
  function inner() { return g(); }
}
console.log(outer(""), outer("f = function () { return 2 }"), hidden(""), hidden("g = () => 5"));
