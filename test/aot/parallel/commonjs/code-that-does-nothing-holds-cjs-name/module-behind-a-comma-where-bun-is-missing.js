typeof Bun === "undefined" ? (0, module) : 0;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared102 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-behind-a-comma-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
