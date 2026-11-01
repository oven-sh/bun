(module, "ab").length;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared86 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-behind-module-and-a-comma", typeOfThis(), storeToUndeclaredName());
