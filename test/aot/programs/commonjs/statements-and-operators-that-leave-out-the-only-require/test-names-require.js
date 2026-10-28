if (typeof require === "undefined") console.log(1);
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
console.log("test-names-require", typeOfThis(), storeToUndeclaredName());
