const text = "ab";
const same = text;
if (same.length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared30 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-a-constant-of-a-constant", typeOfThis(), storeToUndeclaredName());
