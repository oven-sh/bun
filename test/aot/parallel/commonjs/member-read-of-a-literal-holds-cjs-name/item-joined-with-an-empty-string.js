"" + [typeof module][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared88 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-joined-with-an-empty-string", typeOfThis(), storeToUndeclaredName());
