[typeof module, , this];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared19 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("array", typeOfThis(), storeToUndeclaredName());
