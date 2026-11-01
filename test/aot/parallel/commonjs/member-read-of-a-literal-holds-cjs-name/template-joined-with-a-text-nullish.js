function zero() {
  return 0;
}
var kept = (`t${zero()}` + "b") ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared163 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("template-joined-with-a-text-nullish", typeOfThis(), storeToUndeclaredName());
