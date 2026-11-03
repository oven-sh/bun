var foo = function () {
  return "foo";
};
if (typeof define === "function" && define.amd) {
  define(function () {
    return { foo: foo };
  });
} else if (typeof exports === "object") {
  exports.foo = foo;
}
