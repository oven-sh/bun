[module, "a" + 0x10n];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared161 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bigint-with-a-radix-joined-to-a-text-beside-module", typeOfThis(), storeToUndeclaredName());
