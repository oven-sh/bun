(function () { typeof module; })();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared48 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-a-function-that-is-called-at-once", typeOfThis(), storeToUndeclaredName());
