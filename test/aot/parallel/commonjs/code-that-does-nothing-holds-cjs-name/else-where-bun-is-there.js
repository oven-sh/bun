if (typeof Bun === "undefined") {} else { typeof module; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared35 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else-where-bun-is-there", typeOfThis(), storeToUndeclaredName());
