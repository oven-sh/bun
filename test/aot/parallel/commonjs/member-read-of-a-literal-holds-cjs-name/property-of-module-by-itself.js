[0, module.id][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared136 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-of-module-by-itself", typeOfThis(), storeToUndeclaredName());
