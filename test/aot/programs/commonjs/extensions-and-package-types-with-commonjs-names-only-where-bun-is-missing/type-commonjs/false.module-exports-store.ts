if (false) {
  module.exports = { a: 1 };
}
function typeOfThis115(this: unknown) {
  return typeof this;
}
console.log("type-commonjs/false module-exports-store ts", typeOfThis115());
