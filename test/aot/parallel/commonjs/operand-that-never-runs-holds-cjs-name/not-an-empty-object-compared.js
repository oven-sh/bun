var x = 1,
  y = {};
if (!{} === false) {
} else {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared363 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-an-empty-object-compared", typeOfThis(), storeToUndeclaredName());
