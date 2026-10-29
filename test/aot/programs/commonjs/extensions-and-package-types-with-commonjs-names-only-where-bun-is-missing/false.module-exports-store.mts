if (false) {
  module.exports = { a: 1 };
}
function typeOfThis99(this: unknown) {
  return typeof this;
}
console.log("false module-exports-store mts", typeOfThis99());
