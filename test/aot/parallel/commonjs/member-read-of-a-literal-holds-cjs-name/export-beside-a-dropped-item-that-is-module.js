export {};
[module, 0][1];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared153 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("export-beside-a-dropped-item-that-is-module", typeOfThis(), storeToUndeclaredName());
