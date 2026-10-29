var foo = function () {
  return "foo";
};
const kind = typeof exports;
if (kind === "object") {
  exports.foo = foo;
}
