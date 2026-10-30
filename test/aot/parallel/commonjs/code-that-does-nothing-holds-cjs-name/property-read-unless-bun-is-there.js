typeof Bun !== "undefined" || !require.resolve;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared56 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-read-unless-bun-is-there", typeOfThis(), storeToUndeclaredName());
