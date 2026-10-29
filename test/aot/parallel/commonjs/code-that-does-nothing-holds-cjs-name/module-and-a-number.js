module && 1;
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
console.log("module-and-a-number", typeOfThis(), storeToUndeclaredName());
