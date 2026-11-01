typeof module + "";
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared111 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("joined-with-an-empty-string", typeOfThis(), storeToUndeclaredName());
