typeof __dirname;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared6 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-dirname", typeOfThis(), storeToUndeclaredName());
