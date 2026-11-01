function called() {}
[module, called()][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared135 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-beside-a-call-by-itself", typeOfThis(), storeToUndeclaredName());
