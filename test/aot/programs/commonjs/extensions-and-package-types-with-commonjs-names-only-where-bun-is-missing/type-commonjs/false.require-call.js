if (false) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared106 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("type-commonjs/false require-call js", typeOfThis(), storeToUndeclaredName());
