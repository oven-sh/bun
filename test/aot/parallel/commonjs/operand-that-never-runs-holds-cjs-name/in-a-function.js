var x = 1,
  y = {};
function never() {
  return typeof Bun ?? module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared335 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-a-function", typeOfThis(), storeToUndeclaredName());
