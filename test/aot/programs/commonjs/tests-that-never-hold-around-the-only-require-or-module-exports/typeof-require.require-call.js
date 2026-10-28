if (typeof require === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared32 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-require require-call", typeOfThis(), storeToUndeclaredName());
