__filename;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared71 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("filename-by-itself", typeOfThis(), storeToUndeclaredName());
