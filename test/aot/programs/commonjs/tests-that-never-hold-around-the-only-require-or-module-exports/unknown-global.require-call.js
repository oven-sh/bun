if (typeof neverDefinedAnywhere !== "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared33 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("unknown-global require-call", typeOfThis(), storeToUndeclaredName());
