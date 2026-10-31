if (typeof module !== "undefined" && module) {
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared90 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-in-a-test-with-an-empty-body", typeOfThis(), storeToUndeclaredName());
