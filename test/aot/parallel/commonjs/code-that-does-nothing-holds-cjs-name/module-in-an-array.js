[module];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared83 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-in-an-array", typeOfThis(), storeToUndeclaredName());
