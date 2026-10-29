if (typeof require === "undefined") {
  var [] = [];
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared109 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-without-names-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
