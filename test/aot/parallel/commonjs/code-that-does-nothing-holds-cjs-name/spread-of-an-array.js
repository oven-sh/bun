[...[module]];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared119 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("spread-of-an-array", typeOfThis(), storeToUndeclaredName());
