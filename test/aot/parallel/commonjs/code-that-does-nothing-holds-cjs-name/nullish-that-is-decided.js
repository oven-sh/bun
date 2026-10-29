typeof module, 1 ?? console.log("never");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared42 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("nullish-that-is-decided", typeOfThis(), storeToUndeclaredName());
