if (typeof Bun === "undefined") { typeof require === "function"; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared33 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("compared-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
