const never = 0;
if (never) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared25 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("const-zero require-call", typeOfThis(), storeToUndeclaredName());
