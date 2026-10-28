if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared100 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("type-module/typeof-bun require-call js", typeOfThis(), storeToUndeclaredName());
