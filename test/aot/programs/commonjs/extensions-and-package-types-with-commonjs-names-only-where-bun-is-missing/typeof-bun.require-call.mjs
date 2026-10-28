if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared84 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-bun require-call mjs", typeOfThis(), storeToUndeclaredName());
