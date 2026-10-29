typeof module && 0 && console.log("never");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared40 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("and-that-is-decided", typeOfThis(), storeToUndeclaredName());
