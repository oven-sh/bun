[module, -("a" + "b")];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared154 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("number-of-joined-texts-beside-module", typeOfThis(), storeToUndeclaredName());
