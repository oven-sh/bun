try { typeof module; } catch {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared69 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("try", typeOfThis(), storeToUndeclaredName());
