var foo = function () {
  return "foo";
};
switch (typeof exports) {
  case "object":
    exports.foo = foo;
    break;
  default:
    globalThis.foo = foo;
}
