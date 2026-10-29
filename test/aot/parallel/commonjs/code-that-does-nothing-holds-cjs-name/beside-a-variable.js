var declared;
declared === typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared18 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("beside-a-variable", typeOfThis(), storeToUndeclaredName());
