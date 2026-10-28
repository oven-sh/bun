Object(module);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared95 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("call-with-module", typeOfThis(), storeToUndeclaredName());
