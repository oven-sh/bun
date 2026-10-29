typeof Bun !== "undefined" || ({ a: module });
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared101 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-in-an-object-unless-bun-is-there", typeOfThis(), storeToUndeclaredName());
