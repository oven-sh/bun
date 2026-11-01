if ("ab".length === 3) exports.a = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared57 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("exports-behind-the-member", typeOfThis(), storeToUndeclaredName());
