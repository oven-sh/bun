while (false) require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared67 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("while-false", typeOfThis(), storeToUndeclaredName());
