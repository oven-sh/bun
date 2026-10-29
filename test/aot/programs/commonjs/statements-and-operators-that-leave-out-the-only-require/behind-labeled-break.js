a: {
  break a;
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared75 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-labeled-break", typeOfThis(), storeToUndeclaredName());
