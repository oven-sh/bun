if (typeof require === "undefined") {
  var [, { a: [nested] }] = [];
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared110 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-with-a-nested-name-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
