if ({ b() {} }.b) {} else module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared96 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("method", typeOfThis(), storeToUndeclaredName());
