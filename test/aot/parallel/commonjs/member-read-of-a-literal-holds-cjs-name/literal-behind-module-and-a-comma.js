(module, [0])[0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared89 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("literal-behind-module-and-a-comma", typeOfThis(), storeToUndeclaredName());
