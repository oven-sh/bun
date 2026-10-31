`${typeof module}`;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared62 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("template", typeOfThis(), storeToUndeclaredName());
