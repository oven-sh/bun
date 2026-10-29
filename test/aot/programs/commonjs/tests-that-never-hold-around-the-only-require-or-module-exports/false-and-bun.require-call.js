if (false && typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared28 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false-and-bun require-call", typeOfThis(), storeToUndeclaredName());
