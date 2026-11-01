if (true) typeof module; else console.log("never");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared27 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("if-true", typeOfThis(), storeToUndeclaredName());
