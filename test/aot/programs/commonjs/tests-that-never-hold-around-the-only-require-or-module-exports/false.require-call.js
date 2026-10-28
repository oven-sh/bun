if (false) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared23 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false require-call", typeOfThis(), storeToUndeclaredName());
