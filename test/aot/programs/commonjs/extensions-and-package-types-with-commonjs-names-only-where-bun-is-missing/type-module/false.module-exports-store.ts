if (false) {
  module.exports = { a: 1 };
}
function typeOfThis111(this: unknown) {
  return typeof this;
}
console.log("type-module/false module-exports-store ts", typeOfThis111());
