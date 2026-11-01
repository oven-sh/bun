var x = 1,
  y = {};
if ([] != null) {
} else {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared351 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("list-compared-with-null", typeOfThis(), storeToUndeclaredName());
