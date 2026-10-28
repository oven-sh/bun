if (typeof process === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared9 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-process require-call", typeOfThis(), storeToUndeclaredName());
