switch (typeof Bun) {
  case "undefined":
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared59 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch", typeOfThis(), storeToUndeclaredName());
