if (typeof /x/ === "string") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared31 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-regexp require-call", typeOfThis(), storeToUndeclaredName());
