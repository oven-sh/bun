var foo = function () {
  return "foo";
};
if (typeof require === "function") {
  exports.foo = foo;
}
