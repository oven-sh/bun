if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis113(this: unknown) {
  return typeof this;
}
console.log("type-commonjs/typeof-bun module-exports-store ts", typeOfThis113());
