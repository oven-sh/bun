if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis89(this: unknown) {
  return typeof this;
}
console.log("typeof-bun module-exports-store ts", typeOfThis89());
