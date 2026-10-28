var never = 0;
if (never) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared17 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("var-stored-once require-call", typeOfThis(), storeToUndeclaredName());
