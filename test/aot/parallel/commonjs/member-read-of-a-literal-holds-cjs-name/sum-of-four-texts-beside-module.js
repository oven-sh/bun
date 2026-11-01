[module, "a" + "b" + "c" + "d"];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared158 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("sum-of-four-texts-beside-module", typeOfThis(), storeToUndeclaredName());
