switch (1) {
  case 1:
    break;
  default:
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared70 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch-default", typeOfThis(), storeToUndeclaredName());
