if (null?.x) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared21 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("optional-chain-on-null require-call", typeOfThis(), storeToUndeclaredName());
