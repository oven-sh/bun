if ({ b: typeof missing }.b) {} else module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared9 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-that-is-typeof", typeOfThis(), storeToUndeclaredName());
