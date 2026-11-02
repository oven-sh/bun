typeof __filename;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared5 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-filename", typeOfThis(), storeToUndeclaredName());
