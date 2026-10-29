({ a: module });
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared84 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-in-an-object", typeOfThis(), storeToUndeclaredName());
