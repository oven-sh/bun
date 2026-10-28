for (; false; ) require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared68 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("for-false", typeOfThis(), storeToUndeclaredName());
