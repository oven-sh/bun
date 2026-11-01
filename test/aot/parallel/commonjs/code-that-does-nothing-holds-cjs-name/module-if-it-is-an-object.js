typeof module === "object" && module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared89 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-if-it-is-an-object", typeOfThis(), storeToUndeclaredName());
