[typeof module][0] + "a";
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared137 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-joined-with-a-letter", typeOfThis(), storeToUndeclaredName());
