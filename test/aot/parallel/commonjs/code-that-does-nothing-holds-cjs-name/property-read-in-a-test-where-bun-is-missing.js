if (typeof Bun === "undefined" && void module.id) console.log("never");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared57 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-read-in-a-test-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
