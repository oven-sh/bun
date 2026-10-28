if (typeof Bun === "undefined") console.log(typeof module);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared45 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("value-is-printed-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
