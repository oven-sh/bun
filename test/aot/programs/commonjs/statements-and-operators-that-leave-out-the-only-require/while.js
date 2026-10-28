while (typeof Bun === "undefined") require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared57 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("while", typeOfThis(), storeToUndeclaredName());
