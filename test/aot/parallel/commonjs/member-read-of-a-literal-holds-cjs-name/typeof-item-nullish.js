var kept = [typeof missing][0] ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared65 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-item-nullish", typeOfThis(), storeToUndeclaredName());
