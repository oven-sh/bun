if (false) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared87 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false module-exports-store mjs", typeOfThis(), storeToUndeclaredName());
