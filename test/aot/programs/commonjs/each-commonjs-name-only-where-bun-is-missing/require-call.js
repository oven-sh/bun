if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared35 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("require-call", typeOfThis(), storeToUndeclaredName());
