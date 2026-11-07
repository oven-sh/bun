if (typeof require === "undefined") { for (var never in {}) {} }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared73 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-in-a-loop-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
