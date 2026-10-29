if (typeof Object.keys !== "function") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared10 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("object-keys require-call", typeOfThis(), storeToUndeclaredName());
