if (typeof JSON === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared8 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-json require-call", typeOfThis(), storeToUndeclaredName());
