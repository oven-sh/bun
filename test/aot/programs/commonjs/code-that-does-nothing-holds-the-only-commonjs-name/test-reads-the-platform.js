if (process.platform === "none") { typeof module; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared54 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("test-reads-the-platform", typeOfThis(), storeToUndeclaredName());
