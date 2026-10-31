if (typeof Bun === "undefined") {
  require;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared107 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("require-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
