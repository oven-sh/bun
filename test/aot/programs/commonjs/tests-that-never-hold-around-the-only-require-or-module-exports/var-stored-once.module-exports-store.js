var never = 0;
if (never) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared18 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-stored-once module-exports-store", typeOfThis(), storeToUndeclaredName());
