label: typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared58 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("labeled", typeOfThis(), storeToUndeclaredName());
