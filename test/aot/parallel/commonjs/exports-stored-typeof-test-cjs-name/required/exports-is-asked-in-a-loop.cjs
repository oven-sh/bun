var foo = function () {
  return "foo";
};
while (typeof exports === "object") {
  exports.foo = foo;
  break;
}
