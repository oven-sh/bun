if (typeof require === "undefined") { var never; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared72 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
