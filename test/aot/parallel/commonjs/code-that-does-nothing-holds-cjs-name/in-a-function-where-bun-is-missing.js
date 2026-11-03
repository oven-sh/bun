function called() { if (typeof Bun === "undefined") { void typeof module; } }
called();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared47 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-a-function-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
