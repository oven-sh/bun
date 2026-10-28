if (typeof require === "undefined") { try {} finally { a: if (b) { var never; } } }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared74 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-in-a-nested-statement-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
