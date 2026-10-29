var foo = function () {
  return "foo";
};
if (typeof module !== "undefined") {
  module.exports.foo = foo;
}
