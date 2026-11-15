// Annex B makes a function that is declared in a block visible in the function around it, but not under the name `arguments`, which counts among the parameters there.
(function () {
  console.log(String(arguments), arguments.length);
  {
    console.log(typeof arguments);
    function arguments() {}
  }
  console.log(String(arguments), arguments.length);
})(1, 2);
(function (first) {
  if (first) function arguments() {}
  console.log(String(arguments), arguments[0]);
})(3);
(function (...rest) {
  { function arguments() {} }
  console.log(String(arguments), rest.length);
})(4, 5, 6);
