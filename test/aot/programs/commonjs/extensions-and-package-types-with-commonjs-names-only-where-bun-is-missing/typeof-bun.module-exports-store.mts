if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis97(this: unknown) {
  return typeof this;
}
console.log("typeof-bun module-exports-store mts", typeOfThis97());
