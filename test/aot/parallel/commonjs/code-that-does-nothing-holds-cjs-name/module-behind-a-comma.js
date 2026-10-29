(0, module);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared85 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-behind-a-comma", typeOfThis(), storeToUndeclaredName());
