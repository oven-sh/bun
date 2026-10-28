if (process.platform === "os/2") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared13 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("platform module-exports-store", typeOfThis(), storeToUndeclaredName());
