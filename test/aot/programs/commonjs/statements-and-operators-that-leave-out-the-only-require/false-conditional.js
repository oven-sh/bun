false ? require("node:path") : 0;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared63 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false-conditional", typeOfThis(), storeToUndeclaredName());
