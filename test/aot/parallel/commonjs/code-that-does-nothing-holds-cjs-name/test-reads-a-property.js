if (globalThis.neverStored) { typeof module; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared52 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("test-reads-a-property", typeOfThis(), storeToUndeclaredName());
