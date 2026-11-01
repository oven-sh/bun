typeof module;
typeof exports;
typeof require;
this;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared43 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("several-statements", typeOfThis(), storeToUndeclaredName());
