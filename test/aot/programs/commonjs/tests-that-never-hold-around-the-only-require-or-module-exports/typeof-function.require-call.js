if (typeof function () {} === "string") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared30 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-function require-call", typeOfThis(), storeToUndeclaredName());
