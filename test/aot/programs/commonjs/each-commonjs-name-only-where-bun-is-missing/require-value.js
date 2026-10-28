if (typeof Bun === "undefined") {
  console.log([require].length);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared39 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("require-value", typeOfThis(), storeToUndeclaredName());
