function never() {
  if ({ b: 0 }.b) module.exports = 1;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared54 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-a-function", typeOfThis(), storeToUndeclaredName());
