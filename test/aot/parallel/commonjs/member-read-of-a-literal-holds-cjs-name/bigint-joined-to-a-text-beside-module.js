[module, "a" + 10n];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared160 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bigint-joined-to-a-text-beside-module", typeOfThis(), storeToUndeclaredName());
