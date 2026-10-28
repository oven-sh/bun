if (globalThis.Bun === void 0) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared3 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("global-this-bun require-call", typeOfThis(), storeToUndeclaredName());
