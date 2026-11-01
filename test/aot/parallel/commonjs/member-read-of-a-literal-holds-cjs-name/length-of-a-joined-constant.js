const joined = "ab" + "cd";
if (joined.length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared124 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-a-joined-constant", typeOfThis(), storeToUndeclaredName());
