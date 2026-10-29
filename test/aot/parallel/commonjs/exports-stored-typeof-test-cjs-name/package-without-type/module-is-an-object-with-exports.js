var foo = function () {
  return "foo";
};
if (typeof module === "object" && module.exports) {
  module.exports.foo = foo;
}
