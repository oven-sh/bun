if (true) {
} else require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared66 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else-of-true", typeOfThis(), storeToUndeclaredName());
