({ a: typeof module }).a == "object";
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
console.log("property-compared", typeOfThis(), storeToUndeclaredName());
