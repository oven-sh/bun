export {};
[module][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared152 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("export-beside-the-item-that-is-module", typeOfThis(), storeToUndeclaredName());
