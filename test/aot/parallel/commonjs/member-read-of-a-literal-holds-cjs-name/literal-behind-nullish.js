if ((null ?? "ab").length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared53 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("literal-behind-nullish", typeOfThis(), storeToUndeclaredName());
