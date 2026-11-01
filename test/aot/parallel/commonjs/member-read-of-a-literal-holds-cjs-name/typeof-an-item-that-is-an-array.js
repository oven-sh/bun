if (typeof [[]][0] === "string") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared140 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-an-item-that-is-an-array", typeOfThis(), storeToUndeclaredName());
