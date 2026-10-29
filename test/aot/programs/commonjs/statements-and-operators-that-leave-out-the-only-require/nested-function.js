if (typeof Bun === "undefined") {
  (function () {
    module.exports = 1;
  })();
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared62 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("nested-function", typeOfThis(), storeToUndeclaredName());
