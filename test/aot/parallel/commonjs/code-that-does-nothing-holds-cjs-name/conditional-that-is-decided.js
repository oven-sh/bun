1 ? typeof module : console.log("never");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared16 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("conditional-that-is-decided", typeOfThis(), storeToUndeclaredName());
