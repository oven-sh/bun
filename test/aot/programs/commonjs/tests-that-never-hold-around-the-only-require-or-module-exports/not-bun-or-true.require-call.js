if (!(typeof Bun === "undefined" || true)) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared29 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-bun-or-true require-call", typeOfThis(), storeToUndeclaredName());
