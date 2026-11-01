if (delete [0][0]) {} else module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared138 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("deleted-item", typeOfThis(), storeToUndeclaredName());
