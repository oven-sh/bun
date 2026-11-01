if ({ __proto__: 0 }.__proto__) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared94 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-named-proto", typeOfThis(), storeToUndeclaredName());
