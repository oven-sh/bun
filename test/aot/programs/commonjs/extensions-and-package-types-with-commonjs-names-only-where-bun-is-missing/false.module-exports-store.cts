if (false) {
  module.exports = { a: 1 };
}
function typeOfThis95(this: unknown) {
  return typeof this;
}
console.log("false module-exports-store cts", typeOfThis95());
