[require][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared133 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-is-require", typeOfThis(), storeToUndeclaredName());
