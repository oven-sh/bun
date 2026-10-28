if (false) {
  module.exports = { a: 1 };
}
function typeOfThis91(this: unknown) {
  return typeof this;
}
console.log("false module-exports-store ts", typeOfThis91());
