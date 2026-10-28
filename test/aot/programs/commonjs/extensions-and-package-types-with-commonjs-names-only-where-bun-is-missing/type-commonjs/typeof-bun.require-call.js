if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared104 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("type-commonjs/typeof-bun require-call js", typeOfThis(), storeToUndeclaredName());
