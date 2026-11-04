function outer(text) {
  eval(text);
  return f();
  function f() { return 1; }
}
console.log(outer(""), outer("f = function () { return 2 }"), outer("var f = () => 3"));
