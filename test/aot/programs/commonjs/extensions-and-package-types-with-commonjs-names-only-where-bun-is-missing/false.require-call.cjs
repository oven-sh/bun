if (false) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared82 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false require-call cjs", typeOfThis(), storeToUndeclaredName());
