if (!Bun) typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared53 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("test-reads-bun", typeOfThis(), storeToUndeclaredName());
