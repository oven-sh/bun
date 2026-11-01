if (typeof [/a/][0] === "string") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared61 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-an-item-that-is-a-pattern", typeOfThis(), storeToUndeclaredName());
