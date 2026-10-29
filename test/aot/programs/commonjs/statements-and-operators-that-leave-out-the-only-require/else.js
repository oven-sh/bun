if (typeof Bun !== "undefined") {
} else require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared56 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else", typeOfThis(), storeToUndeclaredName());
