module ? 1 : 2;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared87 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-as-a-condition", typeOfThis(), storeToUndeclaredName());
