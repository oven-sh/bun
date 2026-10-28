if (typeof Bun !== "undefined" && false) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared26 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bun-and-false require-call", typeOfThis(), storeToUndeclaredName());
