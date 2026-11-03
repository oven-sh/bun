typeof require === "function";
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared9 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("compared", typeOfThis(), storeToUndeclaredName());
