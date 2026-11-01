const joined = "ab" + "cd";
if (joined === "x") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared125 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("joined-constant", typeOfThis(), storeToUndeclaredName());
