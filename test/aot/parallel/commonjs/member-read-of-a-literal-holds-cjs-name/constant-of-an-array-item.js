const list = [[]][0];
if (list) {} else module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared150 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("constant-of-an-array-item", typeOfThis(), storeToUndeclaredName());
