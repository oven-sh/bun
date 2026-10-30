{ typeof module; { void this; } ; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared23 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("block", typeOfThis(), storeToUndeclaredName());
