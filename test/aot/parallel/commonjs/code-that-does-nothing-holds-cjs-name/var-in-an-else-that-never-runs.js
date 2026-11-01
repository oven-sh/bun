if (typeof require === "function") {} else { var never; }
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
console.log("var-in-an-else-that-never-runs", typeOfThis(), storeToUndeclaredName());
