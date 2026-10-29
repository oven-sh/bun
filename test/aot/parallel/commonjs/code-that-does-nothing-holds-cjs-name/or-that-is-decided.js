typeof module, 1 || console.log("never");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared41 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("or-that-is-decided", typeOfThis(), storeToUndeclaredName());
