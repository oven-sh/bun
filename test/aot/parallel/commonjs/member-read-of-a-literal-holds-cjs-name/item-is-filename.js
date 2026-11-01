({ a: __filename }).a;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared134 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-is-filename", typeOfThis(), storeToUndeclaredName());
