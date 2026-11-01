var x = 1,
  y = {};
var v = typeof x ?? this;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared309 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("stored-typeof-or-else-this", typeOfThis(), storeToUndeclaredName());
