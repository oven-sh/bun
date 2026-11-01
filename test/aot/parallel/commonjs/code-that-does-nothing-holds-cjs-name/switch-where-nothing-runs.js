if (typeof require === "undefined") { switch (1) {} }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared76 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
