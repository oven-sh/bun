typeof Bun === "undefined" && void module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared55 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-read-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
