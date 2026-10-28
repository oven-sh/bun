if (!process.isBun) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared6 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("is-bun require-call", typeOfThis(), storeToUndeclaredName());
