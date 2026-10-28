if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis109(this: unknown) {
  return typeof this;
}
console.log("type-module/typeof-bun module-exports-store ts", typeOfThis109());
