module, Object();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared96 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-beside-a-call", typeOfThis(), storeToUndeclaredName());
