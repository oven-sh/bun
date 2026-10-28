const isBun = typeof Bun !== "undefined";
if (!isBun) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared19 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("const-from-typeof-bun require-call", typeOfThis(), storeToUndeclaredName());
