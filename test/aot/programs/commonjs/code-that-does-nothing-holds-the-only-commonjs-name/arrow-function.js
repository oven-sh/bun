(() => require("node:path"));
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared22 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("arrow-function", typeOfThis(), storeToUndeclaredName());
