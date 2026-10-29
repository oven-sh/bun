if (typeof require === "function") {} else { console.log("never"); }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared29 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else-never-runs", typeOfThis(), storeToUndeclaredName());
