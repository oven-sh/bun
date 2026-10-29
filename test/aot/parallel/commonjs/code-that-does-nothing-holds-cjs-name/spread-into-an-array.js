[...typeof module];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared63 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("spread-into-an-array", typeOfThis(), storeToUndeclaredName());
