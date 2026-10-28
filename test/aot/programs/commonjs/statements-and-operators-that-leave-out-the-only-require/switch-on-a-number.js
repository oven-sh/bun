switch (1) {
  case 2:
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared69 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch-on-a-number", typeOfThis(), storeToUndeclaredName());
