[module, "é" + "a"];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared155 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("joined-text-outside-ascii-beside-module", typeOfThis(), storeToUndeclaredName());
