typeof (0, module);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared88 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-a-comma", typeOfThis(), storeToUndeclaredName());
