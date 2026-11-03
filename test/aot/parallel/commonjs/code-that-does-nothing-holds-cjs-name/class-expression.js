(class { static a = typeof module; });
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared66 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("class-expression", typeOfThis(), storeToUndeclaredName());
