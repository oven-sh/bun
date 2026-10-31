var foo = function () {
  return "foo";
};
if (typeof this === "object") {
  this.foo = foo;
}
