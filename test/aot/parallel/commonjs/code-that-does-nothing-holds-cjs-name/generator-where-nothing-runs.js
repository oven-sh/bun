if (typeof require === "undefined") { function* never() {} }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared78 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("generator-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
